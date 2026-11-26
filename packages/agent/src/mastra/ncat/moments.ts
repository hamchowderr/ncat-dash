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

const motionSettings = z.object({
  /** At most this many beats. */
  count: z.number().int().min(1).max(40),
  /** Seconds kept between two beats. */
  gap: z.number().min(0).max(120),
  pieces: z.array(z.enum(["keyword", "stat", "quote", "chapter", "transition"])).max(5),
  /** Whether a keyword may say what is not said word for word. */
  showsUnsaid: z.boolean(),
  /** Whether each beat picks its sound. */
  sounds: z.boolean(),
  look: z.string().max(30).default(""),
  notes: z.string().max(2000).default(""),
  lookFor: z.string().max(1000).default(""),
});

const MOTION_SOUNDS = "whoosh, pop, impact, ding, tick, slide, thud, click, riser";

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
    brief: z.string().max(2000).default(""),
  }),
  z.object({
    kind: z.literal("chapters"),
    title: z.string().max(300).default(""),
    duration: z.number().finite().nonnegative(),
    transcript: z.string().min(1).max(MAX_TRANSCRIPT),
    settings: chapterSettings,
    houseRules: z.string().max(2000).default(""),
    brief: z.string().max(2000).default(""),
  }),
  z.object({
    kind: z.literal("motion"),
    title: z.string().max(300).default(""),
    duration: z.number().finite().nonnegative(),
    transcript: z.string().min(1).max(MAX_TRANSCRIPT),
    settings: motionSettings,
    houseRules: z.string().max(2000).default(""),
    brief: z.string().max(2000).default(""),
  }),
  z.object({
    kind: z.literal("broll"),
    title: z.string().max(300).default(""),
    duration: z.number().finite().nonnegative(),
    transcript: z.string().min(1).max(MAX_TRANSCRIPT),
    settings: brollSettings,
    houseRules: z.string().max(2000).default(""),
    brief: z.string().max(2000).default(""),
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
  if (request.brief.trim()) {
    lines.push(
      "",
      "The brief for this video (pacing and direction from the team; follow it where it applies):",
      request.brief.trim(),
    );
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
  } else if (request.kind === "motion") {
    const s = request.settings;
    const pieces: Record<string, string> = {
      keyword:
        "keyword: one word or a short phrase slams onto the screen as it is said (text is the word or phrase, at most 4 words)",
      stat: 'stat: a number that is said, shown big with what it counts (text is the figure as written, such as "40%" or "$12,000"; subtitle is what it counts, at most 5 words)',
      quote:
        "quote: a line worth repeating shown as a quote card (quote is the whole line; text is left empty)",
      chapter:
        "chapter: a band with a short name for the part that starts here (text is the name, at most 5 words)",
      transition:
        "transition: a quick wipe where the talk moves on to something new (text is left empty)",
    };
    lines.push(
      "",
      `Plan motion graphics for this video: up to ${s.count} beats, each a designed piece drawn over the video as the words are said. The opening title, the speaker's name and the ending are added for you; plan only what goes between them.`,
      "Pieces you can use:",
      ...s.pieces.map((piece) => `- ${pieces[piece]}`),
      `Keep at least ${s.gap} seconds between two beats, and leave stretches clear: fewer, stronger beats beat many weak ones. Put beats where they help someone watching with the sound off follow the point, and never on filler.`,
      s.showsUnsaid
        ? "A keyword may sum up the point in your own words."
        : "A keyword uses only words said in its quote.",
    );
    if (s.look) lines.push(`The look is ${s.look}.`);
    if (s.sounds) {
      lines.push(
        `Give each beat the sound it comes in with, from: ${MOTION_SOUNDS}, or "none". Leave sound empty for the piece's usual sound. Use few loud ones (impact, riser).`,
      );
    }
    if (s.notes.trim()) lines.push("The team's style notes:", s.notes.trim());
    if (s.lookFor.trim()) lines.push(`What the graphics should bring out: ${s.lookFor.trim()}`);
    lines.push(
      "",
      'For each beat, quote the words said just as it should come in (3 to 12 words; for a quote card, the whole line). Answer as {"beats":[{"quote":"…","piece":"…","text":"…","subtitle":"…","sound":"…"}]}, in the order they are said.',
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

/** What one answer used, in the names the dashboard reads (convex/moments.ts there). */
export interface DashboardUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * The AI SDK's usage for one answer, as the dashboard reads it. Newer AI SDK versions
 * count cached input inside inputTokens and split it in inputTokenDetails; older ones
 * count only uncached input there and put cache reads in cachedInputTokens.
 */
export function dashboardUsage(usage: unknown, providerMetadata?: unknown): DashboardUsage {
  const u = (usage ?? {}) as Record<string, unknown>;
  const details = (u.inputTokenDetails ?? {}) as Record<string, unknown>;
  const anthropic = ((providerMetadata ?? {}) as Record<string, unknown>).anthropic as
    Record<string, unknown> | undefined;
  const n = (value: unknown) => (typeof value === "number" && value > 0 ? value : 0);
  const cacheRead = n(details.cacheReadTokens ?? u.cachedInputTokens);
  const cacheWrite = n(details.cacheWriteTokens ?? anthropic?.cacheCreationInputTokens);
  const uncached =
    typeof details.noCacheTokens === "number"
      ? n(details.noCacheTokens)
      : typeof details.cacheReadTokens === "number"
        ? Math.max(0, n(u.inputTokens) - cacheRead - cacheWrite)
        : n(u.inputTokens);
  return {
    inputTokens: uncached,
    outputTokens: n(u.outputTokens),
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  };
}
