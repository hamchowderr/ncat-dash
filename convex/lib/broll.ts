import { internal } from "../_generated/api";
import { looksLikeBroll } from "@ncat-dash/automation-core";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { failStep } from "./runner";

/**
 * The parts of an Add B-Roll run that happen inside the runner (see convex/broll.ts for
 * the rest): after the picture model has looked at the words and the stock found, the
 * cutaways are chosen.
 */

async function stepsOf(ctx: QueryCtx, run: Doc<"runs">) {
  const steps = await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .take(200);
  return new Map(steps.map((other) => [other.nodeId, other]));
}

/**
 * After "look": chooses the cutaways, unless the picture model could not look at the words
 * and stock (the first job). A video whose camera cuts were not found (the jobs after) is
 * covered as before, without them.
 */
export async function finishLooking(
  ctx: MutationCtx,
  run: Doc<"runs">,
  step: Doc<"runSteps">,
  jobs: Doc<"jobs">[],
) {
  const first = step.jobIds[0];
  const failed = jobs.find((job) => job.status === "failed" && job._id === first);
  if (failed) {
    await failStep(
      ctx,
      run,
      step,
      await stepsOf(ctx, run),
      `The picture model could not look at the footage: ${failed.error ?? "the toolkit gave no reason."}`,
    );
    return;
  }
  await ctx.scheduler.runAfter(0, internal.broll.choose, { runStepId: step._id });
}

/**
 * After "lay": the videos with cutaways laid over them, in order, and the ones that got
 * none handed on as they came.
 */
export async function finishLaying(
  ctx: MutationCtx,
  run: Doc<"runs">,
  step: Doc<"runSteps">,
  jobs: Doc<"jobs">[],
) {
  const failed = jobs.find((job) => job.status === "failed");
  if (failed) {
    await failStep(ctx, run, step, await stepsOf(ctx, run), failed.error ?? "The step failed.");
    return;
  }
  const order = (Array.isArray(step.brollWork) ? step.brollWork : []) as {
    url: string;
    laid: boolean;
  }[];
  const laid = [...jobs];
  const outputs = order.length
    ? order.flatMap((video) => (video.laid ? (laid.shift()?.outputs ?? []) : [video.url]))
    : jobs.flatMap((job) => job.outputs);
  await ctx.db.patch(step._id, {
    status: "done",
    stage: undefined,
    brollWork: undefined,
    outputs,
    finishedAt: Date.now(),
    retryError: undefined,
  });
}

/** Whether a library file may be used as B-Roll: said so, or it looks like it. */
export function usableAsBroll(item: Pick<Doc<"libraryItems">, "broll" | "look" | "kind">) {
  if (item.kind !== "video") return false;
  if (item.broll === "no") return false;
  return item.broll === "yes" || item.look?.brollLike === true;
}

/** Works out again whether a library file looks like B-Roll, from its frames and words. */
export async function refreshBrollLike(ctx: MutationCtx, itemId: Id<"libraryItems">) {
  const item = await ctx.db.get(itemId);
  if (!item?.look || item.look.status !== "ready") return;
  const frames = await ctx.db
    .query("libraryFrames")
    .withIndex("by_item", (q) => q.eq("itemId", itemId))
    .take(100);
  const duration = item.details?.duration ?? Math.max(0, ...frames.map((frame) => frame.time));
  let spokenWords: number | undefined;
  if (item.transcript?.status === "ready") {
    const pieces = await ctx.db
      .query("transcriptPieces")
      .withIndex("by_item_and_start", (q) => q.eq("itemId", itemId))
      .take(400);
    spokenWords = pieces.reduce((total, piece) => total + piece.text.split(/\s+/).length, 0);
  }
  const brollLike = looksLikeBroll({
    duration,
    faces: frames.map((frame) => frame.face),
    ...(spokenWords !== undefined ? { spokenWords } : {}),
  });
  if (item.look.brollLike !== brollLike) {
    await ctx.db.patch(itemId, { look: { ...item.look, brollLike } });
  }
}
