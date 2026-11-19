import { type AutomationNode, nodeTypeOf } from "@ncat-dash/automation-core";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx, query } from "./_generated/server";
import { runEnded } from "./lib/chain";
import { approvalView, membersOf } from "./lib/approvals";
import { isMember, requireMember } from "./lib/authz";
import { factsOf } from "./lib/facts";
import { finishWait } from "./lib/logic";
import { pickUp as pickUpRun, pickUpCheck, stepsOf } from "./lib/pickUp";
import { pump } from "./lib/queue";
import { EDITORS, editorFiles as filesForEditors } from "@ncat-dash/timeline-export";
import { captionsOf, cutListOf, editorsOf, finishedFiles } from "./lib/exports";
import { outputNamesOf, startingFileName } from "./lib/outputs";
import {
  approvalTimeUp as decideWhenTimeIsUp,
  decideApproval,
  retriesFor,
  retryStepNow,
  startRun,
} from "./lib/runner";

export { startingFileName };

/** The name of the step a test run tried. */
function testName(run: Doc<"runs">): string {
  const node = (run.nodes as AutomationNode[]).find((candidate) => candidate.id === run.test);
  return node ? (node.label ?? nodeTypeOf(node)?.title ?? "a step") : "a step";
}

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
    // How many times someone picked it up where it stopped after it failed.
    pickedUp: run.pickedUp ?? 0,
    // For a test of one step: that step's name, as it was when tested.
    testOf: run.test ? testName(run) : null,
  };
}

/** Enough of another run to link to it. */
function linkTo(run: Doc<"runs">) {
  return {
    runId: run._id,
    automationId: run.automationId,
    automationName: run.automationName,
    status: run.status,
    // How it came from the run it links from: a step that ran it, or following it.
    how: run.triggerKind === "finished" ? ("followed" as const) : ("step" as const),
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

/**
 * The automation's newest run, with just enough of each step to light up the editor's
 * canvas while it goes. Null when it has never run.
 */
export const latestForAutomation = query({
  args: { automationId: v.id("automations") },
  handler: async (ctx, args) => {
    const automation = await ctx.db.get(args.automationId);
    if (!automation) return null;
    if (!(await isMember(ctx, automation.organizationId))) return null;
    const run = await ctx.db
      .query("runs")
      .withIndex("by_automation", (q) => q.eq("automationId", args.automationId))
      .order("desc")
      .first();
    if (!run) return null;
    const steps = await ctx.db
      .query("runSteps")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .take(200);
    return {
      ...summary(run),
      steps: steps.map((step) => ({
        nodeId: step.nodeId,
        status: step.status,
        jobCount: step.jobIds.length,
        branches: step.branches,
        stage: step.stage,
        resumeAt: step.resumeAt,
        retryAt: step.retryAt ?? null,
      })),
    };
  },
});

/** One run with the live state of every step. */
export const get = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    if (!(await isMember(ctx, run.organizationId))) return null;
    const { userId } = await requireMember(ctx, run.organizationId);
    const steps = await ctx.db
      .query("runSteps")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .take(200);
    const approvalNodes = new Set(
      (run.nodes as { id: string; kind: string }[])
        .filter((node) => node.kind === "approval")
        .map((node) => node.id),
    );
    const members = approvalNodes.size > 0 ? await membersOf(ctx, run.organizationId) : [];
    const parent = run.parentRunId ? await ctx.db.get(run.parentRunId) : null;
    const started = await ctx.db
      .query("runs")
      .withIndex("by_parentRun", (q) => q.eq("parentRunId", args.runId))
      .take(50);
    return {
      ...summary(run),
      // Whether the run's cuts can be opened in a video editor.
      hasCuts: (await cutListOf(ctx, run, steps)) !== null,
      trigger: run.trigger,
      // The file that started the run, by name, when a file did.
      startedWith: startingFileName(run.trigger),
      // Readable names for the run's files, by link.
      outputNames: outputNamesOf(run, steps),
      // How many times a failed step tries again for this team.
      retryLimit: await retriesFor(ctx, run.organizationId),
      // Whether it can be picked up where it stopped, and from which step, or why not.
      pickUp: run.status === "failed" ? pickUpCheck(run, steps) : null,
      // The run that started this one, when another run did.
      startedByRun: parent ? linkTo(parent) : null,
      // Runs this one started: by a Run an automation step, or by being followed.
      startedRuns: started.map(linkTo),
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
            // What the step found out, readable: a transcript, a length. Only for one file,
            // since a list of facts per file would bury the page.
            facts: jobs.length === 1 && jobs[0]?.status === "done" ? factsOf(jobs[0].result) : [],
            stage: step.stage,
            plan: step.plan,
            // For Best moments: what it picked. For Chapters: the chapters it placed.
            moments: step.moments ?? null,
            chapters: step.chapters ?? null,
            pickNote: step.pickNote ?? null,
            // For an If: the files that left by each way. For a Wait: when it carries on.
            branches: step.branches,
            resumeAt: step.resumeAt,
            // For a Run an automation step: the run it started.
            childRunId: step.childRunId ?? null,
            retries: step.retries ?? 0,
            // Set while the step waits to try again.
            retryAt: step.retryAt ?? null,
            retryError: step.retryError ?? null,
            // For an approval step: who is asked, by when, and who decided.
            approval: approvalNodes.has(step.nodeId)
              ? approvalView(step, run, members, userId)
              : null,
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
      // Readable names for the clips, by link, to save them under.
      clipNames: outputNamesOf(run, steps),
    };
  },
});

/** Steps across the team that are waiting for someone to approve them. */
export const waitingApprovals = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const members = await membersOf(ctx, args.organizationId);
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
        ...approvalView(step, run, members, userId),
      });
    }
    return found;
  },
});

/**
 * Approves or rejects an approval step. The reviewers it names may decide, and so may the
 * team's owners and admins; with no reviewers named, anyone on the team.
 */
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
    await cancelRun(ctx, run);
  },
});

/**
 * Stops a run, and every run one of its "Run an automation" steps is waiting on. A step
 * waiting on this run is told it was stopped.
 */
async function cancelRun(ctx: MutationCtx, run: Doc<"runs">): Promise<void> {
  if (run.status !== "running" && run.status !== "waiting") return;
  const now = Date.now();
  const steps = await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .take(200);
  const waitedOn: Id<"runs">[] = [];
  for (const step of steps) {
    if (step.status === "running" && step.childRunId) waitedOn.push(step.childRunId);
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
  await ctx.db.patch(run._id, { status: "cancelled", finishedAt: now });
  for (const childId of waitedOn) {
    const child = await ctx.db.get(childId);
    if (child) await cancelRun(ctx, child);
  }
  await runEnded(ctx, run, "cancelled", null);
  await pump(ctx, run.organizationId);
}

/** Fires when a Wait step's time is up, and lets the run carry on. */
export const wake = internalMutation({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    await finishWait(ctx, args.runStepId);
  },
});

/** Decides an approval step whose time limit has passed. Scheduled by the runner. */
export const approvalTimeUp = internalMutation({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    await decideWhenTimeIsUp(ctx, args.runStepId);
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
    // A test runs its one step again, as it was tested; anything else runs the whole
    // automation as it is now.
    const started = run.test
      ? await startRun(
          ctx,
          { ...automation, nodes: run.nodes, edges: run.edges },
          run.triggerKind,
          run.trigger,
          userId,
          { test: run.test },
        )
      : await startRun(ctx, automation, run.triggerKind, run.trigger, userId);
    if (!started.ok) throw new ConvexError({ code: "invalid_input", message: started.message });
    return started.runId;
  },
});

// How many runs the team-wide list reads, newest first.
const TEAM_RUNS = 100;
// How many failed runs one press picks up at most.
const PICK_UP_AT_ONCE = 25;

/**
 * The team's runs across every automation, newest first, for the Runs page: all of
 * them, or only those that failed. Tests of one step are left out. A failed run says
 * which step failed and whether it can be picked up where it stopped.
 */
export const listForTeam = query({
  args: {
    organizationId: v.string(),
    status: v.union(v.literal("all"), v.literal("failed")),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const runs =
      args.status === "failed"
        ? await ctx.db
            .query("runs")
            .withIndex("by_organization_and_status", (q) =>
              q.eq("organizationId", args.organizationId).eq("status", "failed"),
            )
            .order("desc")
            .take(TEAM_RUNS)
        : await ctx.db
            .query("runs")
            .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
            .order("desc")
            .take(TEAM_RUNS);
    const failedCount = (
      await ctx.db
        .query("runs")
        .withIndex("by_organization_and_status", (q) =>
          q.eq("organizationId", args.organizationId).eq("status", "failed"),
        )
        .take(TEAM_RUNS)
    ).filter((run) => run.test === undefined).length;
    const rows = await Promise.all(
      runs
        .filter((run) => run.test === undefined)
        .map(async (run) => {
          const check =
            run.status === "failed" ? pickUpCheck(run, await stepsOf(ctx, run._id)) : null;
          return {
            ...summary(run),
            startedWith: startingFileName(run.trigger),
            failedStep: check?.ok ? check.stepName : null,
            canPickUp: check?.ok ?? false,
            whyNot: check && !check.ok ? check.reason : null,
          };
        }),
    );
    return { runs: rows, failedCount };
  },
});

/**
 * Picks a failed run up where it stopped: what already worked keeps its files and the
 * run carries on from the step that failed, with the automation's settings as they are
 * now when its steps are still the same.
 */
export const pickUp = mutation({
  args: { runId: v.id("runs") },
  returns: v.object({ withCurrentSettings: v.boolean() }),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new ConvexError({ code: "not_found", message: "This run no longer exists." });
    await requireMember(ctx, run.organizationId);
    const result = await pickUpRun(ctx, run);
    if (!result.ok) throw new ConvexError({ code: "conflict", message: result.reason });
    return { withCurrentSettings: result.withCurrentSettings };
  },
});

/**
 * Picks up several failed runs at once, or every one that can be when no list is
 * given. Runs that cannot be picked up are passed over and counted.
 */
export const pickUpMany = mutation({
  args: { organizationId: v.string(), runIds: v.optional(v.array(v.id("runs"))) },
  returns: v.object({ pickedUp: v.number(), passedOver: v.number(), more: v.boolean() }),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const candidates = args.runIds
      ? (await Promise.all(args.runIds.map((runId) => ctx.db.get(runId)))).filter(
          (run): run is Doc<"runs"> => run !== null && run.organizationId === args.organizationId,
        )
      : await ctx.db
          .query("runs")
          .withIndex("by_organization_and_status", (q) =>
            q.eq("organizationId", args.organizationId).eq("status", "failed"),
          )
          .order("desc")
          .take(TEAM_RUNS)
          .then((runs) => runs.filter((run) => run.test === undefined));
    let pickedUp = 0;
    let passedOver = 0;
    let more = false;
    for (const run of candidates) {
      if (pickedUp >= PICK_UP_AT_ONCE) {
        more = true;
        break;
      }
      const result = await pickUpRun(ctx, run);
      if (result.ok) pickedUp++;
      else passedOver++;
    }
    return { pickedUp, passedOver, more };
  },
});
