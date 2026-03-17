// ABOUTME: API route to fetch a generated lesson from S3/local storage.
// Returns full classroom data + outlines for the client to load into IndexedDB.

import type { NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getBrowseStorage } from '@/lib/s3/storage';
import { persistClassroom } from '@/lib/server/classroom-storage';

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      subjectCode: string;
      courseId: string;
      lessonId: string;
    }>;
  },
) {
  try {
    const { subjectCode, courseId, lessonId } = await params;
    const storage = getBrowseStorage();

    const lesson = await storage.getLesson(subjectCode, courseId, lessonId);
    if (!lesson) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, `Lesson "${lessonId}" not found`);
    }

    // Try to persist locally (works on local dev, silently skipped on Vercel)
    try {
      const baseUrl = request.headers.get('x-forwarded-host')
        ? `${request.headers.get('x-forwarded-proto') || 'http'}://${request.headers.get('x-forwarded-host')}`
        : request.nextUrl.origin;

      await persistClassroom(
        { id: lesson.id, stage: lesson.stage, scenes: lesson.scenes },
        baseUrl,
      );
    } catch {
      // Read-only filesystem (Vercel) — client will load from the returned data
    }

    const outlines = (lesson as unknown as Record<string, unknown>).outlines ?? [];

    return apiSuccess({
      classroomId: lesson.id,
      stage: lesson.stage,
      scenes: lesson.scenes,
      scenesCount: lesson.scenes.length,
      createdAt: lesson.createdAt,
      outlines,
    });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to load lesson',
      error instanceof Error ? error.message : String(error),
    );
  }
}
