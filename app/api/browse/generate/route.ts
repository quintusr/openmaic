// ABOUTME: API route to generate a single lesson from a course spec lesson
// POST with { subjectCode, courseId, lessonId, requirement, language }
// Returns the generated classroom data and saves to browse storage

import type { NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { generateClassroom } from '@/lib/server/classroom-generation';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import type { PersistedClassroomData } from '@/lib/server/classroom-storage';
import { getBrowseStorage } from '@/lib/s3/storage';
import { buildSubjectsManifest } from '@/lib/course-spec/parser';
import { searchWithTavily, formatSearchResultsAsContext } from '@/lib/web-search/tavily';
import { resolveWebSearchApiKey } from '@/lib/server/provider-config';
import { createLogger } from '@/lib/logger';

const log = createLogger('BrowseGenerate');

export const maxDuration = 300; // 5 minutes max for generation

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { subjectCode, courseId, lessonId, requirement, language } = body;

    if (!subjectCode || !courseId || !lessonId || !requirement) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required fields: subjectCode, courseId, lessonId, requirement',
      );
    }

    const baseUrl = buildRequestOrigin(request);

    // Web search for up-to-date context (if Tavily is configured)
    let enrichedRequirement = requirement;
    const tavilyKey = resolveWebSearchApiKey();
    if (tavilyKey) {
      try {
        log.info(`Web search for: "${requirement.slice(0, 80)}..."`);
        const searchResult = await searchWithTavily({
          query: requirement.slice(0, 400),
          apiKey: tavilyKey,
        });
        const context = formatSearchResultsAsContext(searchResult);
        if (context) {
          enrichedRequirement =
            requirement +
            '\n\n---\n\n### Web Research Context (use to ensure accuracy)\n\n' +
            context;
          log.info(`Web search added ${searchResult.sources.length} sources`);
        }
      } catch (err) {
        log.warn('Web search failed, continuing without:', err);
      }
    }

    const result = await generateClassroom(
      {
        requirement: enrichedRequirement,
        language: language || 'en-US',
      },
      {
        baseUrl,
      },
    );

    // Set audioId on all speech actions so the playback engine can find TTS audio
    for (const scene of result.scenes) {
      for (const action of scene.actions || []) {
        if (
          action.type === 'speech' &&
          'text' in action &&
          !('audioId' in action && action.audioId)
        ) {
          (action as unknown as Record<string, unknown>).audioId = `tts_${action.id}`;
        }
      }
    }

    // Save to browse storage (local + S3) — include outlines for media generation
    const classroomData = {
      id: result.id,
      stage: result.stage,
      scenes: result.scenes,
      outlines: result.outlines,
      createdAt: result.createdAt,
    };

    const storage = getBrowseStorage();
    await storage.saveLesson(
      subjectCode,
      courseId,
      lessonId,
      classroomData as PersistedClassroomData,
    );

    // Update the subject index
    const index = await storage.getSubjectIndex(subjectCode);
    if (index) {
      for (const level of index.levels) {
        for (const course of level.courses) {
          for (const lesson of course.lessons) {
            if (lesson.id === lessonId) {
              lesson.generated = true;
              lesson.generatedAt = result.createdAt;
              lesson.classroomId = result.id;
              lesson.scenesCount = result.scenesCount;
            }
          }
        }
      }
      index.updatedAt = new Date().toISOString();
      await storage.saveSubjectIndex(index);

      // Rebuild subjects manifest so generated counts are accurate
      const codes = await storage.listSubjectCodes();
      const allIndices = [index];
      for (const code of codes) {
        if (code === subjectCode) continue;
        const other = await storage.getSubjectIndex(code);
        if (other) allIndices.push(other);
      }
      await storage.saveSubjectsManifest(buildSubjectsManifest(allIndices));
    }

    // Return speech action IDs for client-side TTS generation
    const speechActions: Array<{ id: string; text: string; audioId: string }> = [];
    for (const scene of result.scenes) {
      for (const action of scene.actions || []) {
        if (action.type === 'speech' && 'text' in action) {
          const a = action as unknown as Record<string, unknown>;
          speechActions.push({
            id: action.id,
            text: a.text as string,
            audioId: a.audioId as string,
          });
        }
      }
    }

    return apiSuccess({
      classroomId: result.id,
      scenesCount: result.scenesCount,
      createdAt: result.createdAt,
      speechActions,
      outlines: result.outlines,
      stage: result.stage,
      scenes: result.scenes,
    });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.GENERATION_FAILED,
      500,
      'Failed to generate lesson',
      error instanceof Error ? error.message : String(error),
    );
  }
}
