import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { env } from "../../lib/env";
import { onTeamKey, TEAM_KEY } from "./team-key";

/**
 * Picking the best moments of a recording, and grouping one into chapters, for the
 * dashboard's Best moments and Chapters steps (convex/moments.ts there). The model only
 * reads the transcript and quotes what it picks; the dashboard finds each quote in the
 * transcript word for word and sets the clip's edges from the words' own timestamps, so
 * nothing here decides where a cut lands.
 */

const MAX_TRANSCRIPT = 200_000;

const momentSettings = z.object({
  count: z.number().int().min(1).max(20),
  minSeconds: z.number().min(0).max(1000),
  maxSeconds: z.number().min(1).max(1000),
  platform: z.string().max(100),
  topics: z.string().max(500).default(""),
  lookFor: z.string().max(1000).default(""),
});

const chapterSettings = z.object({
  count: z.number().int().min(0).max(30),
  bullets: z.number().int().min(0).max(6),
});

const brollSettings = z.object({
  /** At most this many cutaways. */
  count: z.number().int().min(1).max(40),
  /** Seconds kept on the speaker between two cutaways. */
  gap: z.number().min(0).max(120),
  /** Seconds at the start with no cutaway. */
  skipOpening: z.number().min(0).max(600),
  lookFor: z.string().max(1000).default(""),
});

const span = z.object({ start: z.number().finite(), end: z.number().finite() });

export const momentsRequest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("moments"),
    title: z.string().max(300).default(""),
    duration: z.number().finite().nonnegative(),
    transcript: z.string().min(1).max(MAX_TRANSCRIPT),
    settings: momentSettings,
    avoid: z.array(span).max(500).default([]),
    houseRules: z.string().max(2000).default(""),
  }),
  z.object({
    kind: z.literal("chapters"),
    title: z.string().max(300).default(""),
    duration: z.number().finite().nonnegative(),
    transcript: z.string().min(1).max(MAX_TRANSCRIPT),
    settings: chapterSettings,
    houseRules: z.string().max(2000).default(""),
  }),
  z.object({
    kind: z.literal("broll"),
    title: z.string().max(300).default(""),
    duration: z.number().finite().nonnegative(),
    transcript: z.string().min(1).max(MAX_TRANSCRIPT),
    settings: brollSettings,
    houseRules: z.string().max(2000).default(""),
  }),
]);

export type MomentsRequest = z.infer<typeof momentsRequest>;

export const MOMENTS_INSTRUCTIONS = `You read the transcript of a team's recording and pick from it, for a video dashboard. You never edit video: the dashboard cuts what you pick.

The transcript has one sentence a line, each with the time it starts, like "[1:05] And that is when it clicked.". Times are minutes:seconds.

Your answer is read by a program, so:
- Answer with one JSON object and nothing else: no words before or after it, no code fence.
- Every quote you give is copied exactly from the transcript, word for word, as one unbroken stretch: the same words in the same order, nothing added, left out, reworded or corrected. Leave out the [times]. A quote that is not in the transcript exactly is thrown away.`;

/**
 * How hard the model thinks when it picks. Left out, Claude Sonnet 5.5 thinks at high,
 * which reads a long transcript at length for a short answer; medium picks as well for
 * far fewer thinking tokens.
 */
export const MOMENTS_EFFORT = "medium" as const;

export const momentsAgent = new Agent({
  id: "moments",
  name: "Best moments",
  description:
    "Picks the best moments of a transcript, groups it into chapters, or plans its B-Roll.",
  instructions: MOMENTS_INSTRUCTIONS,
  // On the team's own Anthropic key when the dashboard sent the team and it has one.
  model: ({ requestContext }) => {
    const key = requestContext.get(TEAM_KEY);
    return onTeamKey(env.CHAT_MODEL, typeof key === "string" ? key : null);
  },
  defaultOptions: {
    providerOptions: {
      anthropic: { thinking: { type: "adaptive" }, effort: MOMENTS_EFFORT },
    },
  },
});

/** "1:05" or "1:02:03". */
export function clockTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** The request as one message for the model. */
export function momentsPrompt(request: MomentsRequest): string {
  const lines: string[] = [];
  const about = request.title ? `"${request.title}", ` : "";
  lines.push(`The recording: ${about}${clockTime(request.duration)} long.`);
  if (request.houseRules.trim()) {
    lines.push("", "The team's house rules:", request.houseRules.trim());
  }
  if (request.kind === "moments") {
    const s = request.settings;
    // A few more than asked for, best first, so a pick that cannot be used still leaves enough.
    const ask = Math.min(s.count + 3, 25);
    lines.push(
      "",
      `Pick up to ${ask} moments to post as clips on ${s.platform || "social media"}, best first. The team will use the best ${s.count}.`,
      `Each moment runs ${s.minSeconds} to ${s.maxSeconds} seconds: judge it from the times of the lines it covers. Moments never overlap.`,
      "A good moment stands on its own for someone who has not seen the rest: it opens with a line that makes people stay, makes one clear point or tells one story, and ends when that point lands, not in the middle of a thought.",
    );
    if (s.topics.trim()) lines.push(`Favour these subjects: ${s.topics.trim()}`);
    if (s.lookFor.trim()) lines.push(`What makes a good moment for this team: ${s.lookFor.trim()}`);
    if (request.avoid.length > 0) {
      lines.push(
        `These parts were already made into clips, so pick nothing that overlaps them: ${request.avoid
          .map((part) => `${clockTime(part.start)} to ${clockTime(part.end)}`)
          .join(", ")}.`,
      );
    }
    lines.push(
      "",
      'Answer as {"moments":[{"quote":"…","title":"…","why":"…"}]}: quote is the moment\'s words from its first word to its last; title is a short title for the clip, at most 8 words; why is one sentence on why it works.',
    );
  } else if (request.kind === "broll") {
    const s = request.settings;
    lines.push(
      "",
      `Plan B-Roll for this talking-head video: up to ${s.count} short cutaways, each a few seconds of footage shown while the speaker keeps talking.`,
      "Pick the moments where showing something helps: a place, an object, an action or an idea that can be filmed or found as stock footage. Skip moments that are about feelings or opinions with nothing to show, and keep the strongest lines of the speaker on their face.",
      `No cutaway in the first ${s.skipOpening} seconds. Keep at least ${s.gap} seconds between cutaways.`,
      'For each one, quote the words said just as the cutaway should start (3 to 10 words) and say in a few plain words what the footage should show, as you would search a stock site: "a cluttered home garage", not "his early days".',
    );
    if (s.lookFor.trim()) lines.push(`What the cutaways should favour: ${s.lookFor.trim()}`);
    lines.push(
      "",
      'Answer as {"cutaways":[{"quote":"…","show":"…"}]}, in the order they are said.',
    );
  } else {
    const s = request.settings;
    lines.push(
      "",
      s.count > 0
        ? `Group the recording into at most ${s.count} chapters by topic, in order.`
        : "Group the recording into chapters by topic, in order: as many as its topics need, usually one every few minutes, and none shorter than 10 seconds.",
      "The first chapter starts at the beginning.",
      s.bullets > 0
        ? `For each chapter give a short title (at most 6 words), its opening (the first 6 to 12 words of the chapter, copied exactly from the transcript) and ${s.bullets} short bullets of show notes saying what is covered.`
        : "For each chapter give a short title (at most 6 words) and its opening (the first 6 to 12 words of the chapter, copied exactly from the transcript).",
      "",
      'Answer as {"chapters":[{"title":"…","opening":"…","bullets":["…"]}]}.',
    );
  }
  lines.push("", "The transcript:", request.transcript);
  return lines.join("\n");
}
