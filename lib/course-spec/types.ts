// ABOUTME: TypeScript types for course specification JSON files
// Used to parse curriculum specs from course-specs/conceptual/

export interface CourseSpecLesson {
  id: string;
  lesson: number;
  title: string;
  objective: string;
  essential_question: string;
  scenario: string;
}

export interface CourseSpecCourse {
  id: string;
  course: number;
  code: string;
  title: string;
  lessons: CourseSpecLesson[];
}

export interface CourseSpecLevel {
  level: string;
  name: string;
  courses: CourseSpecCourse[];
}

export interface CourseSpecConfig {
  subjectCode: string;
  levelCefrMapping: Record<string, string>;
  topics: string[];
}

export interface CourseSpec {
  updatedAt: string;
  curriculum: string;
  config: CourseSpecConfig;
  levels: CourseSpecLevel[];
}

/** Flat representation of a lesson with its full hierarchy context */
export interface FlatLesson {
  subjectCode: string;
  curriculum: string;
  levelCode: string;
  levelName: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  lessonId: string;
  lessonNumber: number;
  lessonTitle: string;
  objective: string;
  essentialQuestion: string;
  scenario: string;
}

/** Subject index stored in S3 / locally */
export interface SubjectIndex {
  subjectCode: string;
  curriculum: string;
  updatedAt: string;
  levels: SubjectIndexLevel[];
}

export interface SubjectIndexLevel {
  level: string;
  name: string;
  courses: SubjectIndexCourse[];
}

export interface SubjectIndexCourse {
  id: string;
  code: string;
  title: string;
  lessons: SubjectIndexLesson[];
}

export interface SubjectIndexLesson {
  id: string;
  lesson: number;
  title: string;
  objective: string;
  generated: boolean;
  generatedAt?: string;
  classroomId?: string;
  scenesCount?: number;
}

/** Top-level subjects manifest */
export interface SubjectsManifest {
  subjects: SubjectEntry[];
  updatedAt: string;
}

export interface SubjectEntry {
  code: string;
  name: string;
  courseCount: number;
  lessonCount: number;
  generatedCount: number;
}
