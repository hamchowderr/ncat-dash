import {
  type AutomationNode,
  type CheckedFile,
  FOOTAGE_NOTE,
  type FootageMeasure,
  type FootageRole,
  footageMessage,
  footageNote,
  footageProblems,
  footageSettings,
  footageSummary,
} from "@ncat-dash/automation-core";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { notify } from "./alerts";
import { triggersOfKind } from "./triggers";
import { enqueueAll, failStep, filesFor, incomingFiles } from "./runner";

/**
 * The Check Footage step in a run. Each video reaching it, and for a creator's folder every
 * hook and ending take too, is measured by the toolkit with FFmpeg alone
 * (/v1/media/check, stage "footage"); plain rules then say what is wrong (automation-core
 * footage.ts). With a problem the team is told, a note goes in the creator's folder, and
 * the run stops before editing, or carries on when the step says so. No AI.
 */

// One check measures this many files at most.
const MOST_FILES = 20;
// The longest stretch of each file read, in seconds.
const MAX_SECONDS = 1200;

type StepsByNode = Map<string, Doc<"runSteps">>;
type Take = { file_url: string; file_name: string };

function takesOf(list: unknown): Take[] {
  return (Array.isArray(list) ? list : []).filter(
    (each): each is Take =>
      !!each &&
      typeof each === "object" &&
      typeof (each as Take).file_url === "string" &&
      typeof (each as Take).file_name === "string",
  );
}

/** The creator's name when the run came from a folder laid out per creator. */
function creatorOf(run: Doc<"runs">): string | null {
  const creator = (run.trigger as { creator?: unknown } | null)?.creator;
  return typeof creator === "string" ? creator : null;
}

/** A file's name from its address, when nothing better is known. */
function nameOfUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}

/** Every file the step checks, with its name and what it is. */
export function filesToCheck(
  node: AutomationNode,
  run: Doc<"runs">,
  byNode: StepsByNode,
): { url: string; name: string; role: FootageRole }[] {
  const trigger = (run.trigger ?? {}) as { file_url?: unknown; file_name?: unknown };
  const creator = creatorOf(run) !== null;
  const found = new Map<string, { url: string; name: string; role: FootageRole }>();
  for (const url of filesFor("video", node, run, byNode)) {
    const name =
      url === trigger.file_url && typeof trigger.file_name === "string"
        ? trigger.file_name
        : nameOfUrl(url);
    found.set(url, { url, name, role: creator ? "body" : "file" });
  }
  // A creator's hook and ending takes ride along on the run, not as files of a step.
  if (creator) {
    const all = run.trigger as { hooks?: unknown; endings?: unknown };
    for (const take of takesOf(all.hooks))
      if (!found.has(take.file_url))
        found.set(take.file_url, { url: take.file_url, name: take.file_name, role: "hook" });
    for (const take of takesOf(all.endings))
      if (!found.has(take.file_url))
        found.set(take.file_url, { url: take.file_url, name: take.file_name, role: "ending" });
  }
  return [...found.values()].slice(0, MOST_FILES);
}

/** Starts a Check Footage step: one measuring job per file. */
export async function startFootageCheck(
  ctx: MutationCtx,
  run: Doc<"runs">,
  node: AutomationNode,
  step: Doc<"runSteps">,
  byNode: StepsByNode,
) {
  const files = filesToCheck(node, run, byNode);
  if (files.length === 0) {
    await failStep(ctx, run, step, byNode, "No video reached this step.");
    return;
  }
  const queued = await enqueueAll(
    ctx,
    run,
    step,
    files.map((file) => ({
      stepId: "media-check",
      input: { media_url: file.url, max_seconds: MAX_SECONDS },
    })),
  );
  if (!queued.ok) {
    await failStep(ctx, run, step, byNode, queued.message);
    return;
  }
  await ctx.db.patch(step._id, {
    status: "running",
    stage: "footage",
    jobIds: queued.jobIds,
    startedAt: Date.now(),
  });
}

/**
 * Where the note for the creator goes: their own folder inside the watched folder, or the
 * folder a single file was dropped in. Null when the run did not come from a watched
 * folder, or when that folder takes any kind of file, since the note would start a run.
 */
async function noteKey(ctx: MutationCtx, run: Doc<"runs">): Promise<string | null> {
  if (run.triggerKind !== "folder") return null;
  const automation = await ctx.db.get(run.automationId);
  const folders = automation ? triggersOfKind(automation, "folder") : [];
  const folder = folders.find((each) => each.id === run.triggerId) ?? folders[0];
  if (!folder) return null;
  const creator = creatorOf(run);
  if (folder.trigger.layout === "creators" && creator !== null) {
    return `${folder.trigger.prefix}${creator ? `${creator}/` : ""}${FOOTAGE_NOTE}`;
  }
  if (folder.trigger.fileType === "any") return null;
  const key = (run.trigger as { key?: unknown } | null)?.key;
  if (typeof key !== "string" || !key.includes("/")) return null;
  return `${key.slice(0, key.lastIndexOf("/") + 1)}${FOOTAGE_NOTE}`;
}

/** Called once the toolkit has measured every file: decides, tells, and stops or goes on. */
export async function finishFootageCheck(
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
  const node = (run.nodes as AutomationNode[]).find((other) => other.id === step.nodeId);
  if (!node) return;
  // When the toolkit could check none of them, it is the toolkit, not the footage.
  if (jobs.length > 0 && jobs.every((job) => job.status === "failed")) {
    await failStep(
      ctx,
      run,
      step,
      byNode,
      jobs[0].error ?? "The toolkit could not check the footage.",
    );
    return;
  }
  const settings = footageSettings(node.input);
  const wanted = new Map(filesToCheck(node, run, byNode).map((file) => [file.url, file]));
  const files: CheckedFile[] = [];
  for (const job of jobs) {
    const url = (job.input as { media_url?: string }).media_url;
    if (!url) continue;
    const file = wanted.get(url) ?? { url, name: nameOfUrl(url), role: "file" as const };
    const measure = job.status === "done" ? (job.result as FootageMeasure | null) : null;
    files.push({
      ...file,
      problems: footageProblems(measure, settings, file.role),
      ...(measure?.width ? { width: measure.width } : {}),
      ...(measure?.height ? { height: measure.height } : {}),
      ...(typeof measure?.duration === "number" ? { duration: measure.duration } : {}),
      ...(typeof measure?.loudness_lufs === "number" ? { loudness: measure.loudness_lufs } : {}),
    });
  }
  const found = files.some((file) => file.problems.length > 0);
  const stopped = found && settings.whenFound === "stop";
  const creator = creatorOf(run);
  const note = await noteKey(ctx, run);

  await ctx.db.patch(step._id, {
    footage: {
      files,
      stopped,
      ...(creator ? { creator } : {}),
      ...(note ? { note } : {}),
    },
  });
  if (note) {
    await ctx.scheduler.runAfter(0, internal.footage.writeNote, {
      organizationId: run.organizationId,
      key: note,
      text: footageNote(files, stopped, new Date()),
    });
  }
  if (found && !run.test) {
    await notify(ctx, {
      organizationId: run.organizationId,
      kind: "footage_problem",
      runId: run._id,
      automationId: run.automationId,
      automationName: run.automationName,
      stepName: node.label ?? "Check Footage",
      message: footageMessage(files, stopped, creator || undefined),
      retries: 0,
    });
  }
  if (stopped) {
    await failStep(ctx, run, step, byNode, footageSummary(files));
    return;
  }
  await ctx.db.patch(step._id, {
    status: "done",
    outputs: incomingFiles(node, run, byNode),
    finishedAt: Date.now(),
    retryError: undefined,
  });
}
