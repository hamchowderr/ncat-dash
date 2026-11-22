import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { env } from "../../lib/env";
import { onTeamKey, TEAM_KEY } from "./team-key";

/**
 * Translating a video's subtitles, for the dashboard's translations (convex/translations.ts
 * there). The dashboard sends the subtitle lines of a transcript it already has, a batch at
 * a time; the model answers with each line in the other language, and the dashboard puts
 * them back on the lines' own times. Each language of a video is asked for once and kept,
 * so this never runs again for the same video and language.
 */

export const translateRequest = z.object({
  /** The language to translate into, by name, such as "Spanish (Latin America)". */
  language: z.string().min(1).max(80),
  /** What the video is called, so names and the subject read right. */
  title: z.string().max(300).default(""),
  /** The subtitle lines, in order. */
  lines: z.array(z.string().max(2000)).min(1).max(200),
  /** A few lines said just before these, for sense only; not translated. */
  before: z.array(z.string().max(2000)).max(10).default([]),
});

export type TranslateRequest = z.infer<typeof translateRequest>;

export const TRANSLATE_INSTRUCTIONS = `You translate the subtitles of a video for a video dashboard. You never edit video.

You are given numbered subtitle lines in the order they are said. Translate each line into the language you are asked for, so a viewer who reads only the subtitles follows what is said.

Your answer is read by a program, so answer with one JSON list of strings and nothing else: no words before or after it, no code fence. The list has exactly one string for each numbered line, in the same order, without the numbers. Never join two lines into one or split one line into two, even when a sentence runs across lines: the times of each line stay as they are, so each string should hold what is said in that line.

Translate the meaning naturally, as a good subtitler would, in the register of the speaker. Keep each line about as short as the original, because it is read on screen in the same time. Keep names of people, brands and products as they are. Keep numbers as numbers. Do not add notes, explanations or anything that was not said. When a line is only a sound or a word with no meaning, such as "Um", give the nearest natural equivalent or keep it.`;

export const translateAgent = new Agent({
  id: "translate",
  name: "Translate subtitles",
  description: "Translates a video's subtitle lines into another language, line for line.",
  instructions: TRANSLATE_INSTRUCTIONS,
  // Line-for-line translation needs no long thinking: the cheaper model does it well.
  model: ({ requestContext }) => {
    const key = requestContext.get(TEAM_KEY);
    return onTeamKey(translateModel(), typeof key === "string" ? key : null);
  },
});

/** The model translations are asked of: the cheaper one, unless it is turned off. */
export function translateModel(): string {
  return env.SIMPLE_CHAT_MODEL || env.CHAT_MODEL;
}

/** What the model is told along with the lines. */
export function translatePrompt(request: TranslateRequest): string {
  const lines = [
    `Translate these subtitle lines into ${request.language}.`,
    request.title.trim() ? `The video is called: ${request.title.trim()}` : "",
    request.before.length
      ? `Said just before, for sense only (do not translate these):\n${request.before.join("\n")}`
      : "",
    `Lines (${request.lines.length}):`,
    ...request.lines.map((line, index) => `${index + 1}. ${line}`),
  ];
  return lines.filter((line) => line !== "").join("\n");
}
