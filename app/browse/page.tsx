'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  BookOpen,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  FolderOpen,
  GraduationCap,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { useStageStore } from '@/lib/store';
import { db } from '@/lib/utils/database';
import { saveStageData } from '@/lib/utils/stage-storage';
import { generateMediaForOutlines } from '@/lib/media/media-orchestrator';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Types (matching API response shapes)
// ---------------------------------------------------------------------------

interface SubjectEntry {
  code: string;
  name: string;
  courseCount: number;
  lessonCount: number;
  generatedCount: number;
}

interface SubjectIndexLesson {
  id: string;
  lesson: number;
  title: string;
  objective: string;
  generated: boolean;
  generatedAt?: string;
  classroomId?: string;
  scenesCount?: number;
}

interface SubjectIndexCourse {
  id: string;
  code: string;
  title: string;
  lessons: SubjectIndexLesson[];
}

interface SubjectIndexLevel {
  level: string;
  name: string;
  courses: SubjectIndexCourse[];
}

interface SubjectIndex {
  subjectCode: string;
  curriculum: string;
  levels: SubjectIndexLevel[];
}

const COURSE_SPECS = [
  { name: 'AI for High School Students', path: 'course-specs/conceptual/ai.json' },
  { name: 'Biology for High School Students', path: 'course-specs/conceptual/biology.json' },
  { name: 'Physics for High School Students', path: 'course-specs/conceptual/physics.json' },
];

/** Known course spec subject codes — anything else is user-generated */
const COURSE_SPEC_CODES = new Set(['AI', 'BIOLOGY', 'PHYSICS']);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BrowsePage() {
  const router = useRouter();
  const { t } = useI18n();

  const [subjects, setSubjects] = useState<SubjectEntry[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [subjectIndex, setSubjectIndex] = useState<SubjectIndex | null>(null);
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(new Set());
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [loadingIndex, setLoadingIndex] = useState(false);
  const [loadingLesson, setLoadingLesson] = useState<string | null>(null);
  const [generatingLessons, setGeneratingLessons] = useState<Set<string>>(new Set());
  const [seeding, setSeeding] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  // Generation queue tracking
  type LessonPhase = 'queued' | 'generating' | 'tts' | 'images' | 'uploading' | 'done' | 'failed';
  interface QueueEntry {
    lessonId: string;
    title: string;
    courseTitle: string;
    phase: LessonPhase;
  }
  const [queueEntries, setQueueEntries] = useState<QueueEntry[]>([]);
  const [completedCount, setCompletedCount] = useState(0);

  const updateQueuePhase = useCallback(
    (lessonId: string, phase: LessonPhase) => {
      setQueueEntries((prev) =>
        prev.map((e) => (e.lessonId === lessonId ? { ...e, phase } : e)),
      );
      if (phase === 'done' || phase === 'failed') {
        setCompletedCount((c) => c + 1);
      }
    },
    [],
  );

  const addToQueue = useCallback(
    (lessonId: string, title: string, courseTitle: string) => {
      setQueueEntries((prev) => {
        // Don't add duplicates
        if (prev.some((e) => e.lessonId === lessonId)) return prev;
        return [...prev, { lessonId, title, courseTitle, phase: 'queued' as LessonPhase }];
      });
    },
    [],
  );

  const clearQueue = useCallback(() => {
    setQueueEntries([]);
    setCompletedCount(0);
  }, []);

  // Track in-progress generations in localStorage for refresh recovery
  const updatePendingStorage = useCallback((lessons: Set<string>) => {
    try {
      if (lessons.size > 0) {
        localStorage.setItem('browse:generating', JSON.stringify([...lessons]));
      } else {
        localStorage.removeItem('browse:generating');
      }
    } catch { /* ignore */ }
  }, []);

  // On mount, warn about interrupted generations
  useEffect(() => {
    try {
      const pending = localStorage.getItem('browse:generating');
      if (pending) {
        const ids = JSON.parse(pending) as string[];
        if (ids.length > 0) {
          toast.error(
            `${ids.length} generation(s) were interrupted by page refresh. Use "Regenerate" to re-run them.`,
          );
          localStorage.removeItem('browse:generating');
        }
      }
    } catch { /* ignore */ }
  }, []);

  // Global generation semaphore — max 2 lessons generating at any time
  const MAX_CONCURRENT = 2;
  const activeCountRef = useRef(0);
  const waitQueueRef = useRef<Array<() => void>>([]);

  const acquireSlot = useCallback((): Promise<void> => {
    if (activeCountRef.current < MAX_CONCURRENT) {
      activeCountRef.current++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      waitQueueRef.current.push(() => {
        activeCountRef.current++;
        resolve();
      });
    });
  }, []);

  const releaseSlot = useCallback(() => {
    activeCountRef.current--;
    const next = waitQueueRef.current.shift();
    if (next) next();
  }, []);

  const refreshSubjects = useCallback(async () => {
    try {
      const res = await fetch('/api/browse/subjects');
      const json = await res.json();
      if (json.success && json.subjects) {
        setSubjects(json.subjects);
        return json.subjects as SubjectEntry[];
      }
    } catch {
      // silently fail
    }
    return [] as SubjectEntry[];
  }, []);

  const refreshIndex = useCallback(async (code: string) => {
    try {
      const res = await fetch(`/api/browse/subjects/${code}`);
      const json = await res.json();
      if (json.success && json.index) {
        setSubjectIndex(json.index);
      }
    } catch {
      // silently fail
    }
  }, []);

  // Fetch subjects on mount
  useEffect(() => {
    async function load() {
      const loaded = await refreshSubjects();
      if (loaded.length > 0) {
        setSelectedSubject(loaded[0].code);
      }
      setLoadingSubjects(false);
    }
    load();
  }, [refreshSubjects]);

  // Fetch subject index when selection changes
  useEffect(() => {
    if (!selectedSubject) return;
    setLoadingIndex(true);
    setSubjectIndex(null);

    async function load() {
      try {
        const res = await fetch(`/api/browse/subjects/${selectedSubject}`);
        const json = await res.json();
        if (json.success && json.index) {
          setSubjectIndex(json.index);
          const firstCourse = json.index.levels?.[0]?.courses?.[0]?.id;
          if (firstCourse) {
            setExpandedCourses(new Set([firstCourse]));
          }
        }
      } catch {
        toast.error('Failed to load subject data');
      } finally {
        setLoadingIndex(false);
      }
    }
    load();
  }, [selectedSubject]);

  const toggleCourse = useCallback((courseId: string) => {
    setExpandedCourses((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) {
        next.delete(courseId);
      } else {
        next.add(courseId);
      }
      return next;
    });
  }, []);

  const handleViewLesson = useCallback(
    async (subjectCode: string, courseId: string, lesson: SubjectIndexLesson) => {
      if (!lesson.generated) return;
      setLoadingLesson(lesson.id);

      try {
        // 1. Load lesson into server-side storage, get outlines for media gen
        const res = await fetch(
          `/api/browse/lessons/${subjectCode}/${courseId}/${lesson.id}`,
        );
        const json = await res.json();
        if (!json.success || !json.classroomId) {
          toast.error('Failed to load lesson');
          return;
        }

        // 2. Fetch full classroom data and persist to IndexedDB
        const classroomRes = await fetch(
          `/api/classroom?id=${encodeURIComponent(json.classroomId)}`,
        );
        const classroomJson = await classroomRes.json();

        if (classroomJson.success && classroomJson.classroom) {
          const { stage, scenes } = classroomJson.classroom;
          const outlines = json.outlines || [];
          const classroomId = json.classroomId;

          // Save full stage data to IndexedDB
          try {
            await saveStageData(classroomId, {
              stage,
              scenes,
              currentSceneId: scenes[0]?.id ?? null,
              chats: [],
            });
            if (outlines.length > 0) {
              const now = Date.now();
              await db.stageOutlines.put({
                stageId: classroomId,
                outlines,
                createdAt: now,
                updatedAt: now,
              });
            }
          } catch {
            // Non-fatal
          }

          // 3. Restore audio from S3 into IndexedDB (if not already there)
          for (const scene of scenes) {
            const speechActions = (scene.actions || []).filter(
              (a: { type: string; audioId?: string }) =>
                a.type === 'speech' && a.audioId,
            );
            for (const action of speechActions) {
              const audioId = action.audioId as string;
              const existing = await db.audioFiles.get(audioId);
              if (existing) continue;

              try {
                const audioRes = await fetch(
                  `/api/browse/audio?subjectCode=${subjectCode}&courseId=${courseId}&lessonId=${lesson.id}&audioId=${encodeURIComponent(audioId)}`,
                );
                if (!audioRes.ok) continue;
                const blob = await audioRes.blob();
                await db.audioFiles.put({
                  id: audioId,
                  blob,
                  format: 'mp3',
                  createdAt: Date.now(),
                });
              } catch {
                // Non-fatal
              }
            }
          }

          // 4. Restore media (images) from S3 into IndexedDB
          const { mediaFileKey } = await import('@/lib/utils/database');
          for (const outline of outlines) {
            for (const mg of outline.mediaGenerations || []) {
              const key = mediaFileKey(classroomId, mg.elementId);
              const existing = await db.mediaFiles.get(key);
              if (existing) continue;

              try {
                const mediaRes = await fetch(
                  `/api/browse/media?subjectCode=${subjectCode}&courseId=${courseId}&lessonId=${lesson.id}&mediaId=${encodeURIComponent(key)}`,
                );
                if (!mediaRes.ok) continue;
                const blob = await mediaRes.blob();
                await db.mediaFiles.put({
                  id: key,
                  stageId: classroomId,
                  type: mg.type as 'image' | 'video',
                  blob,
                  mimeType: blob.type || 'image/png',
                  size: blob.size,
                  prompt: mg.prompt,
                  params: '{}',
                  createdAt: Date.now(),
                });
              } catch {
                // Non-fatal
              }
            }
          }
        }

        router.push(`/classroom/${json.classroomId}`);
      } catch {
        toast.error('Failed to load lesson');
      } finally {
        setLoadingLesson(null);
      }
    },
    [router],
  );

  const handleGenerateLesson = useCallback(
    async (
      subjectCode: string,
      courseId: string,
      courseTitle: string,
      lesson: SubjectIndexLesson,
    ) => {
      setGeneratingLessons((prev) => {
        const next = new Set(prev).add(lesson.id);
        updatePendingStorage(next);
        return next;
      });
      addToQueue(lesson.id, lesson.title, courseTitle);

      // Wait for a generation slot (global max 2 concurrent)
      await acquireSlot();
      updateQueuePhase(lesson.id, 'generating');

      // Build a requirement prompt from the lesson data
      const requirement = [
        `Create an interactive lesson: "${lesson.title}"`,
        '',
        `This is part of the course "${courseTitle}".`,
        '',
        `Learning Objective: ${lesson.objective}`,
        '',
        `Guidelines:`,
        `- Target audience: high school students`,
        `- Make it engaging and thought-provoking`,
        `- Include a mix of explanation slides, interactive elements, and assessment`,
      ].join('\n');

      try {
        const res = await fetch('/api/browse/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subjectCode,
            courseId,
            lessonId: lesson.id,
            requirement,
            language: 'en-US',
          }),
        });

        const json = await res.json();
        if (json.success) {
          const outlines = json.outlines || [];
          const stage = json.stage;
          const scenes = json.scenes || [];
          const classroomId = json.classroomId;

          // Save stage data to IndexedDB so classroom page finds it
          try {
            await saveStageData(classroomId, {
              stage,
              scenes,
              currentSceneId: scenes[0]?.id ?? null,
              chats: [],
            });
            if (outlines.length > 0) {
              const now = Date.now();
              await db.stageOutlines.put({
                stageId: classroomId,
                outlines,
                createdAt: now,
                updatedAt: now,
              });
            }
          } catch {
            // Non-fatal
          }

          // Ensure image generation is enabled before triggering media generation
          const settingsState = useSettingsStore.getState();
          if (!settingsState.imageGenerationEnabled) {
            useSettingsStore.getState().setImageGenerationEnabled(true);
          }

          // Generate images in parallel with TTS
          updateQueuePhase(lesson.id, 'images');
          const imagePromise =
            outlines.length > 0
              ? generateMediaForOutlines(outlines, classroomId).catch(() => {})
              : Promise.resolve();

          // Generate TTS for all speech actions
          updateQueuePhase(lesson.id, 'tts');
          const speechActions: Array<{ id: string; text: string; audioId: string }> =
            json.speechActions || [];
          let ttsCount = 0;

          const settings = useSettingsStore.getState();
          const shouldTTS =
            settings.ttsEnabled &&
            settings.ttsProviderId !== 'browser-native-tts';

          if (shouldTTS && speechActions.length > 0) {
            const ttsConfig =
              settings.ttsProvidersConfig?.[settings.ttsProviderId];

            for (const sa of speechActions) {
              try {
                const ttsRes = await fetch('/api/generate/tts', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    text: sa.text,
                    audioId: sa.audioId,
                    ttsProviderId: settings.ttsProviderId,
                    ttsVoice: settings.ttsVoice,
                    ttsSpeed: settings.ttsSpeed,
                    ttsApiKey: ttsConfig?.apiKey || undefined,
                    ttsBaseUrl: ttsConfig?.baseUrl || undefined,
                  }),
                });
                if (!ttsRes.ok) continue;
                const ttsData = await ttsRes.json();
                if (!ttsData.success) continue;

                const binary = atob(ttsData.base64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++)
                  bytes[i] = binary.charCodeAt(i);
                const blob = new Blob([bytes], {
                  type: `audio/${ttsData.format}`,
                });
                await db.audioFiles.put({
                  id: sa.audioId,
                  blob,
                  format: ttsData.format,
                  createdAt: Date.now(),
                });

                // Upload to S3 for persistence
                try {
                  const fd = new FormData();
                  fd.append('subjectCode', subjectCode);
                  fd.append('courseId', courseId);
                  fd.append('lessonId', lesson.id);
                  fd.append('audioId', sa.audioId);
                  fd.append('file', blob, `${sa.audioId}.mp3`);
                  await fetch('/api/browse/audio', { method: 'POST', body: fd });
                } catch {
                  // Non-fatal — audio still in IndexedDB
                }

                ttsCount++;
              } catch {
                // Non-fatal
              }
            }
          }

          // Wait for images to finish
          await imagePromise;

          // Upload generated media (images) to S3
          updateQueuePhase(lesson.id, 'uploading');
          if (outlines.length > 0) {
            try {
              const mediaFiles = await db.mediaFiles
                .where('stageId')
                .equals(classroomId)
                .toArray();
              for (const mf of mediaFiles) {
                if (!mf.blob) continue;
                const ext = mf.mimeType?.split('/')[1] || 'png';
                const fd = new FormData();
                fd.append('subjectCode', subjectCode);
                fd.append('courseId', courseId);
                fd.append('lessonId', lesson.id);
                fd.append('mediaId', mf.id);
                fd.append('file', mf.blob, `${mf.id}.${ext}`);
                await fetch('/api/browse/media', { method: 'POST', body: fd });
              }
            } catch {
              // Non-fatal
            }
          }

          const parts = [`${json.scenesCount} scenes`];
          if (ttsCount > 0) parts.push(`${ttsCount} audio`);
          updateQueuePhase(lesson.id, 'done');
          toast.success(`Generated "${lesson.title}" (${parts.join(', ')})`);

          await refreshIndex(subjectCode);
          await refreshSubjects();
        } else {
          updateQueuePhase(lesson.id, 'failed');
          toast.error(`${lesson.title}: ${json.error || 'Generation failed'}`);
        }
      } catch {
        updateQueuePhase(lesson.id, 'failed');
        toast.error(`${lesson.title}: Generation request failed`);
      } finally {
        releaseSlot();
        setGeneratingLessons((prev) => {
          const next = new Set(prev);
          next.delete(lesson.id);
          updatePendingStorage(next);
          return next;
        });
      }
    },
    [refreshIndex, refreshSubjects, acquireSlot, releaseSlot],
  );

  // Queue all lessons in a course — global semaphore limits to MAX_CONCURRENT
  const handleGenerateCourse = useCallback(
    async (
      subjectCode: string,
      course: SubjectIndexCourse,
      regenerateAll: boolean,
    ) => {
      const lessons = regenerateAll
        ? course.lessons
        : course.lessons.filter((l) => !l.generated);

      if (lessons.length === 0) {
        toast.success(`All lessons in "${course.title}" are already generated`);
        return;
      }

      toast.success(
        `Queued ${lessons.length} lesson(s) from "${course.title}"`,
      );

      // Fire all — the global semaphore in handleGenerateLesson limits concurrency
      await Promise.all(
        lessons.map((lesson) =>
          handleGenerateLesson(subjectCode, course.id, course.title, lesson),
        ),
      );

      toast.success(`Finished generating "${course.title}"`);
    },
    [handleGenerateLesson],
  );

  const handleSeedAll = useCallback(async () => {
    setSeeding(true);
    let seeded = 0;

    for (const spec of COURSE_SPECS) {
      try {
        const res = await fetch('/api/browse/seed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ specPath: spec.path }),
        });
        const json = await res.json();
        if (json.success) {
          seeded++;
        }
      } catch {
        // continue with others
      }
    }

    if (seeded > 0) {
      toast.success(`Loaded ${seeded} course spec(s)`);
      const loaded = await refreshSubjects();
      if (loaded.length > 0 && !selectedSubject) {
        setSelectedSubject(loaded[0].code);
      }
    } else {
      toast.error('Failed to load course specs. Check that spec files exist.');
    }

    setSeeding(false);
  }, [refreshSubjects, selectedSubject]);

  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 relative overflow-hidden">
      {/* Background blur orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse"
          style={{ animationDuration: '4s' }}
        />
        <div
          className="absolute bottom-0 right-1/4 w-96 h-96 bg-brand-500/8 rounded-full blur-3xl animate-pulse"
          style={{ animationDuration: '6s' }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center p-4 pt-16 md:p-8 md:pt-16">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="w-full max-w-6xl"
        >
          <div className="flex items-center justify-end mb-8">
            <div className="flex items-center gap-2">
              {/* Refresh */}
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full text-muted-foreground/60"
                onClick={async () => {
                  await refreshSubjects();
                  if (selectedSubject) await refreshIndex(selectedSubject);
                  toast.success('Refreshed');
                }}
              >
                <RefreshCw className="size-3.5" />
              </Button>

            </div>
          </div>

          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-brand-100 dark:bg-brand-900/30">
              <BookOpen className="size-5 text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {t('browse.title')}
              </h1>
              <p className="text-sm text-muted-foreground/60">
                {t('browse.subtitle')}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Subject tabs */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.5, ease: 'easeOut' }}
          className="w-full max-w-6xl mt-6"
        >
          {loadingSubjects ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                {t('browse.loading')}
              </span>
            </div>
          ) : subjects.length === 0 ? (
            <div className="text-center py-16">
              <GraduationCap className="size-12 mx-auto mb-4 text-muted-foreground/30" />
              <h2 className="text-lg font-semibold text-muted-foreground">
                {t('browse.noSubjects')}
              </h2>
              <p className="text-sm text-muted-foreground/60 mt-1">
                {t('browse.noSubjectsDesc')}
              </p>
            </div>
          ) : (
            <>
              {/* Subject pills — course specs first, then user-generated */}
              {(() => {
                const specSubjects = subjects.filter((s) => COURSE_SPEC_CODES.has(s.code));
                const userSubjects = subjects.filter((s) => !COURSE_SPEC_CODES.has(s.code));
                let idx = 0;

                return (
                  <div className="space-y-4 mb-8">
                    {specSubjects.length > 0 && (
                      <div className="flex flex-wrap gap-3">
                        {specSubjects.map((subject) => {
                          const i = idx++;
                          return (
                            <SubjectPill
                              key={subject.code}
                              subject={subject}
                              index={i}
                              selected={selectedSubject === subject.code}
                              onClick={() => setSelectedSubject(subject.code)}
                              t={t}
                            />
                          );
                        })}
                      </div>
                    )}
                    {userSubjects.length > 0 && (
                      <>
                        <div className="flex items-center gap-3">
                          <div className="h-px flex-1 bg-border/30" />
                          <span className="text-[11px] font-medium text-muted-foreground/40 uppercase tracking-wider">
                            User Generated
                          </span>
                          <div className="h-px flex-1 bg-border/30" />
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {userSubjects.map((subject) => {
                            const i = idx++;
                            return (
                              <SubjectPill
                                key={subject.code}
                                subject={subject}
                                index={i}
                                selected={selectedSubject === subject.code}
                                onClick={() => setSelectedSubject(subject.code)}
                                isUserGenerated
                                t={t}
                              />
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

              {/* Subject content */}
              <AnimatePresence mode="wait">
                {loadingIndex ? (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center justify-center py-12"
                  >
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">
                      {t('browse.loading')}
                    </span>
                  </motion.div>
                ) : subjectIndex ? (
                  <motion.div
                    key={subjectIndex.subjectCode}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                    className="space-y-6"
                  >
                    {subjectIndex.levels.map((level) => (
                      <LevelSection
                        key={level.level}
                        level={level}
                        subjectCode={subjectIndex.subjectCode}
                        expandedCourses={expandedCourses}
                        onToggleCourse={toggleCourse}
                        onViewLesson={handleViewLesson}
                        onGenerateLesson={handleGenerateLesson}
                        onGenerateCourse={handleGenerateCourse}
                        loadingLesson={loadingLesson}
                        generatingLessons={generatingLessons}
                        t={t}
                      />
                    ))}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </>
          )}
        </motion.div>

        {/* Footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mt-12 mb-8 text-xs text-muted-foreground/40"
        >
          Content Factory
        </motion.p>
      </div>

      {/* Generation progress panel */}
      <AnimatePresence>
        {queueEntries.length > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg"
          >
            <div className="bg-slate-900/95 dark:bg-slate-800/95 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-2xl overflow-hidden">
              {/* Summary bar — always visible, clickable */}
              <button
                onClick={() => setQueueOpen((p) => !p)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-800/50 transition-colors"
              >
                {completedCount < queueEntries.length ? (
                  <Loader2 className="size-4 text-brand-400 animate-spin shrink-0" />
                ) : (
                  <CircleCheck className="size-4 text-emerald-400 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">
                      {completedCount < queueEntries.length
                        ? `Generating ${completedCount + 1} of ${queueEntries.length}...`
                        : `All ${queueEntries.length} lessons complete`}
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div className="mt-1.5 h-1 bg-slate-700 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-brand-500 rounded-full"
                      animate={{
                        width: `${queueEntries.length > 0 ? (completedCount / queueEntries.length) * 100 : 0}%`,
                      }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                </div>
                <motion.div
                  animate={{ rotate: queueOpen ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronRight className="size-4 text-slate-400 rotate-90" />
                </motion.div>
                {completedCount >= queueEntries.length && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      clearQueue();
                    }}
                    className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded"
                  >
                    Clear
                  </button>
                )}
              </button>

              {/* Expanded detail list */}
              <AnimatePresence>
                {queueOpen && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: 'auto' }}
                    exit={{ height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="max-h-60 overflow-y-auto border-t border-slate-700/50">
                      {queueEntries.map((entry) => (
                        <div
                          key={entry.lessonId}
                          className="flex items-center gap-3 px-4 py-2 border-b border-slate-800/50 last:border-0"
                        >
                          <div className="shrink-0">
                            {entry.phase === 'done' && (
                              <CircleCheck className="size-3.5 text-emerald-400" />
                            )}
                            {entry.phase === 'failed' && (
                              <CircleDashed className="size-3.5 text-red-400" />
                            )}
                            {entry.phase === 'queued' && (
                              <CircleDashed className="size-3.5 text-slate-500" />
                            )}
                            {(entry.phase === 'generating' ||
                              entry.phase === 'tts' ||
                              entry.phase === 'images' ||
                              entry.phase === 'uploading') && (
                              <Loader2 className="size-3.5 text-brand-400 animate-spin" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-white/90 truncate">
                              {entry.title}
                            </p>
                            <p className="text-[10px] text-slate-500 truncate">
                              {entry.courseTitle}
                            </p>
                          </div>
                          <span
                            className={cn(
                              'text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0',
                              entry.phase === 'queued' && 'text-slate-500 bg-slate-800',
                              entry.phase === 'generating' && 'text-brand-300 bg-brand-950/50',
                              entry.phase === 'tts' && 'text-blue-300 bg-blue-950/50',
                              entry.phase === 'images' && 'text-amber-300 bg-amber-950/50',
                              entry.phase === 'uploading' && 'text-cyan-300 bg-cyan-950/50',
                              entry.phase === 'done' && 'text-emerald-300 bg-emerald-950/50',
                              entry.phase === 'failed' && 'text-red-300 bg-red-950/50',
                            )}
                          >
                            {entry.phase === 'generating' ? 'LLM' : entry.phase}
                          </span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Level section
// ---------------------------------------------------------------------------

function LevelSection({
  level,
  subjectCode,
  expandedCourses,
  onToggleCourse,
  onViewLesson,
  onGenerateLesson,
  onGenerateCourse,
  loadingLesson,
  generatingLessons,
  t,
}: {
  level: SubjectIndexLevel;
  subjectCode: string;
  expandedCourses: Set<string>;
  onToggleCourse: (id: string) => void;
  onViewLesson: (subjectCode: string, courseId: string, lesson: SubjectIndexLesson) => void;
  onGenerateCourse: (
    subjectCode: string,
    course: SubjectIndexCourse,
    regenerateAll: boolean,
  ) => void;
  onGenerateLesson: (
    subjectCode: string,
    courseId: string,
    courseTitle: string,
    lesson: SubjectIndexLesson,
  ) => void;
  loadingLesson: string | null;
  generatingLessons: Set<string>;
  t: (key: string) => string;
}) {
  const totalLessons = level.courses.reduce(
    (sum, c) => sum + c.lessons.length,
    0,
  );
  const generatedLessons = level.courses.reduce(
    (sum, c) => sum + c.lessons.filter((l) => l.generated).length,
    0,
  );

  return (
    <div className="rounded-2xl border border-border/40 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm overflow-hidden">
      {/* Level header */}
      <div className="px-5 py-4 border-b border-border/30 bg-slate-50/50 dark:bg-slate-800/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <Layers className="size-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground/90">
                {level.name}
              </h2>
              <span className="text-xs text-muted-foreground/60">
                {t('browse.level')} {level.level}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground/60">
            <span>
              {totalLessons} {t('browse.totalLessons').toLowerCase()}
            </span>
            <span className="w-[1px] h-3 bg-border/50" />
            <span className="text-emerald-600 dark:text-emerald-400">
              {generatedLessons} {t('browse.generated').toLowerCase()}
            </span>
          </div>
        </div>
      </div>

      {/* Courses */}
      <div className="divide-y divide-border/20">
        {level.courses.map((course) => (
          <CourseSection
            key={course.id}
            course={course}
            subjectCode={subjectCode}
            expanded={expandedCourses.has(course.id)}
            onToggle={() => onToggleCourse(course.id)}
            onViewLesson={onViewLesson}
            onGenerateLesson={onGenerateLesson}
            onGenerateCourse={onGenerateCourse}
            loadingLesson={loadingLesson}
            generatingLessons={generatingLessons}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Course section
// ---------------------------------------------------------------------------

function CourseSection({
  course,
  subjectCode,
  expanded,
  onToggle,
  onViewLesson,
  onGenerateLesson,
  onGenerateCourse,
  loadingLesson,
  generatingLessons,
  t,
}: {
  course: SubjectIndexCourse;
  subjectCode: string;
  expanded: boolean;
  onToggle: () => void;
  onViewLesson: (subjectCode: string, courseId: string, lesson: SubjectIndexLesson) => void;
  onGenerateLesson: (
    subjectCode: string,
    courseId: string,
    courseTitle: string,
    lesson: SubjectIndexLesson,
  ) => void;
  onGenerateCourse: (
    subjectCode: string,
    course: SubjectIndexCourse,
    regenerateAll: boolean,
  ) => void;
  loadingLesson: string | null;
  generatingLessons: Set<string>;
  t: (key: string) => string;
}) {
  const generated = course.lessons.filter((l) => l.generated).length;
  const total = course.lessons.length;
  const hasUngenerated = generated < total;
  const isCourseGenerating = course.lessons.some((l) =>
    generatingLessons.has(l.id),
  );

  return (
    <div>
      <div className="flex items-center gap-1 px-5 py-3.5 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
        <button
          onClick={onToggle}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <motion.div
            animate={{ rotate: expanded ? 90 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronRight className="size-4 text-muted-foreground/50" />
          </motion.div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground/50">
                {course.code}
              </span>
              <span className="text-sm font-medium text-foreground/90 truncate">
                {course.title}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground/50 shrink-0">
            <span className="text-emerald-600 dark:text-emerald-400">
              {generated}/{total}
            </span>
            {/* Progress bar */}
            <div className="w-16 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${total > 0 ? (generated / total) * 100 : 0}%` }}
              />
            </div>
          </div>
        </button>

        {/* Course-level generate buttons */}
        {!isCourseGenerating && (
          <div className="flex items-center gap-1 shrink-0 ml-2">
            {hasUngenerated && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2.5 text-xs rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800/30"
                onClick={(e) => {
                  e.stopPropagation();
                  onGenerateCourse(subjectCode, course, false);
                }}
              >
                <Sparkles className="size-3 mr-1" />
                {t('browse.generateAll')}
              </Button>
            )}
            {generated > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2.5 text-xs rounded-full text-muted-foreground/50 hover:text-foreground/70 hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={(e) => {
                  e.stopPropagation();
                  onGenerateCourse(subjectCode, course, true);
                }}
              >
                <RefreshCw className="size-3 mr-1" />
                {t('browse.regenerateAll')}
              </Button>
            )}
          </div>
        )}
        {isCourseGenerating && (
          <span className="shrink-0 ml-2 inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
            <Loader2 className="size-3 animate-spin mr-1" />
            {t('browse.generating')}
          </span>
        )}
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 pt-1 space-y-2 ml-7">
              {course.lessons.map((lesson, i) => (
                <LessonCard
                  key={lesson.id}
                  lesson={lesson}
                  index={i}
                  subjectCode={subjectCode}
                  courseId={course.id}
                  courseTitle={course.title}
                  onView={onViewLesson}
                  onGenerate={onGenerateLesson}
                  loading={loadingLesson === lesson.id}
                  generating={generatingLessons.has(lesson.id)}
                  t={t}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lesson card
// ---------------------------------------------------------------------------

function LessonCard({
  lesson,
  index,
  subjectCode,
  courseId,
  courseTitle,
  onView,
  onGenerate,
  loading,
  generating,
  t,
}: {
  lesson: SubjectIndexLesson;
  index: number;
  subjectCode: string;
  courseId: string;
  courseTitle: string;
  onView: (subjectCode: string, courseId: string, lesson: SubjectIndexLesson) => void;
  onGenerate: (
    subjectCode: string,
    courseId: string,
    courseTitle: string,
    lesson: SubjectIndexLesson,
  ) => void;
  loading: boolean;
  generating: boolean;
  t: (key: string) => string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.25, ease: 'easeOut' }}
      className={cn(
        'group flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-200',
        lesson.generated
          ? 'border-border/30 bg-white/80 dark:bg-slate-800/60 hover:shadow-md hover:border-brand-200 dark:hover:border-brand-800 cursor-pointer'
          : generating
            ? 'border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/20'
            : 'border-border/20 bg-slate-50/50 dark:bg-slate-900/40',
      )}
      onClick={() => lesson.generated && onView(subjectCode, courseId, lesson)}
    >
      {/* Status icon */}
      <div className="shrink-0">
        {generating ? (
          <Loader2 className="size-4 text-amber-500 animate-spin" />
        ) : lesson.generated ? (
          <CircleCheck className="size-4 text-emerald-500" />
        ) : (
          <CircleDashed className="size-4 text-muted-foreground/30" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground/40 font-mono shrink-0">
            L{lesson.lesson}
          </span>
          <span
            className={cn(
              'text-sm truncate',
              lesson.generated
                ? 'font-medium text-foreground/90'
                : generating
                  ? 'font-medium text-amber-700 dark:text-amber-300'
                  : 'text-muted-foreground/50',
            )}
          >
            {lesson.title}
          </span>
        </div>
        {generating ? (
          <p className="text-xs text-amber-600/60 dark:text-amber-400/60 mt-0.5 ml-7">
            {t('browse.generating')}
          </p>
        ) : (
          lesson.objective && (
            <p className="text-xs text-muted-foreground/40 mt-0.5 truncate ml-7">
              {lesson.objective}
            </p>
          )
        )}
      </div>

      {/* Right side */}
      <div className="shrink-0 flex items-center gap-2">
        {lesson.generated && lesson.scenesCount != null && (
          <span className="text-xs text-muted-foreground/40">
            {lesson.scenesCount} {t('browse.scenesCount')}
          </span>
        )}
        {lesson.generated && !generating && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-3 text-xs rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/50 hover:text-foreground/70 hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={(e) => {
              e.stopPropagation();
              onGenerate(subjectCode, courseId, courseTitle, lesson);
            }}
          >
            <RefreshCw className="size-3" />
          </Button>
        )}
        {lesson.generated && !generating && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-3 text-xs rounded-full opacity-0 group-hover:opacity-100 transition-opacity bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 hover:bg-brand-200 dark:hover:bg-brand-800/40"
            disabled={loading}
            onClick={(e) => {
              e.stopPropagation();
              onView(subjectCode, courseId, lesson);
            }}
          >
            {loading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              t('browse.viewLesson')
            )}
          </Button>
        )}
        {!lesson.generated && !generating && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-3 text-xs rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800/30"
            onClick={(e) => {
              e.stopPropagation();
              onGenerate(subjectCode, courseId, courseTitle, lesson);
            }}
          >
            <Sparkles className="size-3 mr-1" />
            {t('browse.generate')}
          </Button>
        )}
        {generating && (
          <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
            {t('browse.generating')}
          </span>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Subject pill
// ---------------------------------------------------------------------------

function SubjectPill({
  subject,
  index,
  selected,
  onClick,
  isUserGenerated,
  t,
}: {
  subject: SubjectEntry;
  index: number;
  selected: boolean;
  onClick: () => void;
  isUserGenerated?: boolean;
  t: (key: string) => string;
}) {
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.2 + index * 0.05 }}
      onClick={onClick}
      className={cn(
        'group relative flex flex-col items-start px-5 py-4 rounded-2xl border transition-all duration-200',
        selected
          ? 'border-brand-300 dark:border-brand-700 bg-white/90 dark:bg-slate-800/90 shadow-lg shadow-brand-500/[0.08]'
          : 'border-border/40 bg-white/60 dark:bg-slate-900/60 hover:bg-white/80 dark:hover:bg-slate-800/80 hover:shadow-md',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground/90">
          {subject.name}
        </span>
        {isUserGenerated && (
          <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground/50 uppercase tracking-wider">
            user
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground/60">
        <span>{subject.courseCount} {t('browse.courses')}</span>
        <span className="w-[1px] h-3 bg-border/50" />
        <span>{subject.lessonCount} {t('browse.lessons')}</span>
        <span className="w-[1px] h-3 bg-border/50" />
        <span className="text-emerald-600 dark:text-emerald-400">
          {subject.generatedCount} {t('browse.generated').toLowerCase()}
        </span>
      </div>
      {selected && (
        <motion.div
          layoutId="subject-indicator"
          className="absolute -bottom-[1px] left-4 right-4 h-0.5 bg-brand-500 rounded-full"
        />
      )}
    </motion.button>
  );
}
