// ABOUTME: Classifies a homepage-generated classroom into a subject folder
// using an LLM, then uploads it to S3 in the same structure as course spec lessons.
// POST { classroomId, requirement }

import type { NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { readClassroom } from '@/lib/server/classroom-storage';
import { resolveModel } from '@/lib/server/resolve-model';
import { parseModelString } from '@/lib/ai/providers';
import { resolveApiKey } from '@/lib/server/provider-config';
import { callLLM } from '@/lib/ai/llm';
import { getBrowseStorage } from '@/lib/s3/storage';
import { buildSubjectsManifest } from '@/lib/course-spec/parser';
import type { PersistedClassroomData } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('ClassifyAndUpload');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { classroomId, requirement } = body;

    if (!classroomId || !requirement) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required fields: classroomId, requirement',
      );
    }

    // Read the persisted classroom
    const classroom = await readClassroom(classroomId);
    if (!classroom) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }

    // Use LLM to classify into a subject folder
    const { model: languageModel, modelInfo, modelString } = resolveModel({});
    const { providerId } = parseModelString(modelString);
    const apiKey = resolveApiKey(providerId);

    if (!apiKey) {
      return apiError(
        API_ERROR_CODES.MISSING_API_KEY,
        400,
        `No API key for provider "${providerId}"`,
      );
    }

    const classifyResult = await callLLM(
      {
        model: languageModel,
        messages: [
          {
            role: 'system',
            content: `You classify educational content into subject categories.
Given a lesson description, return a JSON object with:
- "subjectCode": An UPPER_SNAKE_CASE folder name (e.g. "QUANTUM_PHYSICS", "WORLD_HISTORY", "COOKING", "MUSIC_THEORY", "MACHINE_LEARNING"). Keep it concise (1-3 words). Use underscores for spaces.
- "subjectName": A human-readable name (e.g. "Quantum Physics", "World History", "Cooking", "Music Theory")
- "courseId": A kebab-case ID for the course/topic (e.g. "intro-to-quantum-physics", "french-cooking-basics")
- "courseTitle": A human-readable course title
- "lessonId": A kebab-case ID for this specific lesson (e.g. "wave-particle-duality", "making-a-roux")
- "lessonTitle": The lesson title

Return ONLY valid JSON, no markdown.`,
          },
          {
            role: 'user',
            content: `Classify this lesson:\n\n${requirement.slice(0, 1000)}`,
          },
        ],
        maxOutputTokens: modelInfo?.outputWindow,
      },
      'classify-lesson',
    );

    let classification: {
      subjectCode: string;
      subjectName: string;
      courseId: string;
      courseTitle: string;
      lessonId: string;
      lessonTitle: string;
    };

    try {
      const text = classifyResult.text.replace(/```json\n?|\n?```/g, '').trim();
      classification = JSON.parse(text);
    } catch {
      // Fallback classification
      const slug = requirement
        .slice(0, 50)
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .toLowerCase();
      classification = {
        subjectCode: 'GENERAL',
        subjectName: 'General',
        courseId: slug,
        courseTitle: requirement.slice(0, 80),
        lessonId: `${slug}-lesson`,
        lessonTitle: classroom.stage.name || requirement.slice(0, 80),
      };
    }

    // Append classroomId to lessonId for uniqueness — prevents overwriting
    // when multiple users generate lessons about the same topic
    const uniqueLessonId = `${classification.lessonId}-${classroomId}`;
    const { subjectCode, subjectName, courseId, courseTitle, lessonTitle } = classification;
    const lessonId = uniqueLessonId;
    log.info(`Classified as: ${subjectCode} / ${courseId} / ${lessonId}`);

    // Save classroom data to browse storage
    const storage = getBrowseStorage();

    const classroomData: PersistedClassroomData = {
      id: classroom.id,
      stage: classroom.stage,
      scenes: classroom.scenes,
      createdAt: classroom.createdAt,
    };
    await storage.saveLesson(subjectCode, courseId, lessonId, classroomData);

    // Update or create the subject index
    let index = await storage.getSubjectIndex(subjectCode);
    if (!index) {
      index = {
        subjectCode,
        curriculum: subjectName,
        updatedAt: new Date().toISOString(),
        levels: [
          {
            level: 'L1',
            name: subjectName,
            courses: [],
          },
        ],
      };
    }

    // Find or create the course in the index
    const level = index.levels[0];
    let course = level.courses.find((c) => c.id === courseId);
    if (!course) {
      course = {
        id: courseId,
        code: subjectCode.slice(0, 3),
        title: courseTitle,
        lessons: [],
      };
      level.courses.push(course);
    }

    // Find or create the lesson entry
    const existing = course.lessons.find((l) => l.id === lessonId);
    if (existing) {
      existing.generated = true;
      existing.generatedAt = classroom.createdAt;
      existing.classroomId = classroom.id;
      existing.scenesCount = classroom.scenes.length;
    } else {
      course.lessons.push({
        id: lessonId,
        lesson: course.lessons.length + 1,
        title: lessonTitle,
        objective: requirement.slice(0, 200),
        generated: true,
        generatedAt: classroom.createdAt,
        classroomId: classroom.id,
        scenesCount: classroom.scenes.length,
      });
    }

    index.updatedAt = new Date().toISOString();
    await storage.saveSubjectIndex(index);

    // Rebuild subjects manifest
    const codes = await storage.listSubjectCodes();
    const allIndices = [index];
    for (const code of codes) {
      if (code === subjectCode) continue;
      const other = await storage.getSubjectIndex(code);
      if (other) allIndices.push(other);
    }
    await storage.saveSubjectsManifest(buildSubjectsManifest(allIndices));

    log.info(`Uploaded to S3: ${subjectCode}/${courseId}/${lessonId}`);

    return apiSuccess({
      subjectCode,
      subjectName,
      courseId,
      lessonId,
    });
  } catch (error) {
    log.error('Failed to classify and upload:', error);
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to classify and upload',
      error instanceof Error ? error.message : String(error),
    );
  }
}
