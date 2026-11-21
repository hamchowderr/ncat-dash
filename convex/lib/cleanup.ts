import {
  type AutomationNode,
  cleanupRequest,
  cleanupSettings,
  creatorFromKey,
  planCleanup,
  readFileDetails,
} from "@ncat-dash/automation-core";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { heardFrom, wordsFor } from "./moments";
import { triggersOfKind } from "./triggers";
import { advance, enqueueAll, failStep } from "./runner";

/**
 * The Clean Up Pauses And Retakes step in a run. It starts like Add Motion Graphics: each
 * video is transcribed with word timestamps, and here its pauses are heard by the toolkit's
 * silence detection too ("listen", lib/moments.ts); its words are read in ("place",
 * convex/motion.ts). Then this plans what to keep by plain rules (automation-core
 * cleanup.ts) and sends one cut per file it makes ("render"): one cleaned video, or a file
 * per hook take and the body. No AI.
 */
export async function finishCleanup(
  ctx: MutationCtx,
  run: Doc<"runs">,
  node: AutomationNode,
  step: Doc<"runSteps">,
  byNode: Map<string, Doc<"runSteps">>,
  jobs: Doc<"jobs">[],
) {
  const settings = cleanupSettings(node.input);
  // A recording dropped in a creator's folder inside a watched folder is theirs.
  if (!settings.creator && run.triggerKind === "folder") {
    const automation = await ctx.db.get(run.automationId);
    const folders = automation ? triggersOfKind(automation, "folder") : [];
    const folder = folders.find((each) => each.id === run.triggerId) ?? folders[0];
    const found = folder
      ? creatorFromKey((run.trigger as { key?: unknown } | null)?.key, folder.trigger.prefix)
      : null;
    if (found) settings.creator = found;
  }
  const renders: { stepId: string; input: unknown }[] = [];
  const cleaned: NonNullable<Doc<"runSteps">["cleaned"]> = [];
  const stop = async (message: string) => {
    await failStep(ctx, run, step, byNode, message);
    await advance(ctx, run._id);
  };
  for (const heard of heardFrom(jobs)) {
    const spoken = await wordsFor(ctx, run.organizationId, heard.url);
    const words = spoken?.words ?? [];
    const duration = heard.duration ?? spoken?.duration ?? 0;
    if (duration <= 0) return stop("Could not tell how long the video is.");
    if (words.length === 0) {
      return stop("No speech was heard in the video, so there was nothing to clean up.");
    }
    const plan = planCleanup({ words, pauses: heard.pauses ?? [], duration, settings });
    if (plan.parts.length === 0) {
      return stop("Nothing was left to keep once the pauses and retakes were taken out.");
    }
    const details = readFileDetails(heard.metadata);
    // With a creator named, the one cleaned video is their body take too.
    const labels = plan.parts.map((part) => part.label ?? (settings.creator ? "body" : null));
    for (const part of plan.parts) {
      renders.push({
        stepId: "ffmpeg-compose",
        input: cleanupRequest(heard.url, part, details?.fps),
      });
    }
    cleaned.push({
      source: heard.url,
      before: plan.before,
      after: plan.after,
      pauses: plan.pauses,
      pauseSeconds: plan.pauseSeconds,
      retakes: plan.retakes,
      retakeSeconds: plan.retakeSeconds,
      hooks: plan.hooks,
      labels,
      ...(settings.creator ? { creator: settings.creator } : {}),
    });
  }
  if (renders.length === 0) return stop("No video reached this step.");
  const queued = await enqueueAll(ctx, run, step, renders);
  if (!queued.ok) return stop(queued.message);
  await ctx.db.patch(step._id, { stage: "render", jobIds: queued.jobIds, cleaned });
  await advance(ctx, run._id);
}
