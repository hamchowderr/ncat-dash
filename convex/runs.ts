import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { isMember, requireMember } from "./lib/authz";
import { pump } from "./lib/queue";
import { decideApproval } from "./lib/runner";

function summary(run: Doc<"runs">) {
  return {
    _id: run._id,
    automationId: run.automationId,
    automationName: run.automationName,
    status: run.status,
    triggerKind: run.triggerKind,
    error: run.error,
    startedAt: run._creationTime,
    finishedAt: run.finishedAt,
  };
}

/** An automation's most recent runs, newest first. */
export const listForAutomation = query({
  args: { automationId: v.id("automations") },
  handler: async (ctx, args) => {
    const automation = await ctx.db.get(args.automationId);
    if (!automation) return [];
    await requireMember(ctx, automation.organizationId);
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_automation", (q) => q.eq("automationId", args.automationId))
      .order("desc")
      .take(50);
    return runs.map(summary);
  },
});

/** One run with the live state of every step. */
export const get = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    if (!(await isMember(ctx, run.organizationId))) return null;
    const steps = await ctx.db
      .query("runSteps")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .take(200);
    return {
      ...summary(run),
      trigger: run.trigger,
      nodes: run.nodes,
      edges: run.edges,
      steps: await Promise.all(
        steps.map(async (step) => {
          const jobs = await Promise.all(step.jobIds.map((jobId) => ctx.db.get(jobId)));
          return {
            _id: step._id,
            nodeId: step.nodeId,
            status: step.status,
            outputs: step.outputs,
            error: step.error,
            startedAt: step.startedAt,
            finishedAt: step.finishedAt,
            jobs: jobs
              .filter((job) => job !== null)
              .map((job) => ({ _id: job._id, status: job.status })),
          };
        }),
      ),
    };
  },
});

/** Steps across the team that are waiting for someone to approve them. */
export const waitingApprovals = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const steps = await ctx.db
      .query("runSteps")
      .withIndex("by_organization_and_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "waiting_approval"),
      )
      .take(50);
    const found = [];
    for (const step of steps) {
      const run = await ctx.db.get(step.runId);
      if (!run || (run.status !== "running" && run.status !== "waiting")) continue;
      found.push({
        runStepId: step._id,
        runId: run._id,
        automationId: run.automationId,
        automationName: run.automationName,
        waitingSince: step.startedAt,
      });
    }
    return found;
  },
});

/** Approves or rejects an approval step. Any team member may decide. */
export const decide = mutation({
  args: { runStepId: v.id("runSteps"), approved: v.boolean() },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.runStepId);
    if (!step) throw new ConvexError({ code: "not_found", message: "This step no longer exists." });
    const { userId } = await requireMember(ctx, step.organizationId);
    if (step.status !== "waiting_approval") {
      throw new ConvexError({ code: "conflict", message: "Someone has already decided this." });
    }
    await decideApproval(ctx, step, args.approved, userId);
  },
});

/**
 * Stops a run. Steps that have not started are skipped and jobs still waiting for a
 * slot are dropped. A job already on the toolkit finishes there; its result is kept in
 * Jobs but nothing further runs.
 */
export const cancel = mutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;
    await requireMember(ctx, run.organizationId);
    if (run.status !== "running" && run.status !== "waiting") return;
    const now = Date.now();
    const steps = await ctx.db
      .query("runSteps")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .take(200);
    for (const step of steps) {
      if (step.status === "done" || step.status === "failed" || step.status === "skipped") continue;
      for (const jobId of step.jobIds) {
        const job = await ctx.db.get(jobId);
        if (job && job.status === "queued" && job.dispatchedAt === undefined) {
          await ctx.db.patch(jobId, {
            status: "failed",
            error: "The run was cancelled before this job was sent.",
            finishedAt: now,
          });
        }
      }
      await ctx.db.patch(step._id, { status: "skipped", finishedAt: now });
    }
    await ctx.db.patch(args.runId, { status: "cancelled", finishedAt: now });
    await pump(ctx, run.organizationId);
  },
});
