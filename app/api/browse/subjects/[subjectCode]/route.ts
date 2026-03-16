// ABOUTME: API route to get course/lesson index for a specific subject

import type { NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getBrowseStorage } from '@/lib/s3/storage';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ subjectCode: string }> },
) {
  try {
    const { subjectCode } = await params;
    const storage = getBrowseStorage();
    const index = await storage.getSubjectIndex(subjectCode);

    if (!index) {
      return apiError(
        API_ERROR_CODES.INVALID_REQUEST,
        404,
        `Subject "${subjectCode}" not found`,
      );
    }

    return apiSuccess({ index });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to load subject index',
      error instanceof Error ? error.message : String(error),
    );
  }
}
