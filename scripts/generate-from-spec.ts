// ABOUTME: CLI script to generate lessons from a course spec using OpenMAIC
// Generates text content, TTS audio, and images — all uploaded to S3
//
// Usage: pnpm generate:spec <path-to-spec.json> [options]
//
// Options:
//   --dry-run         Print what would be generated without calling LLMs
//   --limit N         Only generate first N lessons (cost control)
//   --resume          Skip lessons already generated
//   --course <id>     Only generate lessons for a specific course
//   --concurrency N   Max parallel generations (default: 1)
//   --no-tts          Skip TTS audio generation
//   --no-images       Skip image generation

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { generateClassroom } from '@/lib/server/classroom-generation';
import { flattenLessons, buildSubjectIndex, buildSubjectsManifest } from '@/lib/course-spec/parser';
import { buildRequirement } from '@/lib/course-spec/requirement-builder';
import type { CourseSpec, FlatLesson, SubjectIndex } from '@/lib/course-spec/types';
import type { PersistedClassroomData } from '@/lib/server/classroom-storage';
import { BrowseStorage } from '@/lib/s3/storage';
import { generateTTS } from '@/lib/audio/tts-providers';
import { resolveTTSApiKey, resolveTTSBaseUrl, resolveImageApiKey, resolveImageBaseUrl } from '@/lib/server/provider-config';
import { generateImage, aspectRatioToDimensions } from '@/lib/media/image-providers';
import type { SceneOutline } from '@/lib/types/generation';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const specPath = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const resume = args.includes('--resume');
const skipTTS = args.includes('--no-tts');
const skipImages = args.includes('--no-images');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const courseIdx = args.indexOf('--course');
const courseFilter = courseIdx >= 0 ? args[courseIdx + 1] : undefined;
const concurrencyIdx = args.indexOf('--concurrency');
const concurrency = concurrencyIdx >= 0 ? parseInt(args[concurrencyIdx + 1], 10) : 1;

if (!specPath) {
  console.error(
    'Usage: pnpm generate:spec <path-to-spec.json> [--dry-run] [--limit N] [--resume] [--course <id>] [--concurrency N] [--no-tts] [--no-images]',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// TTS generation (server-side, no browser needed)
// ---------------------------------------------------------------------------

async function generateTTSForLesson(
  scenes: Array<{ actions?: Array<{ type: string; id: string; text?: string; audioId?: string }> }>,
  storage: BrowseStorage,
  subjectCode: string,
  courseId: string,
  lessonId: string,
  label: string,
): Promise<number> {
  const ttsProviderId = 'openai-tts';
  const ttsVoice = 'alloy';
  const apiKey = resolveTTSApiKey(ttsProviderId);
  if (!apiKey) {
    console.log(`  ${label} TTS skipped: no API key for ${ttsProviderId}`);
    return 0;
  }
  const baseUrl = resolveTTSBaseUrl(ttsProviderId);

  let count = 0;
  for (const scene of scenes) {
    for (const action of scene.actions || []) {
      if (action.type !== 'speech' || !action.text || !action.audioId) continue;
      try {
        const { audio, format } = await generateTTS(
          { providerId: ttsProviderId, voice: ttsVoice, speed: 1.0, apiKey, baseUrl },
          action.text,
        );
        const bytes = new Uint8Array(audio);
        await storage.saveAudio(
          subjectCode,
          courseId,
          lessonId,
          action.audioId,
          bytes,
          `audio/${format}`,
        );
        count++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  ${label} TTS failed for ${action.audioId}: ${msg}`);
      }
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Image generation (server-side, no browser needed)
// ---------------------------------------------------------------------------

async function generateImagesForLesson(
  outlines: SceneOutline[],
  storage: BrowseStorage,
  subjectCode: string,
  courseId: string,
  lessonId: string,
  classroomId: string,
  label: string,
): Promise<number> {
  // Determine image provider from env
  const providerIds = ['nano-banana', 'seedream', 'qwen-image'] as const;
  let providerId: typeof providerIds[number] | null = null;
  let apiKey = '';

  for (const pid of providerIds) {
    const key = resolveImageApiKey(pid);
    if (key) {
      providerId = pid;
      apiKey = key;
      break;
    }
  }

  if (!providerId) {
    console.log(`  ${label} Images skipped: no image provider configured`);
    return 0;
  }

  const baseUrl = resolveImageBaseUrl(providerId);
  let count = 0;

  for (const outline of outlines) {
    for (const mg of outline.mediaGenerations || []) {
      if (mg.type !== 'image') continue;
      try {
        const dims = mg.aspectRatio
          ? aspectRatioToDimensions(mg.aspectRatio)
          : { width: 1024, height: 576 };

        const result = await generateImage(
          { providerId, apiKey, baseUrl },
          { prompt: mg.prompt, width: dims.width, height: dims.height },
        );

        if (result.url) {
          // Download the image
          const imgRes = await fetch(result.url);
          if (imgRes.ok) {
            const buf = await imgRes.arrayBuffer();
            const bytes = new Uint8Array(buf);
            const mediaId = `${classroomId}:${mg.elementId}`;
            await storage.saveMedia(
              subjectCode,
              courseId,
              lessonId,
              mediaId,
              bytes,
              'image/png',
            );
            count++;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  ${label} Image failed for ${mg.elementId}: ${msg}`);
      }
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const fullPath = resolve(specPath!);
  console.log(`Reading course spec: ${fullPath}`);

  const raw = readFileSync(fullPath, 'utf-8');
  const spec: CourseSpec = JSON.parse(raw);

  console.log(`Curriculum: ${spec.curriculum}`);
  console.log(`Subject: ${spec.config.subjectCode}`);

  let lessons = flattenLessons(spec);
  console.log(`Total lessons: ${lessons.length}`);

  if (courseFilter) {
    lessons = lessons.filter((l) => l.courseId === courseFilter);
    console.log(`Filtered to course "${courseFilter}": ${lessons.length} lessons`);
  }

  if (limit < lessons.length) {
    lessons = lessons.slice(0, limit);
    console.log(`Limited to first ${limit} lessons`);
  }

  const storage = new BrowseStorage();
  console.log(`S3 upload: will attempt via default AWS credential chain`);
  console.log(`TTS: ${skipTTS ? 'disabled' : 'enabled'}`);
  console.log(`Images: ${skipImages ? 'disabled' : 'enabled'}`);

  let existingIndex: SubjectIndex | null = null;
  if (resume) {
    existingIndex = await storage.getSubjectIndex(spec.config.subjectCode);
    if (existingIndex) {
      const alreadyGenerated = new Set<string>();
      for (const level of existingIndex.levels) {
        for (const course of level.courses) {
          for (const lesson of course.lessons) {
            if (lesson.generated) alreadyGenerated.add(lesson.id);
          }
        }
      }
      const before = lessons.length;
      lessons = lessons.filter((l) => !alreadyGenerated.has(l.lessonId));
      console.log(`Resume: skipping ${before - lessons.length} already-generated lessons`);
    }
  }

  if (lessons.length === 0) {
    console.log('Nothing to generate.');
    return;
  }

  if (dryRun) {
    console.log('\n--- DRY RUN ---\n');
    for (const [i, lesson] of lessons.entries()) {
      console.log(`[${i + 1}/${lessons.length}] ${lesson.courseCode} - ${lesson.lessonTitle}`);
      console.log(`  Course: ${lesson.courseTitle}`);
      console.log(`  Level: ${lesson.levelName} (${lesson.levelCode})`);
      console.log(`  Objective: ${lesson.objective.slice(0, 100)}...`);
      console.log(`  Requirement prompt (first 200 chars):`);
      console.log(`  ${buildRequirement(lesson).slice(0, 200)}...`);
      console.log();
    }
    console.log(`Would generate ${lessons.length} lessons.`);
    const index = buildSubjectIndex(spec, existingIndex ?? undefined);
    await storage.saveSubjectIndex(index);
    const manifest = buildSubjectsManifest([index]);
    await storage.saveSubjectsManifest(manifest);
    console.log('Saved subject index (dry-run, no generation status changes).');
    return;
  }

  // -- Real generation ------------------------------------------------------
  console.log(`\nGenerating ${lessons.length} lessons (concurrency: ${concurrency})...\n`);

  let completed = 0;
  let failed = 0;

  let index = buildSubjectIndex(spec, existingIndex ?? undefined);
  const queue = [...lessons];

  async function processLesson(lesson: FlatLesson): Promise<void> {
    const label = `[${completed + failed + 1}/${lessons.length}] ${lesson.courseCode} L${lesson.lessonNumber}`;
    console.log(`${label} Starting: ${lesson.lessonTitle}`);

    try {
      const requirement = buildRequirement(lesson);

      const result = await generateClassroom(
        { requirement, language: 'en-US' },
        {
          baseUrl: 'http://localhost:3000',
          onProgress: async (progress) => {
            if (progress.step === 'generating_scenes') {
              process.stdout.write(
                `\r  ${label} ${progress.message} (${progress.progress}%)`,
              );
            }
          },
        },
      );

      // Set audioId on speech actions
      for (const scene of result.scenes) {
        for (const action of scene.actions || []) {
          if (action.type === 'speech' && 'text' in action) {
            (action as unknown as Record<string, unknown>).audioId = `tts_${action.id}`;
          }
        }
      }

      console.log(`\n  ${label} Scenes: ${result.scenesCount}`);

      // Save classroom data (with outlines for image generation from UI)
      const classroomData = {
        id: result.id,
        stage: result.stage,
        scenes: result.scenes,
        outlines: result.outlines,
        createdAt: result.createdAt,
      };

      await storage.saveLesson(
        lesson.subjectCode,
        lesson.courseId,
        lesson.lessonId,
        classroomData as PersistedClassroomData,
      );

      // Generate TTS audio
      if (!skipTTS) {
        const ttsCount = await generateTTSForLesson(
          result.scenes as Array<{ actions?: Array<{ type: string; id: string; text?: string; audioId?: string }> }>,
          storage,
          lesson.subjectCode,
          lesson.courseId,
          lesson.lessonId,
          label,
        );
        console.log(`  ${label} TTS: ${ttsCount} audio files`);
      }

      // Generate images
      if (!skipImages) {
        const imgCount = await generateImagesForLesson(
          result.outlines,
          storage,
          lesson.subjectCode,
          lesson.courseId,
          lesson.lessonId,
          result.id,
          label,
        );
        console.log(`  ${label} Images: ${imgCount} files`);
      }

      updateLessonStatus(index, lesson.lessonId, {
        generated: true,
        generatedAt: result.createdAt,
        classroomId: result.id,
        scenesCount: result.scenesCount,
      });

      await storage.saveSubjectIndex(index);
      completed++;
      console.log(`  ${label} Complete`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`\n  ${label} FAILED: ${msg}`);
      failed++;
    }
  }

  // Concurrency pool
  async function runPool() {
    const active: Promise<void>[] = [];

    while (queue.length > 0) {
      if (active.length >= concurrency) {
        await Promise.race(active);
        for (let i = active.length - 1; i >= 0; i--) {
          const settled = await Promise.race([
            active[i].then(() => true),
            Promise.resolve(false),
          ]);
          if (settled) active.splice(i, 1);
        }
      }

      const lesson = queue.shift()!;
      const p = processLesson(lesson).catch(() => {});
      active.push(p);
    }

    await Promise.all(active);
  }

  await runPool();

  // Final manifest
  await storage.saveSubjectIndex(index);
  const allIndices = [index];
  const codes = await storage.listSubjectCodes();
  for (const code of codes) {
    if (code === spec.config.subjectCode) continue;
    const other = await storage.getSubjectIndex(code);
    if (other) allIndices.push(other);
  }
  await storage.saveSubjectsManifest(buildSubjectsManifest(allIndices));

  console.log(`\nDone. Generated: ${completed}, Failed: ${failed}`);
  console.log(`Index saved for ${spec.config.subjectCode}`);
}

function updateLessonStatus(
  index: SubjectIndex,
  lessonId: string,
  status: { generated: boolean; generatedAt?: string; classroomId?: string; scenesCount?: number },
): void {
  for (const level of index.levels) {
    for (const course of level.courses) {
      for (const lesson of course.lessons) {
        if (lesson.id === lessonId) {
          Object.assign(lesson, status);
          return;
        }
      }
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
