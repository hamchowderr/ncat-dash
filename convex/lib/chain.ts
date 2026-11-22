// Runs that start other runs: the "Run an automation" step, and automations whose trigger
// follows another one. The rules for what may start what are in automation-core's
// chain.ts; this is where runs are started, waited on and finished.
import {
  type AutomationEdge,
  type AutomationNode,
  chainProblem,
  followsEnd,
  stepsBefore,
  targetOf,
  waitsForRun,
} from "@ncat-dash/automation-core";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { reportRunEnd } from "./hooks";
import { advance, failStep, startRun } from "./runner";
import { teamEnabledWithTrigger, triggersOfKind } from "./triggers";

/** The automations that led to a run, itself last. Older runs only know themselves. */
export function chainOf(run: Doc<"runs">): Id<"automations">[] {
  return run.chain ?? [run.automationId];
}

/**
 * The files a run hands to whatever it started, with the name of the file that started it
 * (`from` is that run's trigger), so a title left empty there still reads as that video's.
 */
export function runFiles(files: string[], from?: unknown): Record<string, unknown> {
  const name = (from ?? {}) as { file_name?: unknown };
  const fileName =
    typeof name.file_name === "string" && name.file_name !== ""
      ? { file_name: name.file_name }
      : {};
  return files.length > 0 ? { file_url: files[0], files, ...fileName } : fileName;
}

/**
 * The files a finished run ends with: those of each step that did its work and handed
 * them to nothing that also did, in the order the steps are drawn.
 */
export function finishedFilesOf(run: Doc<"runs">, steps: Doc<"runSteps">[]): string[] {
  const edges = run.edges as AutomationEdge[];
  const byNode = new Map(steps.map((step) => [step.nodeId, step]));
  const found: string[] = [];
  for (const node of run.nodes as AutomationNode[]) {
    const step = byNode.get(node.id);
    if (step?.status !== "done") continue;
    const handedOn = edges.some(
      (edge) => edge.source === node.id && byNode.get(edge.target)?.status === "done",
    );
    if (handedOn) continue;
    for (const url of step.outputs) if (!found.includes(url)) found.push(url);
  }
  return found;
}

/**
 * The files a finished run made on its way to its finished files, nearest first: those of
 * the steps straight before the last ones, then theirs, and last the files it started with.
 * A follower that wants another kind of file than the run finished with, such as the video
 * behind an episode's MP3, takes the nearest of that kind from here.
 */
export function earlierFilesOf(
  run: Doc<"runs">,
  steps: Doc<"runSteps">[],
  finished: string[],
): string[][] {
  const edges = run.edges as AutomationEdge[];
  const byNode = new Map(steps.map((step) => [step.nodeId, step]));
  const leads = new Set(edges.map((edge) => edge.source));
  const levels: string[][] = [];
  const seen = new Set(finished);
  for (const node of run.nodes as AutomationNode[]) {
    if (leads.has(node.id)) continue;
    stepsBefore(node.id, edges).forEach((ids, depth) => {
      for (const id of ids) {
        const step = byNode.get(id);
        if (step?.status !== "done") continue;
        for (const url of step.outputs) {
          if (seen.has(url)) continue;
          seen.add(url);
          (levels[depth] ??= []).push(url);
        }
      }
    });
  }
  const started = startingFiles(run.trigger).filter((url) => !seen.has(url));
  return [
    ...levels.filter((level) => level && level.length > 0),
    ...(started.length ? [started] : []),
  ];
}

/** What a follower's run was handed besides its own files: see `earlierFilesOf`. */
export function earlierFiles(trigger: unknown): string[][] {
  const { earlier } = (trigger ?? {}) as { earlier?: unknown };
  if (!Array.isArray(earlier)) return [];
  return earlier
    .filter((level): level is unknown[] => Array.isArray(level))
    .map((level) => level.filter((url): url is string => typeof url === "string" && url !== ""))
    .filter((level) => level.length > 0);
}

/**
 * Starts the automation a "Run an automation" step names, on the files that reached it.
 * Waiting, the step stays running until that run ends (see `runEnded`); otherwise it is
 * done at once and hands its own files on.
 */
export async function startAutomationStep(
  ctx: MutationCtx,
  run: Doc<"runs">,
  node: AutomationNode,
  step: Doc<"runSteps">,
  byNode: Map<string, Doc<"runSteps">>,
  files: string[],
): Promise<void> {
  const targetId = targetOf(node);
  const normalized = targetId ? ctx.db.normalizeId("automations", targetId) : null;
  const target = normalized ? await ctx.db.get(normalized) : null;
  if (!target || target.organizationId !== run.organizationId) {
    await failStep(
      ctx,
      run,
      step,
      byNode,
      targetId
        ? "The automation this step runs no longer exists. Pick another."
        : "Pick the automation this step runs.",
    );
    return;
  }
  const chain = chainOf(run);
  const problem = chainProblem(chain, target._id, target.name);
  if (problem) {
    await failStep(ctx, run, step, byNode, problem);
    return;
  }

  const wait = waitsForRun(node);
  const started = await startRun(
    ctx,
    target,
    "automation",
    runFiles(files, run.trigger),
    run.startedBy,
    {
      parent: { runId: run._id, ...(wait ? { runStepId: step._id } : {}), chain },
    },
  );
  if (!started.ok) {
    await failStep(ctx, run, step, byNode, `${target.name} could not start: ${started.message}`);
    return;
  }
  const now = Date.now();
  // The run it started may already have ended, and moved this step on itself.
  const fresh = await ctx.db.get(step._id);
  if (fresh?.status !== "pending") {
    await ctx.db.patch(step._id, { childRunId: started.runId });
    return;
  }
  await ctx.db.patch(step._id, {
    childRunId: started.runId,
    startedAt: now,
    ...(wait ? { status: "running" } : { status: "done", outputs: files, finishedAt: now }),
  });
}

/**
 * Called once when a run ends. A step waiting on it moves on, with its finished files
 * when it worked; automations that follow it start.
 */
export async function runEnded(
  ctx: MutationCtx,
  run: Doc<"runs">,
  status: "done" | "failed" | "cancelled",
  error: string | null,
): Promise<void> {
  const steps = await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .take(200);
  const files = finishedFilesOf(run, steps);

  if (run.parentRunStepId) await finishWaitingStep(ctx, run, status, error, files);
  // A webhook that asked to hear how the run went is told.
  await reportRunEnd(ctx, run);

  if (status === "cancelled" || run.test) return;
  const followers = await teamEnabledWithTrigger(ctx, run.organizationId, "finished");
  const chain = chainOf(run);
  for (const follower of followers) {
    if (follower.organizationId !== run.organizationId) continue;
    // The follower's triggers that wait for this automation to end this way. Two of them
    // (one for done, one for failed, say) can only both match on "either".
    const matching = triggersOfKind(follower, "finished").filter(
      ({ trigger }) => trigger.automationId === run.automationId && followsEnd(trigger, status),
    );
    // Saving refuses links that loop, so this only stops a chain changed while it ran.
    if (matching.length === 0 || chainProblem(chain, follower._id, follower.name)) continue;
    for (const { id: triggerId } of matching)
      await startRun(
        ctx,
        follower,
        "finished",
        // After a failure there are no finished files, so the follower gets the ones the
        // run started with and can try something else with them.
        status === "done"
          ? { ...runFiles(files, run.trigger), earlier: earlierFilesOf(run, steps, files) }
          : runFiles(startingFiles(run.trigger), run.trigger),
        null,
        { parent: { runId: run._id, chain }, triggerId },
      );
  }
}

/** The files a run started with. */
export function startingFiles(trigger: unknown): string[] {
  const { files, file_url: fileUrl } = (trigger ?? {}) as { files?: unknown; file_url?: unknown };
  if (Array.isArray(files)) {
    const urls = files.filter((url): url is string => typeof url === "string" && url !== "");
    if (urls.length > 0) return urls;
  }
  return typeof fileUrl === "string" && fileUrl !== "" ? [fileUrl] : [];
}

async function finishWaitingStep(
  ctx: MutationCtx,
  run: Doc<"runs">,
  status: "done" | "failed" | "cancelled",
  error: string | null,
  files: string[],
) {
  const step = await ctx.db.get(run.parentRunStepId!);
  // Still pending: the run ended while the step was starting it, which marks it then.
  if (!step || (step.status !== "running" && step.status !== "pending")) return;
  const parent = await ctx.db.get(step.runId);
  if (!parent || (parent.status !== "running" && parent.status !== "waiting")) return;
  const steps = await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", parent._id))
    .take(200);
  const byNode = new Map(steps.map((other) => [other.nodeId, other]));
  const now = Date.now();
  if (status === "done") {
    await ctx.db.patch(step._id, {
      status: "done",
      outputs: files,
      childRunId: run._id,
      startedAt: step.startedAt ?? now,
      finishedAt: now,
    });
  } else {
    await ctx.db.patch(step._id, { childRunId: run._id });
    await failStep(
      ctx,
      parent,
      { ...step, childRunId: run._id },
      byNode,
      status === "cancelled"
        ? `${run.automationName} was stopped before it finished.`
        : `${run.automationName} failed: ${error ?? "a step failed."}`,
    );
  }
  // Only once the step that started it is done: it is still starting otherwise.
  if (step.status === "running") await advance(ctx, parent._id);
}
