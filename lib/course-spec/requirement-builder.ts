// ABOUTME: Converts a course spec lesson into an OpenMAIC UserRequirements prompt
// Composes title, objective, essential question, and scenario into rich context

import type { FlatLesson } from './types';

/**
 * Build a rich requirement prompt from a course spec lesson.
 *
 * The prompt gives the LLM enough context to generate a focused,
 * engaging interactive lesson.
 */
export function buildRequirement(lesson: FlatLesson): string {
  const parts = [
    `Create an interactive lesson: "${lesson.lessonTitle}"`,
    '',
    `This is part of the course "${lesson.courseTitle}" (${lesson.courseCode}) ` +
      `in the "${lesson.curriculum}" curriculum, at the "${lesson.levelName}" level.`,
    '',
    `Learning Objective: ${lesson.objective}`,
    '',
    `Essential Question: ${lesson.essentialQuestion}`,
    '',
    `Scenario to ground the lesson:`,
    lesson.scenario,
    '',
    `Guidelines:`,
    `- Target audience: high school students`,
    `- Make it engaging and thought-provoking`,
    `- Use the scenario to make abstract concepts tangible`,
    `- Include a mix of explanation slides, interactive elements, and assessment`,
    `- The essential question should be woven throughout as a recurring theme`,
  ];

  return parts.join('\n');
}
