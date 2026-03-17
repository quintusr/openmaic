// ABOUTME: Parses course specification JSON files into flat lesson lists
// and builds S3-compatible index structures

import type {
  CourseSpec,
  FlatLesson,
  SubjectIndex,
  SubjectIndexLesson,
  SubjectsManifest,
  SubjectEntry,
} from './types';

/**
 * Parse a course spec and return a flat list of all lessons
 * with their full hierarchy context.
 */
export function flattenLessons(spec: CourseSpec): FlatLesson[] {
  const lessons: FlatLesson[] = [];
  const { config, curriculum } = spec;

  for (const level of spec.levels) {
    for (const course of level.courses) {
      for (const lesson of course.lessons) {
        lessons.push({
          subjectCode: config.subjectCode,
          curriculum,
          levelCode: level.level,
          levelName: level.name,
          courseId: course.id,
          courseCode: course.code,
          courseTitle: course.title,
          lessonId: lesson.id,
          lessonNumber: lesson.lesson,
          lessonTitle: lesson.title,
          objective: lesson.objective,
          essentialQuestion: lesson.essential_question,
          scenario: lesson.scenario,
        });
      }
    }
  }

  return lessons;
}

/**
 * Build a SubjectIndex from a course spec.
 * Optionally merge with existing generation status.
 */
export function buildSubjectIndex(spec: CourseSpec, existing?: SubjectIndex): SubjectIndex {
  const existingLessons = new Map<string, SubjectIndexLesson>();
  if (existing) {
    for (const level of existing.levels) {
      for (const course of level.courses) {
        for (const lesson of course.lessons) {
          existingLessons.set(lesson.id, lesson);
        }
      }
    }
  }

  return {
    subjectCode: spec.config.subjectCode,
    curriculum: spec.curriculum,
    updatedAt: new Date().toISOString(),
    levels: spec.levels.map((level) => ({
      level: level.level,
      name: level.name,
      courses: level.courses.map((course) => ({
        id: course.id,
        code: course.code,
        title: course.title,
        lessons: course.lessons.map((lesson) => {
          const prev = existingLessons.get(lesson.id);
          return {
            id: lesson.id,
            lesson: lesson.lesson,
            title: lesson.title,
            objective: lesson.objective,
            generated: prev?.generated ?? false,
            generatedAt: prev?.generatedAt,
            classroomId: prev?.classroomId,
            scenesCount: prev?.scenesCount,
          };
        }),
      })),
    })),
  };
}

/**
 * Build a SubjectsManifest from multiple SubjectIndex objects.
 */
export function buildSubjectsManifest(indices: SubjectIndex[]): SubjectsManifest {
  const subjects: SubjectEntry[] = indices.map((idx) => {
    let courseCount = 0;
    let lessonCount = 0;
    let generatedCount = 0;

    for (const level of idx.levels) {
      courseCount += level.courses.length;
      for (const course of level.courses) {
        lessonCount += course.lessons.length;
        generatedCount += course.lessons.filter((l) => l.generated).length;
      }
    }

    return {
      code: idx.subjectCode,
      name: idx.curriculum,
      courseCount,
      lessonCount,
      generatedCount,
    };
  });

  return {
    subjects,
    updatedAt: new Date().toISOString(),
  };
}
