// ABOUTME: API route to seed the browse index from a course spec file
// POST with { specPath } — reads the spec, builds subject index, saves it
// This makes the course structure available in the browse UI before generation

import type { NextRequest } from 'next/server';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { buildSubjectIndex, buildSubjectsManifest } from '@/lib/course-spec/parser';
import type { CourseSpec } from '@/lib/course-spec/types';
import { getBrowseStorage } from '@/lib/s3/storage';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { specPath } = body;

    if (!specPath) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required field: specPath',
      );
    }

    const fullPath = resolve(specPath);
    const raw = readFileSync(fullPath, 'utf-8');
    const spec: CourseSpec = JSON.parse(raw);

    const storage = getBrowseStorage();

    // Build index, merging with existing if available
    const existing = await storage.getSubjectIndex(spec.config.subjectCode);
    const index = buildSubjectIndex(spec, existing ?? undefined);
    await storage.saveSubjectIndex(index);

    // Rebuild manifest with all known subjects
    const codes = await storage.listSubjectCodes();
    const allIndices = [index];
    for (const code of codes) {
      if (code === spec.config.subjectCode) continue;
      const other = await storage.getSubjectIndex(code);
      if (other) allIndices.push(other);
    }
    const manifest = buildSubjectsManifest(allIndices);
    await storage.saveSubjectsManifest(manifest);

    let lessonCount = 0;
    let courseCount = 0;
    for (const level of index.levels) {
      courseCount += level.courses.length;
      for (const course of level.courses) {
        lessonCount += course.lessons.length;
      }
    }

    return apiSuccess({
      subjectCode: spec.config.subjectCode,
      curriculum: spec.curriculum,
      courseCount,
      lessonCount,
    });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to seed browse index',
      error instanceof Error ? error.message : String(error),
    );
  }
}
