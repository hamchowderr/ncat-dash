import {
  explainFailure,
  approvalLimitMs,
  approvalSettings,
  askedToDecide,
  type AutomationEdge,
  type AutomationNode,
  branchesToward,
  limitWords,
  mayDecide,
  chooseFiles,
  clipRequest,
  clipsKeepShape,
  followShapeFrom,
  downstreamOf,
  failsOver,
  type FileDetails,
  isCaptionStep,
  needsDetails,
  withCaptionSetup,
  durationOf,
  type FileKind,
  getPlatform,
  tooShortFor,
  graphProblem,
  type NodeStatus,
  nodeTypeOf,
  parseSilences,
  passedOverNodes,
  planClips,
  planJobs,
  readFileDetails,
  readyNodes,
  retryDelayMs,
  retryLimit,
  settingsForLaterSteps,
  shouldRetry,
  stepsBefore,
  type Taken,
  type TemplateContext,
  TemplateError,
  upstreamOf,
  valueFrom,
  valueSources,
  wantedKind,
  withBrand,
  withDownloadLinks,
  withStart,
} from "@ncat-dash/automation-core";
import { getStep } from "@ncat-dash/step-catalog";
import { withTeamSteps } from "./teamSteps";
import { ConvexError } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { notify } from "./alerts";
import { runEnded, startAutomationStep, startingFiles } from "./chain";
import { cutListOf } from "./exports";
import { captionSetupOf } from "./captions";
import { finishCheck, knownDetails, startIf, startWait } from "./logic";
import { fillProjectSlots } from "./projects";
import { brandOf, enqueueJob, pump } from "./queue";
import { closeReviewForStep, openReviewForApproval } from "./reviews";

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
  options: {
    test?: string;
    /** The run that started this one, and the step that waits for it when one does. */
    parent?: { runId: Id<"runs">; runStepId?: Id<"runSteps">; chain: Id<"automations">[] };
    /** The project it works for: its finished files fill the project's empty slots. */
    project?: {
      projectId: Id<"projects">;
      deliverableId?: Id<"deliverables">;
      clientId?: Id<"clients">;
    };
  } = {},
): Promise<{ ok: true; runId: Id<"runs"> } | { ok: false; message: string }> {
  const problem = graphProblem(automation.nodes, automation.edges);
  if (problem) return { ok: false, message: problem };
  const { parent, project } = options;
  // A project's client wins over the automation's own, so the run is for the right client.
  const clientId = project ? project.clientId : automation.clientId;

  const runId = await ctx.db.insert("runs", {
    organizationId: automation.organizationId,
    automationId: automation._id,
    automationName: automation.name,
    status: "running",
    triggerKind,
    // A Drive or Dropbox share link the trigger handed over becomes its download link,
    // so every step, and the run page, works with the file itself.
    trigger: withDownloadLinks(trigger),
    nodes: automation.nodes,
    edges: automation.edges,
    error: null,
    startedBy,
    finishedAt: null,
    ...(options.test ? { test: options.test } : {}),
    ...(clientId ? { clientId } : {}),
    ...(project
      ? {
          projectId: project.projectId,
          ...(project.deliverableId ? { deliverableId: project.deliverableId } : {}),
        }
      : {}),
    ...(parent
      ? {
          parentRunId: parent.runId,
          ...(parent.runStepId ? { parentRunStepId: parent.runStepId } : {}),
          chain: [...parent.chain, automation._id],
        }
      : {}),
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

/** The files that started the run: the trigger's file, or all of those another run handed it. */
const triggerFiles = startingFiles;

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
  const edges = run.edges as AutomationEdge[];
  const node = (run.nodes as AutomationNode[]).find((other) => other.id === step.nodeId);
  // With a way for when it fails, the files it was given go that way instead, so a step
  // hung there can try something else with them. advance() passes over the usual way.
  const handled = node !== undefined && failsOver(node.id, edges);
  await ctx.db.patch(step._id, {
    status: "failed",
    error,
    startedAt: step.startedAt ?? now,
    finishedAt: now,
    retryAt: undefined,
    retryError: undefined,
    ...(handled ? { outputs: incomingFiles(node, run, byNode) } : {}),
  });
  if (handled) return;
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

  // A step that is turned off does none of its work and hands its files straight on.
  if (node.off && node.kind !== "if") {
    await ctx.db.patch(step._id, {
      status: "done",
      outputs: incomingFiles(node, run, byNode),
      startedAt: now,
      finishedAt: now,
    });
    return;
  }

  if (node.kind === "approval") {
    await startApproval(ctx, run, node, step, incomingFiles(node, run, byNode));
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

  if (node.kind === "automation") {
    await startAutomationStep(ctx, run, node, step, byNode, incomingFiles(node, run, byNode));
    return;
  }

  if (node.kind === "export") {
    // The timeline files are made from the cuts when someone downloads them, so all this
    // step does is make sure there are cuts to open, and hand its files on.
    if (!(await cutListOf(ctx, run, [...byNode.values()]))) {
      await failStep(
        ctx,
        run,
        step,
        byNode,
        "No cuts reached this step. Put it after a step that cuts the recording, such as Clips for a platform.",
      );
      return;
    }
    await ctx.db.patch(step._id, {
      status: "done",
      outputs: incomingFiles(node, run, byNode),
      startedAt: now,
      finishedAt: now,
    });
    return;
  }

  await startToolkitStep(ctx, run, node, step, byNode);
}

/**
 * Starts a toolkit step: works out its settings and queues one job per file. A caption
 * step may first read its videos' sizes ("size" stage); it comes back here with them.
 */
async function startToolkitStep(
  ctx: MutationCtx,
  run: Doc<"runs">,
  node: AutomationNode,
  step: Doc<"runSteps">,
  byNode: Map<string, Doc<"runSteps">>,
  sizes?: Map<string, FileDetails | null>,
) {
  const now = Date.now();
  await withTeamSteps(ctx, run.organizationId);
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
    // The name of the file that started the run fills a title left empty.
    ...(nodeType
      ? withStart(
          nodeType,
          withBrand(nodeType, node.input, await brandOf(ctx, run.organizationId, run.clientId)),
          (run.trigger ?? {}) as Record<string, unknown>,
        )
      : node.input),
    ...settingsForLaterSteps(node, nodes, edges),
  };
  // Follow the speaker straight after Clips makes the platform's shape unless one was picked.
  const followShape = isEmptySetting(settings.aspect) ? followShapeFrom(node, nodes, edges) : null;
  if (followShape) settings.aspect = followShape;
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

  if (isCaptionStep(definition.id)) {
    // The team's word fixes, and its caption style for each video's shape, from Settings.
    const setup = await captionSetupOf(ctx, run.organizationId);
    const field = definition.primaryInput ?? "";
    const urlOf = (input: Record<string, unknown>) =>
      typeof input[field] === "string" ? (input[field] as string) : "";
    if (!sizes && needsDetails(node.input, setup)) {
      const known = knownDetails(run.trigger);
      const unknown = [...new Set(planned.map(urlOf))].filter((url) => url && !known.has(url));
      if (unknown.length > 0) {
        // Read each video's size first; the caption jobs are planned again once it is known.
        const probes = await enqueueAll(
          ctx,
          run,
          step,
          unknown.map((url) => ({ stepId: "media-metadata", input: { media_url: url } })),
        );
        if (!probes.ok) {
          await failStep(ctx, run, step, byNode, probes.message);
          return;
        }
        await ctx.db.patch(step._id, {
          status: "running",
          stage: "size",
          jobIds: probes.jobIds,
          startedAt: now,
        });
        return;
      }
    }
    const details = new Map([...knownDetails(run.trigger), ...(sizes ?? [])]);
    const brandFont = (await brandOf(ctx, run.organizationId, run.clientId)).font;
    planned = planned.map((input) =>
      withCaptionSetup(input, setup, { details: details.get(urlOf(input)), brandFont }),
    );
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
  await ctx.db.patch(step._id, {
    status: "running",
    stage: undefined,
    jobIds,
    startedAt: step.startedAt ?? now,
  });
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
  const sources: NonNullable<Doc<"runSteps">["sources"]> = [];
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
    const short = tooShortFor(platform, duration);
    if (short) {
      await failStep(ctx, run, step, byNode, short);
      return;
    }
    // Kept so the cuts can be opened in a video editor. A video whose frame rate or
    // picture size could not be read is still cut, it just cannot be exported.
    const details = readFileDetails(metadata.result);
    if (details?.fps && details.width && details.height) {
      sources.push({
        url: source,
        fps: details.fps,
        width: details.width,
        height: details.height,
        duration,
        hasAudio: details.hasAudio ?? true,
        ...(details.audioChannels ? { audioChannels: details.audioChannels } : {}),
        ...(details.audioSampleRate ? { audioSampleRate: details.audioSampleRate } : {}),
      });
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

  const keepShape = clipsKeepShape(
    step.nodeId,
    run.nodes as AutomationNode[],
    run.edges as AutomationEdge[],
  );
  const queued = await enqueueAll(
    ctx,
    run,
    step,
    plan.map((clip) => ({
      stepId: "ffmpeg-compose",
      // Clips handed straight to Follow the speaker keep the whole wide picture to follow in.
      input: keepShape
        ? clipRequest(clip.source, clip, "original")
        : clipRequest(clip.source, clip, platform.frame, platform.box),
    })),
  );
  if (!queued.ok) {
    await failStep(ctx, run, step, byNode, queued.message);
    return;
  }
  await ctx.db.patch(step._id, { stage: "cut", jobIds: queued.jobIds, plan, sources });
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
        // A step that failed with a way for when it fails was dealt with; the run is fine.
        const failed = steps.find(
          (step) => step.status === "failed" && !failsOver(step.nodeId, edges),
        );
        await ctx.db.patch(runId, {
          status: failed ? "failed" : "done",
          error: failed?.error ?? null,
          finishedAt: Date.now(),
        });
        // A step waiting on this run moves on, and automations that follow it start.
        await runEnded(ctx, run, failed ? "failed" : "done", failed?.error ?? null);
        // A run for a project puts its finished files in the project's empty slots.
        if (!failed && run.projectId && !run.test) await fillProjectSlots(ctx, run);
        // Its finished files go into the team's folder, so they show in Files.
        if (!failed) await ctx.scheduler.runAfter(0, internal.files.keepFinished, { runId });
        // A person who rejects at an approval step already knows, one that ran out of
        // time has its own alert, and a step with a way for when it fails was dealt with;
        // anything else that ends a run is something the team should hear about.
        const broken = steps.find(
          (step) =>
            step.status === "failed" &&
            !step.decidedBy &&
            !step.decidedAutomatically &&
            !failsOver(step.nodeId, edges),
        );
        if (broken && !run.test) await alertTeam(ctx, run, broken);
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

/**
 * Pauses the run at an approval step: opens a review room with the files, tells the
 * people asked to decide (in the bell and by email), and books the time limit if it has
 * one.
 */
async function startApproval(
  ctx: MutationCtx,
  run: Doc<"runs">,
  node: AutomationNode,
  step: Doc<"runSteps">,
  files: string[],
) {
  const now = Date.now();
  const { reviewers, limit, whenTimeUp } = approvalSettings(node.input);
  const limitMs = approvalLimitMs(node.input);
  const decideBy = limitMs === null ? undefined : now + limitMs;
  await ctx.db.patch(step._id, {
    status: "waiting_approval",
    startedAt: now,
    reviewers,
    decideBy,
  });
  if (decideBy !== undefined) {
    await ctx.scheduler.runAt(decideBy, internal.runs.approvalTimeUp, { runStepId: step._id });
  }
  await openReviewForApproval(ctx, run, step, files);

  const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
    organizationId: run.organizationId,
  });
  const named = askedToDecide(reviewers, team.members);
  // With nobody named, or nobody named still on the team, the whole team is asked.
  const everyone = !team.members.some((member) => reviewers.includes(member.userId));
  await notify(ctx, {
    organizationId: run.organizationId,
    kind: "approval_waiting",
    recipients: everyone ? undefined : named.map((member) => member.userId),
    runStepId: step._id,
    runId: run._id,
    automationId: run.automationId,
    automationName: run.automationName,
    stepName: node.label ?? nodeTypeOf(node)?.title,
    message: limit
      ? `If nobody decides within ${limitWords(limit)}, it is ${whenTimeUp === "approve" ? "approved" : "rejected"} by itself.`
      : "It waits until someone approves or rejects it.",
    retries: 0,
  });
}

/**
 * Tells the team a run has failed. Every member sees it under the bell until they open
 * it, and gets an email when email is set up.
 */
async function alertTeam(ctx: MutationCtx, run: Doc<"runs">, step: Doc<"runSteps">) {
  const node = (run.nodes as AutomationNode[]).find((candidate) => candidate.id === step.nodeId);
  await notify(ctx, {
    organizationId: run.organizationId,
    kind: "run_failed",
    runId: run._id,
    automationId: run.automationId,
    automationName: run.automationName,
    stepName: node ? (node.label ?? nodeTypeOf(node)?.title) : undefined,
    // In plain words: the bell, email and Slack are read by people, not developers. The
    // run keeps the full text for "Show details".
    message: explainFailure(step.error).reason,
    retries: step.retries ?? 0,
  });
}

/** How many times a failed step tries again for this team. */
export async function retriesFor(ctx: QueryCtx, organizationId: string): Promise<number> {
  const settings = await ctx.db
    .query("teamSettings")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .first();
  return retryLimit(settings?.stepRetries);
}

/**
 * Books another try for a step whose jobs failed, after a wait that grows with each
 * try. Returns false when the step has no tries left or the failure is one another try
 * cannot fix; the caller then fails the step.
 */
async function bookRetry(
  ctx: MutationCtx,
  run: Doc<"runs">,
  step: Doc<"runSteps">,
  failures: Doc<"jobs">[],
): Promise<boolean> {
  const used = step.retries ?? 0;
  if (!shouldRetry(used, await retriesFor(ctx, run.organizationId), failures)) return false;
  const retry = used + 1;
  const delay = retryDelayMs(retry);
  await ctx.db.patch(step._id, {
    retries: retry,
    retryAt: Date.now() + delay,
    retryError: failures[0].error ?? "The step failed.",
  });
  await ctx.db.patch(run._id, { retries: (run.retries ?? 0) + 1 });
  await ctx.scheduler.runAfter(delay, internal.runs.retryStep, { runStepId: step._id, retry });
  return true;
}

/**
 * Runs a booked try: sends each job that failed again, exactly as it was, and leaves
 * the ones that worked alone. Does nothing if the run was stopped in the meantime.
 */
export async function retryStepNow(
  ctx: MutationCtx,
  runStepId: Id<"runSteps">,
  retry: number,
): Promise<void> {
  const step = await ctx.db.get(runStepId);
  if (!step || step.status !== "running" || step.retryAt === undefined || step.retries !== retry) {
    return;
  }
  const run = await ctx.db.get(step.runId);
  if (!run || (run.status !== "running" && run.status !== "waiting")) return;

  // The new job takes the old one's place, so the order the step relies on is kept.
  const jobIds = [...step.jobIds];
  const added: Id<"jobs">[] = [];
  let problem: string | null = null;
  for (let i = 0; i < jobIds.length && problem === null; i++) {
    const job = await ctx.db.get(jobIds[i]);
    if (!job || job.status !== "failed") continue;
    const queued = await enqueueJob(ctx, {
      organizationId: run.organizationId,
      stepId: job.stepId,
      input: job.input,
      createdBy: job.createdBy,
      runStepId: step._id,
    });
    if (queued.ok) {
      jobIds[i] = queued.jobId;
      added.push(queued.jobId);
    } else problem = queued.message;
  }
  if (problem !== null) {
    for (const jobId of added) await ctx.db.delete(jobId);
    const steps = await ctx.db
      .query("runSteps")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .take(200);
    await failStep(ctx, run, step, new Map(steps.map((other) => [other.nodeId, other])), problem);
    await advance(ctx, run._id);
    return;
  }
  await ctx.db.patch(step._id, { jobIds, retryAt: undefined });
  await pump(ctx, run.organizationId);
}

/** A caption step's videos have been read: queue its caption jobs with the style for each. */
async function finishSizes(
  ctx: MutationCtx,
  run: Doc<"runs">,
  step: Doc<"runSteps">,
  jobs: Doc<"jobs">[],
) {
  const steps = await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .take(200);
  const byNode = new Map(steps.map((other) => [other.nodeId, other]));
  const node = (run.nodes as AutomationNode[]).find((candidate) => candidate.id === step.nodeId);
  if (!node) return;
  // A video that could not be read is still captioned, with the toolkit's own look.
  const sizes = new Map<string, FileDetails | null>();
  for (const job of jobs) {
    const url = (job.input as { media_url?: string }).media_url;
    if (url) sizes.set(url, job.status === "done" ? readFileDetails(job.result) : null);
  }
  await startToolkitStep(ctx, run, node, step, byNode, sizes);
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

  // A job that failed gets another go before the step is given up on.
  const failures = jobs.filter((job) => job.status === "failed");
  if (failures.length > 0 && (await bookRetry(ctx, run, step, failures))) return;

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

  if (step.stage === "size") {
    await finishSizes(ctx, run, step, jobs);
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
      retryError: undefined,
    });
  }
  await advance(ctx, run._id);
}

/**
 * Records the decision on an approval step and moves the run on. `userId` is the person
 * deciding, who must be one of the reviewers it named or a team owner or admin; null when
 * the time limit ran out and the step decided by itself.
 */
export async function decideApproval(
  ctx: MutationCtx,
  step: Doc<"runSteps">,
  approved: boolean,
  userId: string | null,
): Promise<void> {
  const run = await ctx.db.get(step.runId);
  if (!run) return;
  if (userId !== null) {
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: run.organizationId,
    });
    const reviewers = step.reviewers ?? [];
    if (!mayDecide(reviewers, team.members, userId)) {
      const names = askedToDecide(reviewers, team.members).map((member) => member.name);
      throw new ConvexError({
        code: "forbidden",
        message: `Only ${names.join(" or ")}, or a team owner or admin, can decide this.`,
      });
    }
  }
  const steps = await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .take(200);
  const byNode = new Map(steps.map((other) => [other.nodeId, other]));
  const node = (run.nodes as AutomationNode[]).find((candidate) => candidate.id === step.nodeId);
  const decided = userId === null ? { decidedAutomatically: true } : { decidedBy: userId };

  if (approved && node) {
    // An approval hands on exactly the files it was shown.
    await ctx.db.patch(step._id, {
      status: "done",
      outputs: incomingFiles(node, run, byNode),
      finishedAt: Date.now(),
      ...decided,
    });
  } else {
    const limit = node ? approvalSettings(node.input).limit : null;
    await failStep(
      ctx,
      run,
      step,
      byNode,
      userId === null
        ? `Nobody decided${limit ? ` within ${limitWords(limit)}` : " in time"}, so it was rejected.`
        : "Rejected at the approval step.",
    );
    await ctx.db.patch(step._id, decided);
  }
  // The reviewers no longer need the alert asking them to decide.
  const waiting = await ctx.db
    .query("alerts")
    .withIndex("by_runStep", (q) => q.eq("runStepId", step._id))
    .take(10);
  for (const alert of waiting) await ctx.db.delete(alert._id);
  // Nobody decided in time: the people who were asked hear what it decided by itself.
  if (userId === null && !run.test) {
    const limit = node ? approvalSettings(node.input).limit : null;
    const within = limit ? ` within ${limitWords(limit)}` : " in time";
    await notify(ctx, {
      organizationId: run.organizationId,
      kind: "approval_timed_out",
      recipients: waiting.find((alert) => alert.kind === "approval_waiting")?.recipients,
      runId: run._id,
      automationId: run.automationId,
      automationName: run.automationName,
      stepName: node ? (node.label ?? nodeTypeOf(node)?.title) : undefined,
      message: approved
        ? `Nobody decided${within}, so it was approved and the run carried on.`
        : `Nobody decided${within}, so it was rejected and the run stopped.`,
      retries: 0,
    });
  }
  await closeReviewForStep(ctx, step._id, approved, userId);
  await advance(ctx, run._id);
}

/** Decides an approval step nobody decided in time, the way its settings say. */
export async function approvalTimeUp(ctx: MutationCtx, runStepId: Id<"runSteps">): Promise<void> {
  const step = await ctx.db.get(runStepId);
  if (!step || step.status !== "waiting_approval") return;
  const run = await ctx.db.get(step.runId);
  if (!run || (run.status !== "running" && run.status !== "waiting")) return;
  const node = (run.nodes as AutomationNode[]).find((candidate) => candidate.id === step.nodeId);
  const approve = node ? approvalSettings(node.input).whenTimeUp === "approve" : false;
  await decideApproval(ctx, step, approve, null);
}

function isEmptySetting(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}
