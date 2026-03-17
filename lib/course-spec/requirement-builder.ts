// ABOUTME: Converts a course spec lesson into a natural-sounding prompt
// that mimics how a human would describe what they want to learn

import type { FlatLesson } from './types';

/**
 * Build a natural, conversational requirement prompt from a course spec lesson.
 * Designed to sound like a human request rather than a structured template,
 * which produces better creative output from the LLM.
 */
export function buildRequirement(lesson: FlatLesson): string {
  const parts = [
    `Teach me about "${lesson.lessonTitle}" — ${lesson.objective.charAt(0).toLowerCase()}${lesson.objective.slice(1)}.`,
    '',
    `Here's the hook: ${lesson.scenario}`,
    '',
    `The big question to keep coming back to throughout the lesson: ${lesson.essentialQuestion}`,
    '',
    `This is part of "${lesson.courseTitle}" in the ${lesson.curriculum} curriculum (${lesson.levelName} level). Target audience: high school students.`,
    '',
    `Make it engaging and memorable. Use vivid, colorful images — detailed illustrations, infographics, diagrams, or photorealistic visuals that bring the concepts to life. Include interactive elements and a knowledge check. Keep the tone conversational, not textbook-like.`,
  ];

  return parts.join('\n');
}
