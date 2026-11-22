import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chatAgent } from '../../src/mastra/agents/chat';
import { chatSkillPaths, SKILLS_DIR } from '../../src/mastra/lib/agent-skills';
import {
  AUTO_ALLOWED_TOOLS,
  resolveToolCategory as toolCategory,
} from '../../src/mastra/lib/tool-categories';
import { TEAM_STEP_INSTRUCTIONS } from '../../src/mastra/ncat/team-steps';

/**
 * The chat agent's FFmpeg skills (lib/agent-skills.ts). Their worked steps are run on a
 * real FFmpeg in packages/step-catalog/test/agent-skills.test.ts.
 */

const SKILLS = ['ffmpeg-audio-edits', 'ffmpeg-video-edits', 'team-ffmpeg-steps'];

describe("the chat agent's skills", () => {
  it('are the three FFmpeg skill folders in packages/agent/skills', () => {
    expect(SKILLS_DIR).toBe(path.resolve(__dirname, '../../skills'));
    expect(chatSkillPaths().map((p) => path.basename(p))).toEqual(SKILLS);
  });

  it('only counts folders with a SKILL.md, and none when the folder is missing', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skills-'));
    try {
      await mkdir(path.join(dir, 'real'));
      await writeFile(path.join(dir, 'real', 'SKILL.md'), '---\nname: real\ndescription: x\n---\n');
      await mkdir(path.join(dir, 'empty'));
      await writeFile(path.join(dir, 'notes.md'), 'x');
      expect(chatSkillPaths(dir)).toEqual([path.join(dir, 'real')]);
      expect(chatSkillPaths(path.join(dir, 'missing'))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('are loaded by Mastra with their names and descriptions', async () => {
    const skills = await chatAgent.listSkills();
    expect(skills.map((skill) => skill.name).sort()).toEqual(SKILLS);
    for (const skill of skills) expect(skill.description.length).toBeGreaterThan(40);
    const team = await chatAgent.getSkill('team-ffmpeg-steps');
    expect(team?.instructions).toContain('/v1/ffmpeg/compose');
    expect(team?.references).toEqual(expect.arrayContaining(['compose-request.md', 'errors.md']));
  });

  it('are read without asking, like other lookups', () => {
    for (const tool of ['skill', 'skill_search', 'skill_read']) {
      expect(toolCategory(tool)).toBe('read');
      expect(AUTO_ALLOWED_TOOLS).toContain(tool);
    }
  });

  it('are where the team-step instructions send the agent first', () => {
    expect(TEAM_STEP_INSTRUCTIONS).toContain('team-ffmpeg-steps skill');
  });
});
