// ABOUTME: API routes for persisting generated media (images) to S3/local storage
// POST: upload media blob  |  GET: download media blob

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
    const mediaId = formData.get('mediaId') as string;
    const file = formData.get('file') as File;

    if (!subjectCode || !courseId || !lessonId || !mediaId || !file) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required fields',
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const storage = getBrowseStorage();
    await storage.saveMedia(
      subjectCode,
      courseId,
      lessonId,
      mediaId,
      bytes,
      file.type || 'image/png',
    );

    return apiSuccess({ mediaId });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to save media',
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
    const mediaId = searchParams.get('mediaId');

    if (!subjectCode || !courseId || !lessonId || !mediaId) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required params',
      );
    }

    const storage = getBrowseStorage();
    const result = await storage.getMedia(
      subjectCode,
      courseId,
      lessonId,
      mediaId,
    );

    if (!result) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Media not found');
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
      'Failed to load media',
      error instanceof Error ? error.message : String(error),
    );
  }
}
