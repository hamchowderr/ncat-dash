// The Send to a URL step (automation-core send.ts): posts the files that reach it, with
// the run's details, to an address, then hands the same files on. The post is made by
// convex/send.ts through the outbound pool (lib/pools.ts), which tries again when the
// address does not answer.
import { type AutomationNode, sendProblem } from "@takewon/automation-core";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { outboundPool } from "./pools";
import { advance, failStep, incomingFiles } from "./runner";

type StepsByNode = Map<string, Doc<"runSteps">>;

/** Starts a "send" step: notes what it sends and asks for the post to be made. */
export async function startSend(
  ctx: MutationCtx,
  run: Doc<"runs">,
  node: AutomationNode,
  step: Doc<"runSteps">,
  byNode: StepsByNode,
) {
  const problem = sendProblem(node.input);
  if (problem) {
    await failStep(ctx, run, step, byNode, problem);
    return;
  }
  await ctx.db.patch(step._id, {
    status: "running",
    stage: "send",
    startedAt: Date.now(),
    outputs: incomingFiles(node, run, byNode),
  });
  await outboundPool.enqueueAction(
    ctx,
    internal.send.post,
    { runStepId: step._id },
    { onComplete: internal.send.done, context: { runStepId: step._id } },
  );
}

/**
 * Ends a "send" step once its post was answered, or after the last try failed. Does
 * nothing if the step or its run has moved on meanwhile.
 */
export async function finishSend(
  ctx: MutationCtx,
  runStepId: Id<"runSteps">,
  error: string | null,
) {
  const step = await ctx.db.get(runStepId);
  if (!step || step.status !== "running" || step.stage !== "send") return;
  const run = await ctx.db.get(step.runId);
  if (!run || (run.status !== "running" && run.status !== "waiting")) return;
  if (error) {
    const steps = await ctx.db
      .query("runSteps")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .take(200);
    await failStep(ctx, run, step, new Map(steps.map((other) => [other.nodeId, other])), error);
  } else {
    await ctx.db.patch(step._id, { status: "done", finishedAt: Date.now() });
  }
  await advance(ctx, run._id);
}
