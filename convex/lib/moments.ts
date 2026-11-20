import {
  type AutomationEdge,
  type AutomationNode,
  type BrollMoment,
  brollMomentsFromPicks,
  brollPicksFrom,
  chapterPicksFrom,
  chapterSettings,
  clipRequest,
  clipsKeepShape,
  droppedWords,
  durationOf,
  getPlatform,
  momentPicksFrom,
  momentSettings,
  motionBeatsFromPicks,
  motionPicksFrom,
  motionPlanSettings,
  type PlacedPiece,
  planChapters,
  planMoments,
  readFileDetails,
  readModelJson,
  sourceKey,
  tooShortFor,
  type Word,
} from "@ncat-dash/automation-core";
import { readPauses } from "@ncat-dash/step-catalog";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { motionPlanOf } from "./motion";
import { advance, enqueueAll, failStep, incomingFiles } from "./runner";

/**
 * The Best moments and Chapters steps in a run. Both start the same way: each video is
 * transcribed on the team's toolkit with word timestamps ("listen"; a video transcribed
 * before is not done again), then the model picks from the transcript ("pick", in
 * convex/moments.ts, which calls the agent server). Best moments then cuts what was
 * picked ("cut") like Clips for a platform does; Chapters is done once they are placed.
 */

// One step takes this many videos at most: each one is a call to the model.
export const MAX_VIDEOS_PER_PICK_STEP = 5;
// A transcript this long, in words, is kept (about three hours of speech).
export const MAX_WORDS = 30_000;

/** The request that finds a video's pauses: a third of a second of quiet or longer. */
export function silenceRequest(url: string): Record<string, unknown> {
  return { media_url: url, duration: 0.3, noise: "-35dB", mono: true };
}

/** The request that transcribes a video with each word's timing, to a file. */
export function listenRequest(url: string): Record<string, unknown> {
  return {
    media_url: url,
    include_text: false,
    include_srt: false,
    include_segments: true,
    word_timestamps: true,
    // The words of a long video are far more than a job's result can hold, so the
    // toolkit writes them to a file and hands back its link.
    response_type: "cloud",
  };
}

export async function wordsFor(
  ctx: QueryCtx,
  organizationId: string,
  url: string,
): Promise<{ words: Word[]; duration: number } | null> {
  const found = await ctx.db
    .query("spokenWords")
    .withIndex("by_source", (q) =>
      q.eq("organizationId", organizationId).eq("source", sourceKey(url)),
    )
    .first();
  if (!found) return null;
  return {
    duration: found.duration,
    words: found.words.map((word) => ({ text: word.t, start: word.s, end: word.e })),
  };
}

/** First stage: read each video's details and transcribe the ones not heard before. */
export async function startListening(
  ctx: MutationCtx,
  run: Doc<"runs">,
  node: AutomationNode,
  step: Doc<"runSteps">,
  byNode: Map<string, Doc<"runSteps">>,
  inputs: string[],
) {
  if (node.kind === "moments" && !getPlatform(node.input.platform)) {
    await failStep(ctx, run, step, byNode, "Pick a platform for the clips.");
    return;
  }
  if (inputs.length === 0) {
    await failStep(ctx, run, step, byNode, "No video reached this step.");
    return;
  }
  if (inputs.length > MAX_VIDEOS_PER_PICK_STEP) {
    await failStep(
      ctx,
      run,
      step,
      byNode,
      `${inputs.length} videos reached this step; the most it takes at once is ${MAX_VIDEOS_PER_PICK_STEP}.`,
    );
    return;
  }
  const wanted: { stepId: string; input: unknown }[] = [];
  for (const url of inputs) {
    wanted.push({ stepId: "media-metadata", input: { media_url: url } });
    // Clean Up Pauses And Retakes also needs where the toolkit hears silence.
    if (node.kind === "cleanup")
      wanted.push({ stepId: "media-silence-detect", input: silenceRequest(url) });
    if (!(await wordsFor(ctx, run.organizationId, url))) {
      wanted.push({ stepId: "media-transcribe", input: listenRequest(url) });
    }
  }
  const queued = await enqueueAll(ctx, run, step, wanted);
  if (!queued.ok) {
    await failStep(ctx, run, step, byNode, queued.message);
    return;
  }
  await ctx.db.patch(step._id, {
    status: "running",
    stage: "listen",
    jobIds: queued.jobIds,
    startedAt: Date.now(),
  });
}

async function stepsOf(ctx: QueryCtx, run: Doc<"runs">) {
  const steps = await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .take(200);
  return new Map(steps.map((other) => [other.nodeId, other]));
}

/** After "listen": hands the transcripts to the model, unless a job could not be done. */
export async function finishListening(
  ctx: MutationCtx,
  run: Doc<"runs">,
  step: Doc<"runSteps">,
  jobs: Doc<"jobs">[],
) {
  const failed = jobs.find((job) => job.status === "failed");
  if (failed) {
    const what = failed.stepId === "media-transcribe" ? "transcribe" : "read";
    await failStep(
      ctx,
      run,
      step,
      await stepsOf(ctx, run),
      `Could not ${what} the video: ${failed.error ?? "the toolkit gave no reason."}`,
    );
    return;
  }
  const node = (run.nodes as AutomationNode[]).find((candidate) => candidate.id === step.nodeId);
  if (node?.kind === "broll") {
    // Add B-Roll needs no AI: it goes on to find footage for what was said.
    await ctx.db.patch(step._id, { stage: "match" });
    await ctx.scheduler.runAfter(0, internal.broll.match, { runStepId: step._id });
    return;
  }
  await ctx.db.patch(step._id, { stage: "pick" });
  await ctx.scheduler.runAfter(0, internal.moments.pick, { runStepId: step._id });
}

/** What the "listen" jobs found about one video. */
export interface Heard {
  url: string;
  duration: number | null;
  /** The file holding its words, when it was transcribed in this run. */
  wordsFile: string | null;
  /** The words, when the toolkit handed them back in its answer. */
  segments: unknown;
  metadata: unknown;
  /** Where the toolkit heard silence, when a "cleanup" step asked. */
  pauses: { start: number; end: number }[] | null;
}

/** The videos of a step at "pick", in the order they reached it, with what was heard. */
export function heardFrom(jobs: Doc<"jobs">[]): Heard[] {
  const byUrl = new Map<string, Heard>();
  for (const job of jobs) {
    const url = (job.input as { media_url?: unknown }).media_url;
    if (typeof url !== "string") continue;
    const heard = byUrl.get(url) ?? {
      url,
      duration: null,
      wordsFile: null,
      segments: null,
      metadata: null,
      pauses: null,
    };
    if (job.stepId === "media-metadata") {
      heard.metadata = job.result;
      heard.duration = durationOf(job.result);
    } else if (job.stepId === "media-transcribe") {
      const result = (job.result ?? {}) as { segments_url?: unknown; segments?: unknown };
      heard.wordsFile = typeof result.segments_url === "string" ? result.segments_url : null;
      heard.segments = result.segments ?? null;
    } else if (job.stepId === "media-silence-detect" && job.status === "done") {
      heard.pauses = readPauses(job.result);
    }
    byUrl.set(url, heard);
  }
  return [...byUrl.values()];
}

export interface PickAnswer {
  url: string;
  /** The model's answer, as text. */
  answer: string;
}

/**
 * Last stage of the pick: places the model's picks on each video's words, keeps what fits
 * and, for Best moments, queues one cut per moment. Chapters is done here.
 */
export async function finishPicking(
  ctx: MutationCtx,
  run: Doc<"runs">,
  step: Doc<"runSteps">,
  answers: PickAnswer[],
) {
  const byNode = await stepsOf(ctx, run);
  const nodes = run.nodes as AutomationNode[];
  const edges = run.edges as AutomationEdge[];
  const node = nodes.find((candidate) => candidate.id === step.nodeId);
  if (!node) return;
  const jobs = (await Promise.all(step.jobIds.map((id) => ctx.db.get(id)))).filter(
    (job): job is Doc<"jobs"> => job !== null,
  );
  const heard = new Map(heardFrom(jobs).map((one) => [one.url, one]));

  if (node.kind === "broll-plan") {
    const plan: { source: string; cutaways: BrollMoment[] }[] = [];
    let dropped = 0;
    for (const { url, answer } of answers) {
      const spoken = await wordsFor(ctx, run.organizationId, url);
      if (!spoken) continue;
      const placed = brollMomentsFromPicks(spoken.words, brollPicksFrom(readModelJson(answer)));
      dropped += placed.dropped;
      plan.push({ source: url, cutaways: placed.moments });
    }
    await ctx.db.patch(step._id, {
      status: "done",
      stage: undefined,
      aiPlan: plan,
      ...(dropped > 0
        ? {
            pickNote: `${dropped} ${dropped === 1 ? "cutaway was" : "cutaways were"} left out: ${dropped === 1 ? "its words were" : "their words were"} not in the transcript word for word.`,
          }
        : {}),
      outputs: incomingFiles(node, run, byNode),
      finishedAt: Date.now(),
    });
    await advance(ctx, run._id);
    return;
  }

  if (node.kind === "motion-plan") {
    const { setup } = await motionPlanOf(ctx, run.organizationId, node.id, nodes, edges);
    const allowed = motionPlanSettings(setup, 0, node.input);
    const plan: { source: string; beats: PlacedPiece[] }[] = [];
    let dropped = 0;
    for (const { url, answer } of answers) {
      const spoken = await wordsFor(ctx, run.organizationId, url);
      if (!spoken) continue;
      const placed = motionBeatsFromPicks(
        spoken.words,
        motionPicksFrom(readModelJson(answer)),
        allowed,
      );
      dropped += placed.dropped;
      plan.push({ source: url, beats: placed.beats });
    }
    await ctx.db.patch(step._id, {
      status: "done",
      stage: undefined,
      aiPlan: plan,
      ...(dropped > 0
        ? {
            pickNote: `${dropped} ${dropped === 1 ? "piece was" : "pieces were"} left out: ${dropped === 1 ? "its words were" : "their words were"} not in the transcript word for word.`,
          }
        : {}),
      outputs: incomingFiles(node, run, byNode),
      finishedAt: Date.now(),
    });
    await advance(ctx, run._id);
    return;
  }

  if (node.kind === "chapters") {
    const settings = chapterSettings(node.input);
    const chapters: NonNullable<Doc<"runSteps">["chapters"]> = [];
    let dropped = 0;
    for (const { url, answer } of answers) {
      const spoken = await wordsFor(ctx, run.organizationId, url);
      if (!spoken) continue;
      const placed = planChapters(
        spoken.words,
        chapterPicksFrom(readModelJson(answer)),
        settings,
        heard.get(url)?.duration ?? spoken.duration,
      );
      dropped += placed.dropped;
      chapters.push(...placed.chapters.map((chapter) => ({ source: url, ...chapter })));
    }
    if (chapters.length === 0) {
      await failStep(ctx, run, step, byNode, "No chapters could be placed in the transcript.");
      await advance(ctx, run._id);
      return;
    }
    await ctx.db.patch(step._id, {
      status: "done",
      stage: undefined,
      chapters,
      ...(dropped > 0
        ? {
            pickNote: `${dropped} ${dropped === 1 ? "chapter was" : "chapters were"} left out: its opening was not in the transcript word for word, or it was under 10 seconds.`,
          }
        : {}),
      outputs: incomingFiles(node, run, byNode),
      finishedAt: Date.now(),
    });
    await advance(ctx, run._id);
    return;
  }

  const settings = momentSettings(node.input);
  const platform = getPlatform(settings.platform);
  if (!platform) {
    await failStep(ctx, run, step, byNode, "Pick a platform for the clips.");
    await advance(ctx, run._id);
    return;
  }
  const moments: NonNullable<Doc<"runSteps">["moments"]> = [];
  const sources: NonNullable<Doc<"runSteps">["sources"]> = [];
  const total = { notInTranscript: 0, wrongLength: 0, overlapping: 0 };
  for (const { url, answer } of answers) {
    const spoken = await wordsFor(ctx, run.organizationId, url);
    if (!spoken) continue;
    const duration = heard.get(url)?.duration ?? spoken.duration;
    const short = tooShortFor(platform, duration);
    if (short) {
      await failStep(ctx, run, step, byNode, short);
      await advance(ctx, run._id);
      return;
    }
    const avoid = settings.skipPicked
      ? (
          await ctx.db
            .query("pickedMoments")
            .withIndex("by_source", (q) =>
              q.eq("organizationId", run.organizationId).eq("source", sourceKey(url)),
            )
            .take(500)
        ).map(({ start, end }) => ({ start, end }))
      : [];
    const plan = planMoments(
      spoken.words,
      momentPicksFrom(readModelJson(answer)),
      settings,
      avoid,
      duration,
    );
    total.notInTranscript += plan.dropped.notInTranscript;
    total.wrongLength += plan.dropped.wrongLength;
    total.overlapping += plan.dropped.overlapping;
    moments.push(...plan.moments.map((moment) => ({ source: url, ...moment })));
    // Kept so the moments can be opened in a video editor, as Clips does.
    const details = readFileDetails(heard.get(url)?.metadata);
    if (details?.fps && details.width && details.height) {
      sources.push({
        url,
        fps: details.fps,
        width: details.width,
        height: details.height,
        duration,
        hasAudio: details.hasAudio ?? true,
        ...(details.audioChannels ? { audioChannels: details.audioChannels } : {}),
        ...(details.audioSampleRate ? { audioSampleRate: details.audioSampleRate } : {}),
      });
    }
  }
  const note = droppedWords(total);
  if (moments.length === 0) {
    await failStep(
      ctx,
      run,
      step,
      byNode,
      `No moment could be used.${note ? ` ${note}` : ""}${
        settings.skipPicked ? " Moments already picked from this video are skipped." : ""
      }`,
    );
    await advance(ctx, run._id);
    return;
  }
  for (const moment of moments) {
    await ctx.db.insert("pickedMoments", {
      organizationId: run.organizationId,
      source: sourceKey(moment.source),
      start: moment.start,
      end: moment.end,
      runId: run._id,
    });
  }
  const plan = moments.map((moment, index) => ({
    source: moment.source,
    part: index + 1,
    parts: moments.length,
    start: moment.start,
    seconds: Math.round((moment.end - moment.start) * 1000) / 1000,
  }));
  const keepShape = clipsKeepShape(step.nodeId, nodes, edges);
  const queued = await enqueueAll(
    ctx,
    run,
    step,
    plan.map((clip) => ({
      stepId: "ffmpeg-compose",
      // Moments handed straight to Follow the speaker keep the whole picture to follow in.
      input: keepShape
        ? clipRequest(clip.source, clip, "original")
        : clipRequest(clip.source, clip, platform.frame, platform.box),
    })),
  );
  if (!queued.ok) {
    await failStep(ctx, run, step, byNode, queued.message);
    await advance(ctx, run._id);
    return;
  }
  await ctx.db.patch(step._id, {
    stage: "cut",
    jobIds: queued.jobIds,
    plan,
    sources,
    moments,
    ...(note ? { pickNote: note } : {}),
  });
  await advance(ctx, run._id);
}
