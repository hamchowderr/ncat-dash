import {
  type AutomationEdge,
  type AutomationNode,
  branchesToward,
  chooseFiles,
  clipRequest,
  downstreamOf,
  durationOf,
  type FileKind,
  getPlatform,
  graphProblem,
  type NodeStatus,
  nodeTypeOf,
  parseSilences,
  passedOverNodes,
  planClips,
  planJobs,
  readyNodes,
  settingsForLaterSteps,
  stepsBefore,
  type Taken,
  type TemplateContext,
  TemplateError,
  upstreamOf,
  valueFrom,
  valueSources,
  wantedKind,
  withBrand,
} from "@ncat-dash/automation-core";
import { getStep } from "@ncat-dash/step-catalog";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { finishCheck, startIf, startWait } from "./logic";
import { brandOf, enqueueJob, pump } from "./queue";

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

/**
 * The files a finished step hands to `node`. A step with one way out hands on all of its
 * files; an If hands on only those that left by the way that leads to `node`.
 */
function outputsToward(
  source: Doc<"runSteps"> | undefined,
  node: AutomationNode,
  run: Doc<"runs">,
): string[] {
  if (!source) return [];
  if (!source.branches) return source.outputs;
  const { branches } = source;
  return branchesToward(source.nodeId, node.id, run.edges as AutomationEdge[]).flatMap(
    (way) => branches[way] ?? [],
  );
}

/** The files handed on by the steps straight before a node, or the trigger's file. */
function incomingFiles(
  node: AutomationNode,
  run: Doc<"runs">,
  byNode: Map<string, Doc<"runSteps">>,
): string[] {
  const sources = upstreamOf(node.id, run.edges as AutomationEdge[]);
  if (sources.length === 0) return triggerFiles(run.trigger);
  return sources.flatMap((source) => outputsToward(byNode.get(source), node, run));
}

/**
 * The files a step works on: the nearest ones of the kind it wants. Usually those from
 * the step straight before; when that step made none of that kind (a transcript, a
 * thumbnail), the ones from further back, and last the file that started the run.
 */
export function filesFor(
  kind: FileKind,
  node: AutomationNode,
  run: Doc<"runs">,
  byNode: Map<string, Doc<"runSteps">>,
): string[] {
  const levels = stepsBefore(node.id, run.edges as AutomationEdge[]).map((ids) =>
    ids.flatMap((id) => outputsToward(byNode.get(id), node, run)),
  );
  return chooseFiles(kind, [...levels, triggerFiles(run.trigger)]);
}

export async function failStep(
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

  if (node.kind === "approval") {
    await ctx.db.patch(step._id, { status: "waiting_approval", startedAt: now });
    return;
  }

  if (node.kind === "clips") {
    await startClips(ctx, run, node, step, byNode, filesFor("video", node, run, byNode));
    return;
  }

  if (node.kind === "if") {
    await startIf(ctx, run, node, step, byNode);
    return;
  }

  if (node.kind === "wait") {
    await startWait(ctx, run, node, step, byNode);
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
    const urls = outputsToward(other, node, run);
    steps[nodeId] = { url: urls[0], urls, result: only?.result };
  }

  const inputs = filesFor(
    wantedKind(definition.primaryInput ?? definition.listInput?.field),
    node,
    run,
    byNode,
  );
  const nodes = run.nodes as AutomationNode[];
  const edges = run.edges as AutomationEdge[];
  // Text and data an earlier step made that this step takes, such as a transcript's
  // captions, and anything this step must switch on for a later step that is waiting.
  const nodeType = nodeTypeOf(node);
  const settings: Record<string, unknown> = {
    // The team's logo, colour, font and music fill whatever the step leaves empty.
    ...(nodeType
      ? withBrand(nodeType, node.input, await brandOf(ctx, run.organizationId))
      : node.input),
    ...settingsForLaterSteps(node, nodes, edges),
  };
  for (const source of valueSources(node, nodes, edges)) {
    const found = valueFrom(source.from.stepId ?? "", source.value, steps[source.from.id]?.result);
    if (found !== undefined) settings[source.field] = found;
  }
  let planned: Record<string, unknown>[];
  try {
    planned = planJobs(
      { primaryInput: definition.primaryInput, listInput: definition.listInput },
      settings,
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

  const queued = await enqueueAll(
    ctx,
    run,
    step,
    planned.map((input) => ({ stepId: definition.id, input })),
  );
  if (!queued.ok) {
    await failStep(ctx, run, step, byNode, queued.message);
    return;
  }
  const { jobIds } = queued;
  await ctx.db.patch(step._id, { status: "running", jobIds, startedAt: now });
}

// A pause must last this long, and be this quiet, to count as a place to cut.
const PAUSE_SECONDS = 0.4;
const PAUSE_NOISE = "-30dB";
// One "clips" step takes this many videos at most.
const MAX_VIDEOS_PER_CLIPS_STEP = 10;

/** Queues jobs for a step, all or nothing. Returns their ids, or the reason it failed. */
export async function enqueueAll(
  ctx: MutationCtx,
  run: Doc<"runs">,
  step: Doc<"runSteps">,
  wanted: { stepId: string; input: unknown }[],
): Promise<{ ok: true; jobIds: Id<"jobs">[] } | { ok: false; message: string }> {
  const jobIds: Id<"jobs">[] = [];
  for (const { stepId, input } of wanted) {
    const queued = await enqueueJob(ctx, {
      organizationId: run.organizationId,
      stepId,
      input,
      createdBy: run.startedBy ?? "automation",
      runStepId: step._id,
    });
    if (!queued.ok) {
      // Take back the jobs already queued; none has been sent yet.
      for (const jobId of jobIds) await ctx.db.delete(jobId);
      return { ok: false, message: queued.message };
    }
    jobIds.push(queued.jobId);
  }
  return { ok: true, jobIds };
}

/** First stage of a "clips" step: read each video's length and find its pauses. */
async function startClips(
  ctx: MutationCtx,
  run: Doc<"runs">,
  node: AutomationNode,
  step: Doc<"runSteps">,
  byNode: Map<string, Doc<"runSteps">>,
  inputs: string[],
) {
  if (!getPlatform(node.input.platform)) {
    await failStep(ctx, run, step, byNode, "Pick a platform for the clips.");
    return;
  }
  if (inputs.length === 0) {
    await failStep(ctx, run, step, byNode, "No video reached this step.");
    return;
  }
  if (inputs.length > MAX_VIDEOS_PER_CLIPS_STEP) {
    await failStep(
      ctx,
      run,
      step,
      byNode,
      `${inputs.length} videos reached this step; the most it takes at once is ${MAX_VIDEOS_PER_CLIPS_STEP}.`,
    );
    return;
  }
  const queued = await enqueueAll(
    ctx,
    run,
    step,
    inputs.flatMap((url) => [
      { stepId: "media-metadata", input: { media_url: url } },
      {
        stepId: "media-silence-detect",
        input: { media_url: url, duration: PAUSE_SECONDS, noise: PAUSE_NOISE },
      },
    ]),
  );
  if (!queued.ok) {
    await failStep(ctx, run, step, byNode, queued.message);
    return;
  }
  await ctx.db.patch(step._id, {
    status: "running",
    stage: "probe",
    jobIds: queued.jobIds,
    startedAt: Date.now(),
  });
}

/** Second stage of a "clips" step: plan the cuts and queue one job per clip. */
async function cutClips(
  ctx: MutationCtx,
  run: Doc<"runs">,
  step: Doc<"runSteps">,
  probes: Doc<"jobs">[],
) {
  const steps = await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .take(200);
  const byNode = new Map(steps.map((other) => [other.nodeId, other]));
  const node = (run.nodes as AutomationNode[]).find((candidate) => candidate.id === step.nodeId);
  const platform = getPlatform(node?.input.platform);
  if (!platform) {
    await failStep(ctx, run, step, byNode, "Pick a platform for the clips.");
    return;
  }

  const plan: NonNullable<Doc<"runSteps">["plan"]> = [];
  // Probes come in pairs per video: its metadata, then its pauses.
  for (let i = 0; i + 1 < probes.length; i += 2) {
    const [metadata, silence] = [probes[i], probes[i + 1]];
    const source = (metadata.input as { media_url: string }).media_url;
    const duration = metadata.status === "done" ? durationOf(metadata.result) : null;
    if (duration === null) {
      await failStep(
        ctx,
        run,
        step,
        byNode,
        metadata.error ?? "Could not read how long the video is.",
      );
      return;
    }
    // Without the pauses the video is still cut, just evenly.
    const pauses = silence.status === "done" ? parseSilences(silence.result) : [];
    for (const clip of planClips(duration, pauses, platform.maxSeconds)) {
      plan.push({ source, ...clip });
    }
  }
  if (plan.length === 0) {
    await failStep(ctx, run, step, byNode, "The video is too short to cut.");
    return;
  }
  if (plan.length > MAX_JOBS_PER_STEP) {
    await failStep(
      ctx,
      run,
      step,
      byNode,
      `That would make ${plan.length} clips; the most one step makes is ${MAX_JOBS_PER_STEP}.`,
    );
    return;
  }

  const queued = await enqueueAll(
    ctx,
    run,
    step,
    plan.map((clip) => ({
      stepId: "ffmpeg-compose",
      input: clipRequest(clip.source, clip, platform.frame),
    })),
  );
  if (!queued.ok) {
    await failStep(ctx, run, step, byNode, queued.message);
    return;
  }
  await ctx.db.patch(step._id, { stage: "cut", jobIds: queued.jobIds, plan });
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
  for (let pass = 0; pass <= nodes.length * 2; pass++) {
    const steps = await ctx.db
      .query("runSteps")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .take(200);
    const byNode = new Map(steps.map((step) => [step.nodeId, step]));
    const status = Object.fromEntries(steps.map((step) => [step.nodeId, step.status])) as Record<
      string,
      NodeStatus
    >;
    // The ways out each finished If used. A way that got no files leads nowhere this run.
    const taken: Taken = Object.fromEntries(
      steps.flatMap((step) =>
        step.branches
          ? [[step.nodeId, Object.keys(step.branches).filter((way) => step.branches![way].length)]]
          : [],
      ),
    );

    // Steps behind a way no file went are passed over, which can pass over more behind them.
    const passedOver = passedOverNodes(nodes, edges, status, taken);
    if (passedOver.length > 0) {
      for (const node of passedOver) {
        await ctx.db.patch(byNode.get(node.id)!._id, { status: "skipped", finishedAt: Date.now() });
      }
      continue;
    }

    const ready = readyNodes(nodes, edges, status, taken);
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

  if (step.stage === "probe") {
    await cutClips(ctx, run, step, jobs);
    await advance(ctx, run._id);
    return;
  }

  if (step.stage === "check") {
    await finishCheck(ctx, run, step, jobs);
    await advance(ctx, run._id);
    return;
  }

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
