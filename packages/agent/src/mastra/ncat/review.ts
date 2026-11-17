import { z } from "zod";

/**
 * What Convex sends when someone tags the agent in a review comment (convex/reviewAgent.ts
 * in the dashboard), and how it becomes the agent's prompt.
 */
const text = (max: number) => z.string().max(max);

const seconds = z.number().finite();
const gap = z.object({ start: seconds, end: seconds.nullable() });

export const clipSense = z.object({
  frames: z
    .object({ from: seconds, every: seconds, count: z.number().int().min(1).max(48) })
    .nullable(),
  pacing: z
    .object({
      cuts: z.number().int().min(0),
      averageShot: seconds.nullable(),
      shot: gap,
      cutsNear: z.array(seconds).max(300),
    })
    .nullable(),
  sound: z
    .object({
      hasAudio: z.boolean(),
      loudness: z.number().nullable(),
      loudnessAtMoment: z.number().nullable(),
      quietNear: z.array(gap).max(100),
    })
    .nullable(),
  transcript: z
    .array(z.object({ at: seconds, text: text(400) }))
    .max(200)
    .nullable(),
});

export type ClipSense = z.infer<typeof clipSense>;

export const reviewQuestion = z.object({
  question: z.object({
    review: z.object({ title: text(200), status: text(20) }),
    clip: z.object({
      title: text(200),
      version: z.number(),
      versions: z.number(),
      url: text(2000),
      isVideo: z.boolean(),
    }),
    moment: z.object({ seconds: z.number(), label: text(20) }).nullable(),
    thread: z
      .array(z.object({ author: text(200), body: text(4000), isAgent: z.boolean() }))
      .min(1)
      .max(100),
    otherNotes: z
      .array(
        z.object({
          at: text(20).nullable(),
          author: text(200),
          body: text(500),
          resolved: z.boolean(),
        }),
      )
      .max(40),
    automation: z
      .object({ name: text(200), outline: text(20_000), runStatus: text(20) })
      .nullable(),
    askedBy: text(200),
  }),
  still: z.string().url().max(2000).nullable(),
  // A picture of frames around the moment, and the toolkit's measurements of the clip
  // (review-core's ClipSense). Older dashboards send neither.
  frames: z.string().url().max(2000).nullable().optional(),
  sense: clipSense.nullable().optional(),
});

export type ReviewQuestion = z.infer<typeof reviewQuestion>["question"];

/** 75.5 seconds as 1:15.5, the way the team writes moments. */
export function clock(value: number): string {
  const whole = Math.max(value, 0);
  const minutes = Math.floor(whole / 60);
  const rest = Math.round((whole - minutes * 60) * 10) / 10;
  return `${minutes}:${rest < 10 ? "0" : ""}${rest}`;
}

/** What the toolkit measured, in words the model reads. */
export function senseLines(sense: ClipSense, framesImage: string | null): string[] {
  const lines: string[] = [];
  if (framesImage && sense.frames) {
    lines.push(
      `${framesImage} shows ${sense.frames.count} frames in reading order (left to right, then down), one every ${sense.frames.every} seconds from ${clock(sense.frames.from)}. Compare them to see movement, and a cut where the picture changes completely.`,
    );
  }
  if (sense.pacing) {
    const p = sense.pacing;
    lines.push(
      p.cuts === 0
        ? "Pacing: the clip is one continuous shot with no cuts."
        : `Pacing: ${p.cuts} cut${p.cuts === 1 ? "" : "s"} in the clip${p.averageShot !== null ? `, a shot lasts ${p.averageShot} seconds on average` : ""}. The moment is in a shot from ${clock(p.shot.start)} to ${p.shot.end === null ? "the end" : clock(p.shot.end)}${p.cutsNear.length ? `; cuts near it at ${p.cutsNear.map(clock).join(", ")}` : ""}.`,
    );
  }
  if (sense.sound) {
    const s = sense.sound;
    if (!s.hasAudio) {
      lines.push("Sound: the clip has no audio track.");
    } else {
      const parts = [
        s.loudness !== null ? `the clip averages ${s.loudness} LUFS` : null,
        s.loudnessAtMoment !== null
          ? `${s.loudnessAtMoment} LUFS in the 3 seconds around the moment`
          : null,
      ].filter(Boolean);
      lines.push(
        `Sound: ${parts.length ? `${parts.join(", ")} (social platforms play at about -14 LUFS; below about -20 sounds quiet)` : "loudness could not be measured"}.${s.quietNear.length ? ` Quiet gaps nearby: ${s.quietNear.map((g) => `${clock(g.start)} to ${g.end === null ? "the end" : clock(g.end)}`).join(", ")}.` : " No quiet gaps near the moment."}`,
      );
    }
  }
  if (sense.transcript) {
    if (sense.transcript.length === 0) {
      lines.push("Speech near the moment: none was heard.");
    } else {
      lines.push("Speech near the moment (transcribed, may have small mistakes):");
      for (const line of sense.transcript) lines.push(`${clock(line.at)} ${line.text}`);
    }
  }
  return lines;
}

/** The question as one message for the model. */
export function reviewPrompt(
  question: ReviewQuestion,
  hasStill: boolean,
  sense: ClipSense | null = null,
  hasFrames = false,
): string {
  const lines: string[] = [];
  lines.push(`Review: "${question.review.title}" (${question.review.status}).`);
  lines.push(
    `Clip: "${question.clip.title}", version ${question.clip.version} of ${question.clip.versions}.`,
  );
  if (question.moment) {
    lines.push(
      `The comment is pinned to ${question.moment.label}.${hasStill ? " The image is a still of that moment." : " No still of the moment could be taken."}`,
    );
  } else {
    lines.push("The clip is a still image or a file without a timeline.");
  }
  if (question.moment && sense) {
    const measured = senseLines(
      sense,
      hasFrames ? (hasStill ? "The second image" : "The image") : null,
    );
    if (measured.length) {
      lines.push("");
      lines.push("What the toolkit measured in the clip:");
      lines.push(...measured);
    }
  }
  if (question.automation) {
    lines.push("");
    lines.push(
      `The clip was made by the automation "${question.automation.name}" (that run is ${question.automation.runStatus}). How it is built now:`,
    );
    lines.push(question.automation.outline);
  }
  if (question.otherNotes.length > 0) {
    lines.push("");
    lines.push("The team's other notes on this version:");
    for (const note of question.otherNotes) {
      lines.push(
        `- ${note.at ? `${note.at} ` : ""}${note.author}: ${note.body}${note.resolved ? " (resolved)" : ""}`,
      );
    }
  }
  lines.push("");
  lines.push("The thread you were tagged in, oldest first:");
  for (const entry of question.thread) {
    lines.push(`${entry.isAgent ? "You (the agent)" : entry.author}: ${entry.body}`);
  }
  lines.push("");
  lines.push(`Answer ${question.askedBy}'s latest message in this thread.`);
  return lines.join("\n");
}
