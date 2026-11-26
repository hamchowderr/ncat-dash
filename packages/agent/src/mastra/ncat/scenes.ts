import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { env } from "../../lib/env";
import { onTeamKey, TEAM_KEY } from "./team-key";

/**
 * Suggesting scenes for a storyboard, once, when someone presses "Suggest scenes" on it in
 * the dashboard (convex/storyboards.ts there). A storyboard drafted from an upload starts
 * with every line Full Screen and chapters named from their first line; the model reads the
 * lines and says which ones are better shown another way, and gives each chapter a short
 * name. The dashboard checks the answer and changes only the scenes and names it can read.
 * Nothing runs unless the button is pressed, so no AI is spent by default.
 */

export const SCENES = ["full", "panel", "centre", "graphic", "circle"] as const;

export const scenesRequest = z.object({
  /** Where the storyboard's lines came from, such as "Drafted from lesson.mp4". */
  name: z.string().max(300),
  aspect: z.enum(["16:9", "9:16", "1:1", "4:5"]),
  /** The video's own brief: pacing and direction written by the team. */
  brief: z.string().max(2000).default(""),
  chapters: z
    .array(
      z.object({
        title: z.string().max(200),
        lines: z
          .array(z.object({ n: z.number().int().positive(), line: z.string().max(600) }))
          .max(400),
      }),
    )
    .min(1)
    .max(60),
});

export type ScenesRequest = z.infer<typeof scenesRequest>;

export const SCENES_INSTRUCTIONS = `You plan the scenes of a video storyboard for a video dashboard. The video is someone talking to camera; each numbered line is a sentence they say, in order, grouped into chapters. You never edit video.

Every line starts as "full". For each line, pick how it is best shown:
- "full": the speaker filling the frame. The default, and right for most lines: stories, opinions, anything personal.
- "panel": the speaker boxed to one side with points shown beside them. For a list, steps, numbers or a definition.
- "centre": the speaker in the middle with one side each for a comparison. For "this versus that", before and after.
- "graphic": only a graphic, no camera, while the line is heard. For a date, a quote, a chart, a screen or a page being described.
- "circle": a small circle of the speaker over a graphic or a screen. For walking through something on screen.

Keep it varied but calm: most lines stay "full", and a change of scene should help the viewer follow. Give each chapter a short name of two to six words, in sentence case, saying what it is about, not starting with "Chapter".

Your answer is read by a program, so answer with one JSON object and nothing else: no words before or after it, no code fence. Its fields:
- "chapters": one entry for each chapter, in order: { "title": "Short name" }.
- "scenes": only the lines that should not be "full": [{ "n": 12, "scene": "panel" }], where n is the line's number.`;

/** Reading lines and picking among five scenes needs little thinking. */
export const SCENES_EFFORT = "low" as const;

export const scenesAgent = new Agent({
  id: "scenes",
  name: "Suggest scenes",
  description: "Suggests the scene for each line of a storyboard and names its chapters.",
  instructions: SCENES_INSTRUCTIONS,
  model: ({ requestContext }) => {
    const key = requestContext.get(TEAM_KEY);
    return onTeamKey(env.CHAT_MODEL, typeof key === "string" ? key : null);
  },
  defaultOptions: {
    providerOptions: {
      anthropic: { thinking: { type: "adaptive" }, effort: SCENES_EFFORT },
    },
  },
});

/** What the model is told: the storyboard's shape, then its chapters and numbered lines. */
export function scenesPrompt(request: ScenesRequest): string {
  const lines = [
    `Storyboard: ${request.name.trim() || "a talking video"}`,
    `Shape: ${request.aspect}${request.aspect === "9:16" ? " (upright, for phones)" : ""}.`,
  ];
  if (request.brief.trim()) {
    lines.push(
      "",
      "The brief for this video (pacing and direction from the team; follow it where it applies):",
      request.brief.trim(),
    );
  }
  request.chapters.forEach((chapter, index) => {
    lines.push("", `Chapter ${index + 1}: ${chapter.title.trim()}`);
    for (const line of chapter.lines) lines.push(`${line.n}. ${line.line.trim()}`);
  });
  return lines.join("\n");
}
