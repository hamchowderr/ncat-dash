/**
 * The words already known for a video a caption step is about to caption, so the toolkit
 * does not transcribe it again. Every upload is transcribed once when it comes in, and
 * Best moments keeps the words of each video it hears (both in spokenWords).
 *
 * A video found there is used as it is. A clip a Clips or Best moments step of this run
 * cut from such a video takes the words said in its stretch, timed from the clip's start.
 * Follow the speaker only reframes, so its video keeps the timing of the one it was given.
 * Anything else (a step that cuts out pauses, adds an intro) changes the timing, so its
 * video is heard again as before.
 */
import {
  FOLLOW_SPEAKER_STEP,
  type KnownWord,
  sourceKey,
  wordsInClip,
} from "@takewon/automation-core";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { wordsFor } from "./moments";

// How far back through the run's steps a video is followed.
const MAX_HOPS = 4;
// The transcript must reach the end of the clip, give or take this, to be trusted.
const END_SLACK = 1.5;

type Origin = { jobs: Map<string, { job: Doc<"jobs">; step: Doc<"runSteps">; index: number }> };

/** Which job of this run made each file, by the file's address without its query. */
async function originsOf(ctx: QueryCtx, steps: Doc<"runSteps">[]): Promise<Origin> {
  const jobs: Origin["jobs"] = new Map();
  for (const step of steps) {
    if (step.status !== "done") continue;
    for (const [index, jobId] of step.jobIds.entries()) {
      const job = await ctx.db.get(jobId);
      if (!job || job.status !== "done") continue;
      for (const url of job.outputs) jobs.set(sourceKey(url), { job, step, index });
    }
  }
  return { jobs };
}

/**
 * The known words for each of `urls`, timed from that video's own start; a video whose
 * words are not known is left out.
 */
export async function knownWordsFor(
  ctx: QueryCtx,
  run: Doc<"runs">,
  steps: Doc<"runSteps">[],
  urls: string[],
): Promise<Map<string, KnownWord[]>> {
  const found = new Map<string, KnownWord[]>();
  let origins: Origin | null = null;
  for (const url of new Set(urls)) {
    let current = url;
    // The stretch of `current` that `url` holds: from `offset`, for `length` seconds.
    let offset = 0;
    let length = Infinity;
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const spoken = await wordsFor(ctx, run.organizationId, current);
      if (spoken) {
        if (length === Infinity) {
          found.set(url, spoken.words);
        } else if (spoken.duration + END_SLACK >= offset + length) {
          found.set(url, wordsInClip(spoken.words, offset, length));
        }
        break;
      }
      origins ??= await originsOf(ctx, steps);
      const made = origins.jobs.get(sourceKey(current));
      if (!made) break;
      const part = made.step.plan?.[made.index];
      if (part && made.step.plan?.length === made.step.jobIds.length) {
        // A clip cut from its source. Cuts of a cut add up.
        offset = part.start + (length === Infinity ? 0 : offset);
        length = Math.min(part.seconds, length);
        current = part.source;
        continue;
      }
      const input = (made.job.input ?? {}) as Record<string, unknown>;
      if (made.job.stepId === FOLLOW_SPEAKER_STEP && typeof input.video_url === "string") {
        current = input.video_url;
        continue;
      }
      break;
    }
  }
  return found;
}
