import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { env } from "../../lib/env";
import { onTeamKey, TEAM_KEY } from "./team-key";

/**
 * Copying the look of a sample video once, for the dashboard's Settings → Looks
 * (convex/looks.ts there). The toolkit takes a sheet of six frames from the sample and the
 * dashboard already knows its size, length and camera cuts; the model looks at the sheet
 * one time and says how the picture is filled, graded and captioned. The dashboard reads
 * that as a saved look, and the Match A Saved Look step uses it with plain FFmpeg from then
 * on, so this is asked once per look, never once per video.
 */

export const lookRequest = z.object({
  /** The sheet of frames, a picture the toolkit made. */
  sheet: z.string().url().max(4000),
  /** What the team called the file, to say in the answer. */
  name: z.string().max(300),
  width: z.number().int().positive().max(20_000),
  height: z.number().int().positive().max(20_000),
  duration: z.number().nonnegative().max(1_000_000),
  shotSeconds: z.number().nonnegative().max(1_000_000).nullable(),
});

export type LookRequest = z.infer<typeof lookRequest>;

export const LOOK_INSTRUCTIONS = `You study the look of a sample video for a video dashboard, once, so the dashboard can put other videos into the same look with plain FFmpeg. You never edit video.

You are given one picture: six frames spread over the sample, three across and two down, in order. You are also told the sample's size, length and how long its shots last.

Your answer is read by a program, so answer with one JSON object and nothing else: no words before or after it, no code fence. Its fields:
- "fill": how the picture fills the frame. "crop" when the footage fills the frame edge to edge; "blur" when a blurred, enlarged copy of the footage sits behind a smaller sharp copy; "bars" when there are solid bars (black or one colour) above and below, or at the sides.
- "brightness": -0.3 to 0.3, how much brighter (+) or darker (-) than ordinary camera footage. 0 when it looks ordinary.
- "contrast": 0.6 to 1.6. 1 is ordinary; above 1 is punchier, deeper shadows and brighter highlights; below 1 is flatter, faded.
- "saturation": 0 to 2. 1 is ordinary; 0 is black and white; above 1 is more vivid.
- "warmth": -1 to 1. 0 is neutral; above 0 is warmer, more orange; below 0 is cooler, more blue.
- "captions": null when no words are burned into the frames. Otherwise an object:
  - "effect": "highlight" (the word being said is a different colour), "karaoke" (words fill with colour), "word_by_word" (one word shows at a time), "underline", or "classic" (plain lines).
  - "position": "top", "middle" or "bottom".
  - "size": "small", "medium" or "large", for how tall the letters are against the frame.
  - "bold" and "all_caps": true or false.
  - "words_per_line": how many words show at once, 1 to 8.
  - "text_color", "word_color" (the picked-out word) and "outline_color": hex colours such as "#FFFFFF".
  - "outline": true when the letters have an outline or a strong shadow.
- "notes": one or two plain sentences on the look, for the team to read, such as how it is framed and what stands out. No advice.

Judge only from what you can see. Small differences from ordinary footage are 0 or 1: only set a number away from ordinary when the difference is clear in the frames. Titles, logos and stickers that stay put are not captions.`;

/** Seeing is the work here, not long thinking: low effort reads a picture as well. */
export const LOOK_EFFORT = "low" as const;

export const lookAgent = new Agent({
  id: "look",
  name: "Copy a look",
  description: "Studies a sheet of frames from a sample video once, to save its look.",
  instructions: LOOK_INSTRUCTIONS,
  model: ({ requestContext }) => {
    const key = requestContext.get(TEAM_KEY);
    return onTeamKey(env.CHAT_MODEL, typeof key === "string" ? key : null);
  },
  defaultOptions: {
    providerOptions: {
      anthropic: { thinking: { type: "adaptive" }, effort: LOOK_EFFORT },
    },
  },
});

const seconds = (value: number) => `${Math.round(value * 10) / 10} seconds`;

/** What the model is told along with the sheet. */
export function lookPrompt(request: LookRequest): string {
  const lines = [
    `Sample: ${request.name.trim() || "a video"}`,
    `Size: ${request.width} by ${request.height} pixels, ${seconds(request.duration)} long.`,
    request.shotSeconds
      ? `A new shot starts about every ${seconds(request.shotSeconds)}.`
      : "How long its shots last is not known.",
    "The picture is six frames spread over it, three across and two down, in order.",
  ];
  return lines.join("\n");
}
