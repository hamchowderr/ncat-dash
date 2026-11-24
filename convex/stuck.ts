// Steps that stopped moving. A step moves on when its jobs finish or when the background
// work it started (asking the agent, reading a transcript) reports back. If that work
// broke without reporting, the step would say "Running" forever and the run never end.
// This check ends such a step as failed, so the team hears about it and can pick the run
// up where it stopped.
import type { AutomationNode } from "@takewon/automation-core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { advance, failStep } from "./lib/runner";

/** A step with nothing in flight and no news for this long has stopped moving. */
export const STUCK_AFTER_MS = 60 * 60 * 1000;

export const STUCK_ERROR =
  "This step stopped without finishing, so it was ended. Pick the run up where it stopped to try it again.";

// How many long-running steps one pass looks at before it books the next pass.
const PAGE = 100;

/**
 * Whether a running step has stopped moving: no try booked, not waiting on purpose (a
 * Wait, another automation, a batch of questions), none of its jobs still going, and
 * nothing heard from it for STUCK_AFTER_MS.
 */
export async function isStuck(
  ctx: MutationCtx,
  step: Doc<"runSteps">,
  now: number,
): Promise<boolean> {
  if (step.status !== "running" || step.retryAt !== undefined || step.stage === "wait") {
    return false;
  }
  const run = await ctx.db.get(step.runId);
  if (!run || (run.status !== "running" && run.status !== "waiting")) return false;
  const node = (run.nodes as AutomationNode[]).find((each) => each.id === step.nodeId);
  if (!node || node.kind === "automation") return false;
  const batch = await ctx.db
    .query("pickBatches")
    .withIndex("by_step", (q) => q.eq("runStepId", step._id))
    .first();
  if (batch) return false;
  let last = step.startedAt ?? now;
  for (const jobId of step.jobIds) {
    const job = await ctx.db.get(jobId);
    if (!job) continue;
    if (job.status === "queued" || job.status === "running") return false;
    last = Math.max(last, job.finishedAt ?? 0);
  }
  return last <= now - STUCK_AFTER_MS;
}

/** Every 15 minutes: ends each step that has stopped moving, a page at a time. */
export const endStuckSteps = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const { page, continueCursor, isDone } = await ctx.db
      .query("runSteps")
      .withIndex("by_status_and_startedAt", (q) =>
        q.eq("status", "running").lte("startedAt", now - STUCK_AFTER_MS),
      )
      .paginate({ cursor: args.cursor ?? null, numItems: PAGE });
    for (const step of page) {
      if (!(await isStuck(ctx, step, now))) continue;
      const run = (await ctx.db.get(step.runId))!;
      const steps = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .take(200);
      await failStep(
        ctx,
        run,
        step,
        new Map(steps.map((other) => [other.nodeId, other])),
        STUCK_ERROR,
      );
      await advance(ctx, run._id);
    }
    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.stuck.endStuckSteps, { cursor: continueCursor });
    }
  },
});
