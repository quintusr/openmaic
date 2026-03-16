// ABOUTME: API routes for persisting TTS audio to S3/local storage
// POST: upload audio blob  |  GET: download audio blob

import type { NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getBrowseStorage } from '@/lib/s3/storage';
import { NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const subjectCode = formData.get('subjectCode') as string;
    const courseId = formData.get('courseId') as string;
    const lessonId = formData.get('lessonId') as string;
    const audioId = formData.get('audioId') as string;
    const file = formData.get('file') as File;

    if (!subjectCode || !courseId || !lessonId || !audioId || !file) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required fields',
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const storage = getBrowseStorage();
    await storage.saveAudio(
      subjectCode,
      courseId,
      lessonId,
      audioId,
      bytes,
      file.type || 'audio/mpeg',
    );

    return apiSuccess({ audioId });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to save audio',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const subjectCode = searchParams.get('subjectCode');
    const courseId = searchParams.get('courseId');
    const lessonId = searchParams.get('lessonId');
    const audioId = searchParams.get('audioId');

    if (!subjectCode || !courseId || !lessonId || !audioId) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required params',
      );
    }

    const storage = getBrowseStorage();
    const result = await storage.getAudio(
      subjectCode,
      courseId,
      lessonId,
      audioId,
    );

    if (!result) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Audio not found');
    }

    return new NextResponse(Buffer.from(result.bytes), {
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to load audio',
      error instanceof Error ? error.message : String(error),
    );
  }
}
