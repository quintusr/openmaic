// ABOUTME: API route to list available subjects from S3/local storage

import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getBrowseStorage } from '@/lib/s3/storage';

export async function GET() {
  try {
    const storage = getBrowseStorage();

    const hasAws = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
    const s3Connected = storage.hasS3;

    const manifest = await storage.getSubjectsManifest();

    if (manifest) {
      return apiSuccess({
        subjects: manifest.subjects,
        updatedAt: manifest.updatedAt,
        _debug: { hasAws, s3Connected: storage.hasS3 },
      });
    }

    // If no manifest, try to discover subjects from S3/local
    const codes = await storage.listSubjectCodes();
    const subjects = [];

    for (const code of codes) {
      const index = await storage.getSubjectIndex(code);
      if (index) {
        let courseCount = 0;
        let lessonCount = 0;
        let generatedCount = 0;
        for (const level of index.levels) {
          courseCount += level.courses.length;
          for (const course of level.courses) {
            lessonCount += course.lessons.length;
            generatedCount += course.lessons.filter((l) => l.generated).length;
          }
        }
        subjects.push({
          code: index.subjectCode,
          name: index.curriculum,
          courseCount,
          lessonCount,
          generatedCount,
        });
      }
    }

    return apiSuccess({
      subjects,
      updatedAt: new Date().toISOString(),
      _debug: { hasAws, s3Connected: storage.hasS3, subjectCodes: codes },
    });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to list subjects',
      error instanceof Error ? error.message : String(error),
    );
  }
}
