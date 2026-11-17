/**
 * How the two logic steps run. An "if" reads what it needs to know about each file and
 * sorts the files into its two ways out; a "wait" holds its files and lets the run carry
 * on later. Neither changes a file.
 */
import {
  type AutomationNode,
  conditionProblem,
  type FileDetails,
  readCondition,
  readFileDetails,
  sortFiles,
  waitMs,
  waitProblem,
} from "@ncat-dash/automation-core";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { advance, enqueueAll, failStep, filesFor } from "./runner";

// One If sorts this many files at most.
const MAX_FILES_PER_IF = 100;

type StepsByNode = Map<string, Doc<"runSteps">>;

/** The details read from the file that started the run when it was uploaded, if any. */
function knownDetails(trigger: unknown): Map<string, FileDetails> {
  const { file_url: url, details } = (trigger ?? {}) as { file_url?: unknown; details?: unknown };
  const known = new Map<string, FileDetails>();
  if (typeof url === "string" && details && typeof details === "object") {
    known.set(url, details as FileDetails);
  }
  return known;
}

async function sortInto(
  ctx: MutationCtx,
  step: Doc<"runSteps">,
  node: AutomationNode,
  files: string[],
  details: Map<string, FileDetails | null>,
) {
  const condition = readCondition(node.input)!;
  const now = Date.now();
  await ctx.db.patch(step._id, {
    status: "done",
    outputs: files,
    branches: sortFiles(
      condition,
      files.map((url) => ({ url, details: details.get(url) ?? null })),
    ),
    startedAt: step.startedAt ?? now,
    finishedAt: now,
  });
}

/**
 * Starts an "if" step. A file whose details are already known (the upload that started
 * the run) is sorted straight away; any other file is read by the toolkit first.
 */
export async function startIf(
  ctx: MutationCtx,
  run: Doc<"runs">,
  node: AutomationNode,
  step: Doc<"runSteps">,
  byNode: StepsByNode,
) {
  const problem = conditionProblem(node.input);
  if (problem) {
    await failStep(ctx, run, step, byNode, problem);
    return;
  }
  const files = filesFor("any", node, run, byNode);
  if (files.length === 0) {
    await failStep(ctx, run, step, byNode, "No file reached this step.");
    return;
  }
  if (files.length > MAX_FILES_PER_IF) {
    await failStep(
      ctx,
      run,
      step,
      byNode,
      `${files.length} files reached this step; the most it sorts at once is ${MAX_FILES_PER_IF}.`,
    );
    return;
  }

  const known = knownDetails(run.trigger);
  const unread = files.filter((url) => !known.has(url));
  if (unread.length === 0) {
    await sortInto(ctx, step, node, files, known);
    return;
  }
  const queued = await enqueueAll(
    ctx,
    run,
    step,
    unread.map((url) => ({ stepId: "media-metadata", input: { media_url: url } })),
  );
  if (!queued.ok) {
    await failStep(ctx, run, step, byNode, queued.message);
    return;
  }
  await ctx.db.patch(step._id, {
    status: "running",
    stage: "check",
    jobIds: queued.jobIds,
    startedAt: Date.now(),
  });
}

/** Called when the toolkit has read every file of an "if" step: sorts them and finishes it. */
export async function finishCheck(
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
  if (!node || conditionProblem(node.input)) {
    await failStep(ctx, run, step, byNode, "This step's settings could not be read.");
    return;
  }
  // If the toolkit could read none of the files, something is wrong with it rather than
  // with them, and sending everything out by "no" would hide that.
  if (jobs.length > 0 && jobs.every((job) => job.status === "failed")) {
    await failStep(ctx, run, step, byNode, jobs[0].error ?? "The files could not be read.");
    return;
  }
  const details = new Map<string, FileDetails | null>(knownDetails(run.trigger));
  for (const job of jobs) {
    const url = (job.input as { media_url?: string }).media_url;
    if (url) details.set(url, job.status === "done" ? readFileDetails(job.result) : null);
  }
  await sortInto(ctx, step, node, filesFor("any", node, run, byNode), details);
}

/** Starts a "wait" step: notes when it ends and asks to be woken then. */
export async function startWait(
  ctx: MutationCtx,
  run: Doc<"runs">,
  node: AutomationNode,
  step: Doc<"runSteps">,
  byNode: StepsByNode,
) {
  const length = waitMs(node.input);
  if (length === null) {
    await failStep(ctx, run, step, byNode, waitProblem(node.input) ?? "Say how long to wait.");
    return;
  }
  const now = Date.now();
  await ctx.db.patch(step._id, {
    status: "running",
    stage: "wait",
    startedAt: now,
    resumeAt: now + length,
  });
  await ctx.scheduler.runAfter(length, internal.runs.wake, { runStepId: step._id });
}

/** Ends a "wait" step and hands on the files it was holding. Does nothing if the run stopped. */
export async function finishWait(ctx: MutationCtx, runStepId: Id<"runSteps">) {
  const step = await ctx.db.get(runStepId);
  if (!step || step.status !== "running" || step.stage !== "wait") return;
  const run = await ctx.db.get(step.runId);
  if (!run || (run.status !== "running" && run.status !== "waiting")) return;
  const steps = await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .take(200);
  const byNode = new Map(steps.map((other) => [other.nodeId, other]));
  const node = (run.nodes as AutomationNode[]).find((candidate) => candidate.id === step.nodeId);
  await ctx.db.patch(step._id, {
    status: "done",
    outputs: node ? filesFor("any", node, run, byNode) : [],
    finishedAt: Date.now(),
  });
  await advance(ctx, run._id);
}
