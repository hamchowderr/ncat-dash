import {
  branchOf,
  FIRST_TRIGGER,
  explainFailure,
  approvalLimitMs,
  approvalSettings,
  askedToDecide,
  burnRequest,
  burnsInFast,
  captionLanguageOf,
  captionVideoOf,
  canUseKnownWords,
  hasKnownWords,
  MAX_SENT_WORDS,
  withKnownWords,
  withoutKnownWords,
  wordsRequest,
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
  type FileLabel,
  isCaptionStep,
  needsDetails,
  withCaptionSetup,
  durationOf,
  type FileKind,
  getPlatform,
  tooShortFor,
  graphProblem,
  isWorkflowReview,
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
  stepFileLabels,
  fileFields,
  joinOf,
  pairs,
  partnersOf,
  readSource,
} from "@takewon/automation-core";
import { startSend } from "./send";
import { type Item, recordItems } from "./items";
import { mustWaitForSlot } from "./runLimit";
import { getStep, pictureGivenForVideo } from "@takewon/step-catalog";
import { withTeamSteps } from "./teamSteps";
import { ConvexError } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { notify } from "./alerts";
import { earlierFiles, runEnded, startAutomationStep, startingFiles } from "./chain";
import { cutListOf } from "./exports";
import { collectUrls } from "./outputs";
import { captionSetupOf } from "./captions";
import { knownWordsFor } from "./knownWords";
import { finishCheck, knownDetails, startIf, startWait } from "./logic";
import { finishListening, listenRequest, startListening, wordsFor } from "./moments";
import { type DisclosureNote, hearFirst } from "./disclosure";
import { finishLaying, finishLooking } from "./broll";
import { finishMotionListening, isMotionKind, isPlaceKind } from "./motion";
import { finishFootageCheck, startFootageCheck } from "./footage";
import { startSubtitles } from "./subtitles";
import { fillProjectSlots } from "./projects";
import { brandOf, enqueueJob, pump } from "./queue";
import { closeReviewForStep, openReviewForApproval } from "./reviews";
import { refusalFor } from "./access";
import { workflowRunGraph } from "./workflows";

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
    /**
     * Which trigger started it, when the automation has more than one: the run only does
     * the steps that trigger starts. The first trigger when left out.
     */
    triggerId?: string;
    /** The run that started this one, and the step that waits for it when one does. */
    parent?: { runId: Id<"runs">; runStepId?: Id<"runSteps">; chain: Id<"automations">[] };
    /** The project it works for: its finished files fill the project's empty slots. */
    project?: {
      projectId: Id<"projects">;
      deliverableId?: Id<"deliverables">;
      clientId?: Id<"clients">;
    };
    /** Where the run's end is reported, for a webhook call that asked. */
    callbackUrl?: string;
  } = {},
): Promise<{ ok: true; runId: Id<"runs"> } | { ok: false; message: string }> {
  const problem = graphProblem(automation.nodes, automation.edges);
  if (problem) return { ok: false, message: problem };
  // A test runs exactly the step it was given; any other run only its trigger's branch.
  const triggerId = options.triggerId ?? FIRST_TRIGGER;
  const { nodes, edges } = options.test
    ? { nodes: automation.nodes, edges: automation.edges }
    : branchOf(automation, triggerId);
  if (nodes.length === 0) {
    return { ok: false, message: "That trigger is not connected to any steps yet." };
  }
  // A team whose free trial is over, or that the operator blocked, keeps everything, but
  // nothing new runs.
  const refusal = await refusalFor(ctx, automation.organizationId, startedBy);
  if (refusal) return { ok: false, message: refusal.message };
  const { parent, project } = options;
  // A project's client wins over the automation's own, so the run is for the right client.
  const clientId = project ? project.clientId : automation.clientId;
  // A workflow's review, when the automation is part of one, is added to the run's steps.
  const graph = await workflowRunGraph(ctx, automation, nodes, edges, options.test !== undefined);

  const runId = await ctx.db.insert("runs", {
    organizationId: automation.organizationId,
    automationId: automation._id,
    automationName: automation.name,
    status: "running",
    triggerKind,
    ...(triggerId !== FIRST_TRIGGER ? { triggerId } : {}),
    // A Drive or Dropbox share link the trigger handed over becomes its download link,
    // so every step, and the run page, works with the file itself.
    trigger: withDownloadLinks(trigger),
    nodes: graph.nodes,
    edges: graph.edges,
    error: null,
    startedBy,
    finishedAt: null,
    ...(options.test ? { test: options.test } : {}),
    ...(clientId ? { clientId } : {}),
    ...(graph.workflowId ? { workflowId: graph.workflowId } : {}),
    ...(options.callbackUrl ? { callbackUrl: options.callbackUrl } : {}),
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
  for (const node of graph.nodes) {
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
  // An automation that runs only a few at a time keeps this one waiting for its turn.
  if (await mustWaitForSlot(ctx, automation, runId, options.test !== undefined)) {
    await ctx.db.patch(runId, { status: "waiting", heldForSlot: true });
    return { ok: true, runId };
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

/**
 * The steps straight before a node whose files it takes, in the order they are connected.
 * One taking whichever line finishes first takes only the line that finished first, and
 * one pairing files takes its main files from the first line (the others are its partners).
 */
function meetingSources(
  node: AutomationNode,
  run: Doc<"runs">,
  byNode: Map<string, Doc<"runSteps">>,
): string[] {
  const sources = upstreamOf(node.id, run.edges as AutomationEdge[]);
  if (sources.length < 2) return sources;
  const mode = joinOf(node);
  if (mode === "first") {
    const finished = sources
      .map((id) => byNode.get(id))
      .filter(
        (step): step is Doc<"runSteps"> =>
          step !== undefined &&
          (step.status === "done" || step.status === "failed") &&
          outputsToward(step, node, run).length > 0,
      )
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
    return finished.length > 0 ? [finished[0].nodeId] : sources;
  }
  if (mode === "source" || mode === "position") return sources.slice(0, 1);
  return sources;
}

/** The files handed on by the steps straight before a node, or the trigger's file. */
export function incomingFiles(
  node: AutomationNode,
  run: Doc<"runs">,
  byNode: Map<string, Doc<"runSteps">>,
): string[] {
  const sources = meetingSources(node, run, byNode);
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
  const levels = stepsBefore(node.id, run.edges as AutomationEdge[]).map((ids, index) =>
    (index === 0 ? meetingSources(node, run, byNode) : ids).flatMap((id) =>
      outputsToward(byNode.get(id), node, run),
    ),
  );
  // A run another one started also has that run's earlier files, nearest first, for a
  // step that wants a kind of file the other run did not finish with.
  return chooseFiles(kind, [...levels, triggerFiles(run.trigger), ...earlierFiles(run.trigger)]);
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

/** Marks a step passed over, with nothing made, and every step after it with it. */
async function passOver(
  ctx: MutationCtx,
  run: Doc<"runs">,
  step: Doc<"runSteps">,
  byNode: Map<string, Doc<"runSteps">>,
) {
  const now = Date.now();
  await ctx.db.patch(step._id, { status: "skipped", startedAt: now, finishedAt: now });
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

  // A workflow's review is for files that go out, so a run that already failed skips it.
  if (isWorkflowReview(node)) {
    const failed = [...byNode.values()].some(
      (other) =>
        other.status === "failed" && !failsOver(other.nodeId, run.edges as AutomationEdge[]),
    );
    if (failed) {
      await ctx.db.patch(step._id, { status: "skipped", startedAt: now, finishedAt: now });
      return;
    }
  }

  if (node.kind === "approval") {
    await startApproval(ctx, run, node, step, incomingFiles(node, run, byNode));
    return;
  }

  if (node.kind === "clips") {
    await startClips(ctx, run, node, step, byNode, filesFor("video", node, run, byNode));
    return;
  }

  if (
    node.kind === "moments" ||
    node.kind === "chapters" ||
    node.kind === "broll" ||
    node.kind === "broll-plan" ||
    node.kind === "motion-plan"
  ) {
    // Chapters reads speech, so an audio file will do; moments are cut from a video, and
    // B-Roll is laid over one.
    const kind = node.kind === "chapters" ? "media" : "video";
    await startListening(ctx, run, node, step, byNode, filesFor(kind, node, run, byNode));
    return;
  }

  if (isPlaceKind(node.kind)) {
    await startListening(ctx, run, node, step, byNode, filesFor("video", node, run, byNode));
    return;
  }

  if (node.kind === "footage-check") {
    await startFootageCheck(ctx, run, node, step, byNode);
    return;
  }

  if (node.kind === "subtitles") {
    await startSubtitles(ctx, run, node, step, byNode);
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

  if (node.kind === "send") {
    await startSend(ctx, run, node, step, byNode);
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
        "No cuts reached this step. Put it after a step that cuts the recording, such as Clips for a platform or Best moments.",
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
 * A named value an earlier step made, by the file each of its jobs worked on: for a
 * transcript step, each file's captions.
 */
async function valuesByFile(
  ctx: MutationCtx,
  step: Doc<"runSteps"> | undefined,
  source: { value: string; from: AutomationNode },
): Promise<Map<string, unknown>> {
  const found = new Map<string, unknown>();
  const field = getStep(source.from.stepId ?? "")?.primaryInput;
  if (!step || step.status !== "done" || !field) return found;
  for (const jobId of step.jobIds) {
    const job = await ctx.db.get(jobId);
    if (job?.status !== "done") continue;
    const file = (job.input as Record<string, unknown>)[field];
    const value = valueFrom(source.from.stepId ?? "", source.value, job.result);
    if (typeof file === "string" && value !== undefined) found.set(file, value);
  }
  return found;
}

/**
 * Each job's partner files from the other lines meeting at a pairing step, or a plain
 * reason a job has none. A file field already given a fixed address keeps it.
 */
function pairPartners(
  node: AutomationNode,
  run: Doc<"runs">,
  byNode: Map<string, Doc<"runSteps">>,
  nodeType: NonNullable<ReturnType<typeof nodeTypeOf>>,
  primary: string,
  planned: Record<string, unknown>[],
): Record<string, unknown>[] | string {
  const mode = joinOf(node) as "source" | "position";
  const [first, ...others] = upstreamOf(node.id, run.edges as AutomationEdge[]);
  if (!first || others.length === 0) return planned;
  const known = new Map<string, Item>();
  for (const other of byNode.values()) {
    for (const item of (other.items ?? []) as Item[]) known.set(item.url, item);
  }
  const traced = (url: string) => ({ url, source: known.get(url)?.source ?? url });
  const nameOf = (url: string) => decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() ?? url);
  const main = planned.map((input) => traced(String(input[primary] ?? "")));

  let result = planned;
  for (const field of fileFields(nodeType)) {
    // Only fields that take a kind of media, so an address to call back is never paired.
    if (field === primary || wantedKind(field) === "any") continue;
    const set = readSource(node.input[field]);
    const from =
      set.from === "auto"
        ? others
        : set.from === "step" && others.includes(set.id)
          ? [set.id]
          : null;
    if (!from) continue;
    const pool = chooseFiles(wantedKind(field), [
      from.flatMap((id) => outputsToward(byNode.get(id), node, run)),
    ]);
    if (pool.length === 0) continue;
    const partners = partnersOf(mode, main, pool.map(traced));
    const missing = partners.findIndex((partner) => partner === null);
    if (missing >= 0) {
      const file = nameOf(main[missing].url);
      return mode === "source"
        ? `Nothing from the other line started from the same upload as ${file}, so it has nothing to be paired with.`
        : `The other line handed on fewer files than the first, so ${file} has nothing to be paired with.`;
    }
    result = result.map((input, index) => ({ ...input, [field]: partners[index] }));
  }
  return result;
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
  /** Whether the step's videos were just transcribed, so nothing is to be heard again. */
  heard = false,
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
  // A step that is no use without a setting nobody has given yet, such as the music it lays
  // under each video, is passed over: the run carries on without what it would have made.
  if (definition.skipsWithout && isEmptySetting(settings[definition.skipsWithout])) {
    await passOver(ctx, run, step, byNode);
    return;
  }
  // Follow the speaker straight after Clips makes the platform's shape unless one was picked.
  const followShape = isEmptySetting(settings.aspect) ? followShapeFrom(node, nodes, edges) : null;
  if (followShape) settings.aspect = followShape;
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
  // A value an earlier step made, such as a transcript's captions, belongs to the file it
  // worked on: each job gets the one made for its own file, and none for a file cut or
  // changed since, which then works it out for itself.
  const primary = definition.primaryInput;
  if (primary) {
    for (const source of valueSources(node, nodes, edges)) {
      const values = await valuesByFile(ctx, byNode.get(source.from.id), source);
      planned = planned.map((input) => {
        const found = values.get(String(input[primary] ?? ""));
        return found === undefined || !isEmptySetting(input[source.field])
          ? input
          : { ...input, [source.field]: found };
      });
    }
  }
  // A step pairing the files of the lines that meet at it gives each job its partner
  // files from the other lines: the one that started from the same upload, or the one in
  // the same place.
  if (primary && pairs(node) && nodeType) {
    const paired = pairPartners(node, run, byNode, nodeType, primary, planned);
    if (typeof paired === "string") {
      await failStep(ctx, run, step, byNode, paired);
      return;
    }
    planned = paired;
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

  // A video step handed a picture can only fail, after a while and in programmers' words,
  // so it stops at once in plain ones and is not tried again.
  const picture = planned
    .map((input) => pictureGivenForVideo(definition, input))
    .find((said) => said !== null);
  if (picture) {
    await failStep(ctx, run, step, byNode, picture);
    return;
  }

  if (isCaptionStep(definition.id)) {
    // The team's word fixes, and its caption style for each video's shape, from Settings.
    const setup = await captionSetupOf(ctx, run.organizationId);
    const field = definition.primaryInput ?? "";
    const urlOf = (input: Record<string, unknown>) =>
      typeof input[field] === "string" ? (input[field] as string) : "";
    // "Caption video" in another language: the step draws the caption file itself from
    // each video's words, translated and timed (captionTranslation.ts), then burns it in.
    const languages = planned.map(captionLanguageOf);
    const translating =
      definition.id === "video-caption" &&
      languages.some((code) => code !== null) &&
      planned.every(burnsInFast);
    if (translating && !heard && !step.heardWords) {
      // Each video's words first, heard once and kept for every later step.
      const unheard: string[] = [];
      for (const url of new Set(planned.map(urlOf))) {
        if (url && !(await wordsFor(ctx, run.organizationId, url))) unheard.push(url);
      }
      if (unheard.length > 0) {
        const queued = await enqueueAll(
          ctx,
          run,
          step,
          unheard.map((url) => ({ stepId: "media-transcribe", input: listenRequest(url) })),
        );
        if (!queued.ok) {
          await failStep(ctx, run, step, byNode, queued.message);
          return;
        }
        await ctx.db.patch(step._id, {
          status: "running",
          stage: "hear",
          heardWords: true,
          jobIds: queued.jobIds,
          startedAt: step.startedAt ?? now,
        });
        return;
      }
    }
    // The caption file is drawn at the video's own size, so a translating step reads it.
    if (!sizes && (translating || needsDetails(node.input, setup))) {
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

    if (translating) {
      const captionPlan = planned.map((input, index) => {
        const video = urlOf(input);
        const size = details.get(video);
        return {
          video,
          language: languages[index] ?? "",
          look: lookOf(input.settings),
          // A video whose size could not be read is drawn as a wide 1080p one.
          width: size?.width && size.height ? size.width : 1920,
          height: size?.width && size.height ? size.height : 1080,
        };
      });
      await ctx.db.patch(step._id, {
        status: "running",
        stage: "translate",
        jobIds: [],
        captionPlan,
        startedAt: step.startedAt ?? now,
      });
      await ctx.scheduler.runAfter(0, internal.captionTranslation.translate, {
        runStepId: step._id,
      });
      return;
    }

    // "Caption video" is made the fast way: the timed words first ("listen"), then one
    // quick save that burns them in ("render"). See burn-captions.ts.
    if (definition.id === "video-caption" && planned.every(burnsInFast)) {
      // Words already known (the upload was transcribed when it came in, or the clip was
      // cut from such a video) go with the request, so the video is not heard again.
      const known = await knownWordsFor(
        ctx,
        run,
        [...byNode.values()],
        planned.filter(canUseKnownWords).map(captionVideoOf),
      );
      const words = await enqueueAll(
        ctx,
        run,
        step,
        planned.map((input) => {
          const request = wordsRequest(input);
          const heard = canUseKnownWords(input) ? known.get(captionVideoOf(input)) : undefined;
          return {
            stepId: "media-generate-ass",
            input:
              heard && heard.length <= MAX_SENT_WORDS
                ? withKnownWords(request, heard, details.get(captionVideoOf(input)))
                : request,
          };
        }),
      );
      if (!words.ok) {
        await failStep(ctx, run, step, byNode, words.message);
        return;
      }
      await ctx.db.patch(step._id, {
        status: "running",
        stage: "listen",
        jobIds: words.jobIds,
        startedAt: step.startedAt ?? now,
      });
      return;
    }
  }

  // A step keeping a paid creator's disclosure in every cut hears its videos first.
  let disclosures: DisclosureNote[] = [];
  if (definition.readsWords) {
    const found = await hearFirst(ctx, run, step, byNode, definition, planned, heard);
    if (found === "hearing" || found === "failed") return;
    disclosures = found;
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
    ...(disclosures.length > 0 ? { disclosures } : {}),
  });
}

/**
 * After a step's videos were transcribed to find a paid-ad disclosure ("hear", see
 * lib/disclosure.ts): queues its jobs, which now get the words.
 */
export async function finishHearing(ctx: MutationCtx, run: Doc<"runs">, step: Doc<"runSteps">) {
  const steps = await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .take(200);
  const byNode = new Map(steps.map((other) => [other.nodeId, other]));
  const node = (run.nodes as AutomationNode[]).find((candidate) => candidate.id === step.nodeId);
  if (!node) return;
  if (node.kind === "subtitles") await startSubtitles(ctx, run, node, step, byNode);
  else await startToolkitStep(ctx, run, node, step, byNode, undefined, true);
  await advance(ctx, run._id);
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
  // A run waiting for its turn starts only when startWaitingRuns lets it.
  if (run.heldForSlot) return;
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
    // Finished steps write down where their files came from before anything reads them.
    await recordItems(ctx, run, byNode);
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
            // Check Footage already told the team what was wrong.
            !step.footage?.stopped &&
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

/** The most failed tries a step keeps in its log. */
const MAX_TRIES_KEPT = 20;

/** A step's log of failed tries with one more on the end. */
function withTry(step: Doc<"runSteps">, error: string): { at: number; error: string }[] {
  return [...(step.tries ?? []), { at: Date.now(), error }].slice(-MAX_TRIES_KEPT);
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
  const error = failures[0].error ?? "The step failed.";
  await ctx.db.patch(step._id, {
    retries: retry,
    retryAt: Date.now() + delay,
    retryError: error,
    tries: withTry(step, error),
  });
  await ctx.db.patch(run._id, { retries: (run.retries ?? 0) + 1 });
  await ctx.scheduler.runAfter(delay, internal.runs.retryStep, { runStepId: step._id, retry });
  return true;
}

/**
 * Books another try for a step whose asking of the agent failed in a way that may pass
 * (the model was busy, the agent server could not be reached), on the same waits and
 * count as a toolkit job. `ask` is the part of the step to do again. Returns false when
 * the step has no tries left, and the caller then fails it.
 */
export async function bookAgentRetry(
  ctx: MutationCtx,
  run: Doc<"runs">,
  step: Doc<"runSteps">,
  error: string,
  ask: AgentAsk,
): Promise<boolean> {
  const used = step.retries ?? 0;
  if (used >= (await retriesFor(ctx, run.organizationId))) return false;
  const retry = used + 1;
  const delay = retryDelayMs(retry);
  await ctx.db.patch(step._id, {
    retries: retry,
    retryAt: Date.now() + delay,
    retryError: error,
    tries: withTry(step, error),
  });
  await ctx.db.patch(run._id, { retries: (run.retries ?? 0) + 1 });
  await ctx.scheduler.runAfter(delay, internal.runs.retryAgentStep, {
    runStepId: step._id,
    retry,
    ask,
  });
  return true;
}

/** The parts of a step that ask the agent, which can be tried again on their own. */
export type AgentAsk = "pick" | "match" | "choose";

/** Runs a booked try of asking the agent. Does nothing if the run was stopped meanwhile. */
export async function retryAgentStepNow(
  ctx: MutationCtx,
  runStepId: Id<"runSteps">,
  retry: number,
  ask: AgentAsk,
): Promise<void> {
  const step = await ctx.db.get(runStepId);
  if (!step || step.status !== "running" || step.retryAt === undefined || step.retries !== retry) {
    return;
  }
  const run = await ctx.db.get(step.runId);
  if (!run || (run.status !== "running" && run.status !== "waiting")) return;
  await ctx.db.patch(step._id, { retryAt: undefined });
  if (ask === "pick") {
    await ctx.scheduler.runAfter(0, internal.moments.pick, { runStepId, live: true });
  } else if (ask === "match") {
    await ctx.scheduler.runAfter(0, internal.broll.match, { runStepId });
  } else {
    await ctx.scheduler.runAfter(0, internal.broll.choose, { runStepId });
  }
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

/** A caption job's look settings, kept for drawing its caption file (plain values only). */
function lookOf(settings: unknown): Record<string, string | number | boolean> {
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return {};
  return Object.fromEntries(
    Object.entries(settings).filter(
      (entry): entry is [string, string | number | boolean] =>
        ["string", "number", "boolean"].includes(typeof entry[1]) &&
        (typeof entry[1] !== "number" || Number.isFinite(entry[1])),
    ),
  );
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

/**
 * Second stage of "Caption video": the timed words are in, so burn each caption file into
 * its video with one quick save. The step finishes with those saves' files.
 */
async function burnCaptions(
  ctx: MutationCtx,
  run: Doc<"runs">,
  step: Doc<"runSteps">,
  words: Doc<"jobs">[],
) {
  const steps = await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .take(200);
  const byNode = new Map(steps.map((other) => [other.nodeId, other]));
  const failed = words.find((job) => job.status === "failed");
  if (failed && words.some((job) => hasKnownWords(job.input))) {
    // A toolkit from before caption files could be made from known words refuses them.
    // It is asked again the old way, hearing each video itself.
    const again = await enqueueAll(
      ctx,
      run,
      step,
      words.map((job) => ({
        stepId: "media-generate-ass",
        input: withoutKnownWords(job.input as Record<string, unknown>),
      })),
    );
    if (!again.ok) {
      await failStep(ctx, run, step, byNode, again.message);
      return;
    }
    await ctx.db.patch(step._id, { stage: "listen", jobIds: again.jobIds });
    return;
  }
  if (failed) {
    await failStep(ctx, run, step, byNode, failed.error ?? "The captions could not be made.");
    return;
  }
  const wanted: { stepId: string; input: unknown }[] = [];
  for (const job of words) {
    const video = captionVideoOf({ video_url: (job.input as { media_url?: unknown }).media_url });
    const captions = job.outputs[0] ?? collectUrls(job.result)[0];
    if (!video || !captions) {
      await failStep(ctx, run, step, byNode, "The toolkit made no caption file for a video.");
      return;
    }
    wanted.push({ stepId: "ffmpeg-compose", input: burnRequest(video, captions) });
  }
  const queued = await enqueueAll(ctx, run, step, wanted);
  if (!queued.ok) {
    await failStep(ctx, run, step, byNode, queued.message);
    return;
  }
  await ctx.db.patch(step._id, { stage: "render", jobIds: queued.jobIds });
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

  if (step.stage === "listen") {
    const node = (run.nodes as AutomationNode[]).find((other) => other.id === step.nodeId);
    if (node?.kind === "step" && node.stepId === "video-caption") {
      await burnCaptions(ctx, run, step, jobs);
      await advance(ctx, run._id);
      return;
    }
    if (node && isPlaceKind(node.kind)) {
      const steps = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .take(200);
      await finishMotionListening(
        ctx,
        run,
        step,
        new Map(steps.map((other) => [other.nodeId, other])),
        jobs,
      );
    } else await finishListening(ctx, run, step, jobs);
    await advance(ctx, run._id);
    return;
  }

  if (step.stage === "look") {
    await finishLooking(ctx, run, step, jobs);
    await advance(ctx, run._id);
    return;
  }

  if (step.stage === "lay") {
    await finishLaying(ctx, run, step, jobs);
    await advance(ctx, run._id);
    return;
  }

  if (step.stage === "footage") {
    await finishFootageCheck(ctx, run, step, jobs);
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

  if (step.stage === "hear") {
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
        step.heardWords
          ? `Could not transcribe the video to ${(run.nodes as AutomationNode[]).find((one) => one.id === step.nodeId)?.kind === "subtitles" ? "translate its subtitles" : "caption it in another language"}: ${failed.error ?? "the toolkit gave no reason."}`
          : `Could not transcribe the video to find its paid-ad disclosure: ${failed.error ?? "the toolkit gave no reason."}`,
      );
      await advance(ctx, run._id);
      return;
    }
    // The words are read in from the toolkit's transcript files, then the jobs queued.
    await ctx.scheduler.runAfter(0, internal.disclosure.hear, { runStepId: step._id });
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
    const labels = await variantLabels(ctx, run, step, jobs);
    const kind = (run.nodes as AutomationNode[]).find((other) => other.id === step.nodeId)?.kind;
    // Add Motion Graphics and Add Sound Effects keep the videos that had nothing to draw,
    // unchanged, in `outputs` while the rest render.
    const keptAsIs = kind && isMotionKind(kind) && step.stage === "render" ? step.outputs : [];
    await ctx.db.patch(runStepId, {
      status: "done",
      outputs: [...keptAsIs, ...jobs.flatMap((job) => job.outputs)],
      finishedAt: Date.now(),
      retryError: undefined,
      ...(labels.length > 0 ? { labels } : {}),
    });
  }
  await advance(ctx, run._id);
}

/**
 * The variant codes for a finished step's files ("h02_c01_15s"), built on the codes the
 * run's earlier steps gave the files it worked on. Empty for steps that make none.
 */
async function variantLabels(
  ctx: MutationCtx,
  run: Doc<"runs">,
  step: Doc<"runSteps">,
  jobs: Doc<"jobs">[],
): Promise<FileLabel[]> {
  const node = (run.nodes as AutomationNode[]).find((other) => other.id === step.nodeId);
  if (node?.kind === "cleanup") {
    // Each job made one file; its code was decided with the plan.
    const codes = (step.cleaned ?? []).flatMap((one) => one.labels);
    return jobs.flatMap((job, at) => {
      const label = codes[at];
      return label ? job.outputs.map((url) => ({ url, label })) : [];
    });
  }
  const definition = node?.stepId ? getStep(node.stepId) : undefined;
  if (!node?.stepId || !definition?.outputLabels) return [];
  const earlier = (
    await ctx.db
      .query("runSteps")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .take(200)
  ).flatMap((other) => other.labels ?? []);
  if (definition.labelsFollow && earlier.length === 0) return [];
  const stepId = node.stepId;
  return stepFileLabels(
    jobs.map((job) => {
      if (job.stepId === stepId) return job;
      // A later stage of the step, such as captions burned in with one quick save: the
      // file it worked on is that save's first input.
      const first = (job.input as { inputs?: { file_url?: unknown }[] } | null)?.inputs?.[0]
        ?.file_url;
      return {
        stepId,
        input:
          definition.primaryInput && typeof first === "string"
            ? { ...node.input, [definition.primaryInput]: first }
            : {},
        outputs: job.outputs,
      };
    }),
    earlier,
  );
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
  /** Why it was sent back, in the reviewer's words, shown as the step's error. */
  reason?: string,
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
        : reason?.trim()
          ? `Sent back: ${reason.trim().slice(0, 500)}`
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
  // Messages in chat apps that asked about it now say how it ended, without buttons.
  await ctx.scheduler.runAfter(0, internal.chatAlerts.settle, { runStepId: step._id });
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
