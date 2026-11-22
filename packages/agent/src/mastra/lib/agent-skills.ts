/**
 * The chat agent's skills (Mastra agent `skills`): the FFmpeg know-how it loads only when a
 * job needs it, so it costs nothing on other turns. Each folder under packages/agent/skills
 * holds a SKILL.md and its references:
 *
 * - `team-ffmpeg-steps`: writing a team's own FFmpeg step (the compose request, formats, errors).
 * - `ffmpeg-video-edits` / `ffmpeg-audio-edits`: worked team steps, each tried on a real
 *   FFmpeg by packages/step-catalog/test/agent-skills.test.ts.
 *
 * These are Takewon's own, written for editing through the toolkit. The paid FFmpeg skills
 * plugin is a separate product and is not part of this repository.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { packageRelative } from '../../lib/env';

/** Where the skill folders are: packages/agent/skills here, /app/skills in the image. */
export const SKILLS_DIR = packageRelative('./skills');

/** Every skill folder (one with a SKILL.md), as absolute paths. */
export function chatSkillPaths(dir = SKILLS_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, 'SKILL.md')))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}
