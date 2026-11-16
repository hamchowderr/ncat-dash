import {
  type AutomationEdge,
  type AutomationNode,
  downstreamOf,
  graphProblem,
  type NodeStatus,
  planJobs,
  readyNodes,
  type TemplateContext,
  TemplateError,
  upstreamOf,
} from "@ncat-dash/automation-core";
import { getStep } from "@ncat-dash/step-catalog";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { enqueueJob, pump } from "./queue";

// One step may fan out over this many incoming files at most.
const MAX_JOBS_PER_STEP = 100;

export type TriggerKind = Doc<"runs">["triggerKind"];

/**
 * Starts a run of an automation: copies its steps into the run, then starts every step
 * that has nothing upstream. Returns the run id, or a reason it could not start.
 */
export async function startRun(
  ctx: MutationCtx,
  automation: Doc<"automations">,
  triggerKind: TriggerKind,
  trigger: Record<string, unknown>,
  startedBy: string | null,
): Promise<{ ok: true; runId: Id<"runs"> } | { ok: false; message: string }> {
  const problem = graphProblem(automation.nodes, automation.edges);
  if (problem) return { ok: false, message: problem };

  const runId = await ctx.db.insert("runs", {
    organizationId: automation.organizationId,
    automationId: automation._id,
    automationName: automation.name,
    status: "running",
    triggerKind,
    trigger,
    nodes: automation.nodes,
    edges: automation.edges,
    error: null,
    startedBy,
    finishedAt: null,
  });
  for (const node of automation.nodes) {
    await ctx.db.insert("runSteps", {
      runId,
      organizationId: automation.organizationId,
      nodeId: node.id,
      status: "pending",
      jobIds: [],
      outputs: [],
      error: null,
      startedAt: null,
      finishedAt: null,
    });
  }
  await advance(ctx, runId);
  return { ok: true, runId };
}

function triggerFiles(trigger: unknown): string[] {
  const fileUrl = (trigger as { file_url?: unknown } | null)?.file_url;
  return typeof fileUrl === "string" && fileUrl !== "" ? [fileUrl] : [];
}

/** The files that reach a node: its upstream steps' outputs, or the trigger's file. */
function incomingFiles(
  node: AutomationNode,
  run: Doc<"runs">,
  byNode: Map<string, Doc<"runSteps">>,
): string[] {
  const sources = upstreamOf(node.id, run.edges as AutomationEdge[]);
  if (sources.length === 0) return triggerFiles(run.trigger);
  return sources.flatMap((source) => byNode.get(source)?.outputs ?? []);
}

async function failStep(
  ctx: MutationCtx,
  run: Doc<"runs">,
  step: Doc<"runSteps">,
  byNode: Map<string, Doc<"runSteps">>,
  error: string,
) {
  const now = Date.now();
  await ctx.db.patch(step._id, {
    status: "failed",
    error,
    startedAt: step.startedAt ?? now,
    finishedAt: now,
  });
  // Whatever this step fed can no longer run. Other branches carry on.
  for (const nodeId of downstreamOf(step.nodeId, run.edges as AutomationEdge[])) {
    const below = byNode.get(nodeId);
    if (below && below.status === "pending") {
      await ctx.db.patch(below._id, { status: "skipped", finishedAt: now });
    }
  }
}

async function startNode(
  ctx: MutationCtx,
  run: Doc<"runs">,
  node: AutomationNode,
  step: Doc<"runSteps">,
  byNode: Map<string, Doc<"runSteps">>,
) {
  const now = Date.now();
  const inputs = incomingFiles(node, run, byNode);

  if (node.kind === "approval") {
    await ctx.db.patch(step._id, { status: "waiting_approval", startedAt: now });
    return;
  }

  const definition = node.stepId ? getStep(node.stepId) : undefined;
  if (!definition) {
    await failStep(ctx, run, step, byNode, "This step is no longer in the catalog.");
    return;
  }

  // What placeholders can read: every finished step's files and, for a step that ran
  // as a single job, that job's result.
  const steps: TemplateContext["steps"] = {};
  for (const [nodeId, other] of byNode) {
    if (other.status !== "done") continue;
    const only = other.jobIds.length === 1 ? await ctx.db.get(other.jobIds[0]) : null;
    steps[nodeId] = { url: other.outputs[0], urls: other.outputs, result: only?.result };
  }

  let planned: Record<string, unknown>[];
  try {
    planned = planJobs(
      { primaryInput: definition.primaryInput, listInput: definition.listInput },
      node.input,
      { inputs, trigger: (run.trigger ?? {}) as Record<string, unknown>, steps },
    );
  } catch (error) {
    if (!(error instanceof TemplateError)) throw error;
    await failStep(ctx, run, step, byNode, error.message);
    return;
  }
  if (planned.length > MAX_JOBS_PER_STEP) {
    await failStep(
      ctx,
      run,
      step,
      byNode,
      `${planned.length} files reached this step; the most it takes at once is ${MAX_JOBS_PER_STEP}.`,
    );
    return;
  }

  const jobIds: Id<"jobs">[] = [];
  for (const input of planned) {
    const queued = await enqueueJob(ctx, {
      organizationId: run.organizationId,
      stepId: definition.id,
      input,
      createdBy: run.startedBy ?? "automation",
      runStepId: step._id,
    });
    if (!queued.ok) {
      // Take back the jobs already queued for this step; none has been sent yet.
      for (const jobId of jobIds) await ctx.db.delete(jobId);
      await failStep(ctx, run, step, byNode, queued.message);
      return;
    }
    jobIds.push(queued.jobId);
  }
  await ctx.db.patch(step._id, { status: "running", jobIds, startedAt: now });
}

/**
 * Moves a run on: starts every step whose upstream steps are done, and closes the run
 * when nothing is left to do. Safe to call at any time; it only acts on what is ready.
 */
export async function advance(ctx: MutationCtx, runId: Id<"runs">): Promise<void> {
  const run = await ctx.db.get(runId);
  if (!run || (run.status !== "running" && run.status !== "waiting")) return;
  const nodes = run.nodes as AutomationNode[];
  const edges = run.edges as AutomationEdge[];

  // Starting a step can fail it at once (a missing file, a bad setting), which changes
  // what else is ready, so re-read until a pass starts nothing.
  for (let pass = 0; pass <= nodes.length; pass++) {
    const steps = await ctx.db
      .query("runSteps")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .take(200);
    const byNode = new Map(steps.map((step) => [step.nodeId, step]));
    const status = Object.fromEntries(steps.map((step) => [step.nodeId, step.status])) as Record<
      string,
      NodeStatus
    >;

    const ready = readyNodes(nodes, edges, status);
    if (ready.length === 0) {
      const open = steps.filter((step) =>
        ["pending", "running", "waiting_approval"].includes(step.status),
      );
      if (open.length === 0) {
        const failed = steps.find((step) => step.status === "failed");
        await ctx.db.patch(runId, {
          status: failed ? "failed" : "done",
          error: failed?.error ?? null,
          finishedAt: Date.now(),
        });
      } else {
        const working = open.some((step) => step.status === "running");
        const next = working ? "running" : "waiting";
        if (run.status !== next) await ctx.db.patch(runId, { status: next });
      }
      break;
    }
    for (const node of ready) {
      const fresh = await ctx.db.get(byNode.get(node.id)!._id);
      if (fresh?.status === "pending") await startNode(ctx, run, node, fresh, byNode);
    }
  }
  await pump(ctx, run.organizationId);
}

/** Called when a job that belongs to a run reaches a final state. */
export async function onJobFinished(ctx: MutationCtx, runStepId: Id<"runSteps">): Promise<void> {
  const step = await ctx.db.get(runStepId);
  if (!step || step.status !== "running") return;
  const run = await ctx.db.get(step.runId);
  if (!run) return;

  const jobs = [];
  for (const jobId of step.jobIds) {
    const job = await ctx.db.get(jobId);
    if (job) jobs.push(job);
  }
  if (jobs.some((job) => job.status === "queued" || job.status === "running")) return;

  const failed = jobs.find((job) => job.status === "failed");
  if (failed) {
    const steps = await ctx.db
      .query("runSteps")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .take(200);
    await failStep(
      ctx,
      run,
      step,
      new Map(steps.map((other) => [other.nodeId, other])),
      failed.error ?? "The step failed.",
    );
  } else {
    await ctx.db.patch(runStepId, {
      status: "done",
      outputs: jobs.flatMap((job) => job.outputs),
      finishedAt: Date.now(),
    });
  }
  await advance(ctx, run._id);
}

/** Records a person's decision on an approval step and moves the run on. */
export async function decideApproval(
  ctx: MutationCtx,
  step: Doc<"runSteps">,
  approved: boolean,
  userId: string,
): Promise<void> {
  const run = await ctx.db.get(step.runId);
  if (!run) return;
  const steps = await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .take(200);
  const byNode = new Map(steps.map((other) => [other.nodeId, other]));
  const node = (run.nodes as AutomationNode[]).find((candidate) => candidate.id === step.nodeId);

  if (approved && node) {
    // An approval hands on exactly the files it was shown.
    await ctx.db.patch(step._id, {
      status: "done",
      outputs: incomingFiles(node, run, byNode),
      decidedBy: userId,
      finishedAt: Date.now(),
    });
  } else {
    await failStep(ctx, run, step, byNode, "Rejected at the approval step.");
    await ctx.db.patch(step._id, { decidedBy: userId });
  }
  await advance(ctx, run._id);
}
