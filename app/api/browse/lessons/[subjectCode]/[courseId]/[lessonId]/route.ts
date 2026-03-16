// ABOUTME: API route to fetch a generated lesson and make it available
// to the classroom viewer. Downloads from S3/local, saves to local
// classrooms directory so /classroom/[id] can load it.

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
      return apiError(
        API_ERROR_CODES.INVALID_REQUEST,
        404,
        `Lesson "${lessonId}" not found`,
      );
    }

    // Persist to local classrooms directory so /classroom/[id] can load it
    const baseUrl =
      request.headers.get('x-forwarded-host')
        ? `${request.headers.get('x-forwarded-proto') || 'http'}://${request.headers.get('x-forwarded-host')}`
        : request.nextUrl.origin;

    await persistClassroom(
      {
        id: lesson.id,
        stage: lesson.stage,
        scenes: lesson.scenes,
      },
      baseUrl,
    );

    // Return outlines if available (needed for client-side media generation)
    const outlines = (lesson as unknown as Record<string, unknown>).outlines ?? [];

    return apiSuccess({
      classroomId: lesson.id,
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
