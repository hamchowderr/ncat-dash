import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { isMember, requireMember } from "./lib/authz";
import { finishWait } from "./lib/logic";
import { pump } from "./lib/queue";
import { EDITORS, editorFiles as filesForEditors } from "@ncat-dash/timeline-export";
import { captionsOf, cutListOf, editorsOf, finishedFiles } from "./lib/exports";
import { decideApproval, retriesFor, retryStepNow, startRun } from "./lib/runner";

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
    // How many times steps in the run tried again after failing.
    retries: run.retries ?? 0,
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
      // Whether the run's cuts can be opened in a video editor.
      hasCuts: (await cutListOf(ctx, run, steps)) !== null,
      trigger: run.trigger,
      // How many times a failed step tries again for this team.
      retryLimit: await retriesFor(ctx, run.organizationId),
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
              .map((job) => ({ _id: job._id, status: job.status, outputs: job.outputs })),
            stage: step.stage,
            plan: step.plan,
            // For an If: the files that left by each way. For a Wait: when it carries on.
            branches: step.branches,
            resumeAt: step.resumeAt,
            retries: step.retries ?? 0,
            // Set while the step waits to try again.
            retryAt: step.retryAt ?? null,
            retryError: step.retryError ?? null,
          };
        }),
      ),
    };
  },
});

/**
 * The files that open a run's cuts in the team's video editors, made on the spot from
 * the cuts the run saved. Null when the run has no cuts to open.
 */
export const editorFiles = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || !(await isMember(ctx, run.organizationId))) return null;
    const steps = await ctx.db
      .query("runSteps")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .take(200);
    const cuts = await cutListOf(ctx, run, steps);
    if (!cuts) return null;
    const editors = await editorsOf(ctx, run.organizationId);
    return {
      timelines: cuts.timelines.length,
      editors: EDITORS.filter((editor) => editors.includes(editor.id)).map((editor) => editor.name),
      usesCapCut: editors.includes("capcut"),
      files: filesForEditors(cuts, editors, await captionsOf(ctx, run, steps)),
      // The finished clips, for editors that open no timeline and for anyone who wants
      // everything in one folder.
      clips: finishedFiles(run, steps),
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

/** Fires when a Wait step's time is up, and lets the run carry on. */
export const wake = internalMutation({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    await finishWait(ctx, args.runStepId);
  },
});

/** Starts a booked try for a step that failed. Scheduled by the runner. */
export const retryStep = internalMutation({
  args: { runStepId: v.id("runSteps"), retry: v.number() },
  handler: async (ctx, args) => {
    await retryStepNow(ctx, args.runStepId, args.retry);
  },
});

/**
 * Starts a finished run over, with the file and data that started it the first time
 * and the automation as it is now. For a run that failed once the cause is fixed.
 */
export const runAgain = mutation({
  args: { runId: v.id("runs") },
  returns: v.id("runs"),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new ConvexError({ code: "not_found", message: "This run no longer exists." });
    const { userId } = await requireMember(ctx, run.organizationId);
    if (run.status === "running" || run.status === "waiting") {
      throw new ConvexError({ code: "conflict", message: "This run is still going." });
    }
    const automation = await ctx.db.get(run.automationId);
    if (!automation) {
      throw new ConvexError({ code: "not_found", message: "This automation no longer exists." });
    }
    const started = await startRun(ctx, automation, run.triggerKind, run.trigger, userId);
    if (!started.ok) throw new ConvexError({ code: "invalid_input", message: started.message });
    return started.runId;
  },
});
