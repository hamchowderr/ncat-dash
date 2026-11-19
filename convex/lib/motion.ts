import {
  type AutomationNode,
  type Chapter,
  type MotionPlan,
  type MotionSetup,
  motionRequest,
  motionSetupFor,
  motionStepLevel,
  motionStepSettings,
  NO_MOTION_SETUP,
  placedFrom,
  planMotionByRules,
  planSoundsByRules,
  soundStepLevel,
  soundStepSettings,
  titleFromFileName,
  tidyMotionSetup,
} from "@ncat-dash/automation-core";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { heardFrom, wordsFor } from "./moments";
import { brandOf } from "./queue";
import { advance, enqueueAll, failStep } from "./runner";

/**
 * The Add Motion Graphics and Add Sound Effects steps in a run. Both start like Best
 * moments: each video is transcribed with word timestamps ("listen", lib/moments.ts).
 * Then its words are read into the dashboard ("place", convex/motion.ts), the pieces and
 * sounds are placed by plain rules, and one render per video is sent ("render"). No AI.
 */

export const isMotionKind = (kind: string) => kind === "motion" || kind === "sound-effects";

/** The team's Motion settings, or the default style when it has not set any. */
export async function motionSetupOf(ctx: QueryCtx, organizationId: string): Promise<MotionSetup> {
  const settings = await ctx.db
    .query("teamSettings")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .first();
  if (!settings?.motion) return NO_MOTION_SETUP;
  // Saved settings were checked when saved; tidy again in case a preset has changed since.
  const tidied = tidyMotionSetup(settings.motion as Partial<MotionSetup>);
  return tidied.ok ? tidied.setup : NO_MOTION_SETUP;
}

/** After "listen": reads each video's words, unless a job could not be done. */
export async function finishMotionListening(
  ctx: MutationCtx,
  run: Doc<"runs">,
  step: Doc<"runSteps">,
  byNode: Map<string, Doc<"runSteps">>,
  jobs: Doc<"jobs">[],
) {
  const failed = jobs.find((job) => job.status === "failed");
  if (failed) {
    const what = failed.stepId === "media-transcribe" ? "transcribe" : "read";
    await failStep(
      ctx,
      run,
      step,
      byNode,
      `Could not ${what} the video: ${failed.error ?? "the toolkit gave no reason."}`,
    );
    return;
  }
  await ctx.db.patch(step._id, { stage: "place" });
  await ctx.scheduler.runAfter(0, internal.motion.place, { runStepId: step._id });
}

/** The chapters an earlier Chapters step in this run found in a video. */
function chaptersOf(byNode: Map<string, Doc<"runSteps">>, url: string): Chapter[] {
  for (const other of byNode.values()) {
    const found = (other.chapters ?? []).filter((chapter) => chapter.source === url);
    if (found.length > 0)
      return found.map(({ start, title, bullets }) => ({ start, title, bullets }));
  }
  return [];
}

/**
 * Last stage before the render: places the pieces or sounds on each video by rules and
 * queues one render per video. The words were saved by convex/motion.ts.
 */
export async function finishPlacing(ctx: MutationCtx, run: Doc<"runs">, step: Doc<"runSteps">) {
  const steps = await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .take(200);
  const byNode = new Map(steps.map((other) => [other.nodeId, other]));
  const node = (run.nodes as AutomationNode[]).find((candidate) => candidate.id === step.nodeId);
  if (!node) return;
  const jobs = (await Promise.all(step.jobIds.map((id) => ctx.db.get(id)))).filter(
    (job): job is Doc<"jobs"> => job !== null,
  );
  const team = await motionSetupOf(ctx, run.organizationId);
  const brand = await brandOf(ctx, run.organizationId, run.clientId);
  const fileName = (run.trigger as { file_name?: unknown } | null)?.file_name;

  const renders: { stepId: string; input: unknown }[] = [];
  const placed: NonNullable<Doc<"runSteps">["placed"]> = [];
  for (const heard of heardFrom(jobs)) {
    const spoken = await wordsFor(ctx, run.organizationId, heard.url);
    const words = spoken?.words ?? [];
    const duration = heard.duration ?? spoken?.duration ?? 0;
    if (duration <= 0) {
      await failStep(ctx, run, step, byNode, "Could not tell how long the video is.");
      await advance(ctx, run._id);
      return;
    }
    const chapters = chaptersOf(byNode, heard.url);
    let plan: MotionPlan;
    let request: Record<string, unknown>;
    if (node.kind === "motion") {
      const settings = motionStepSettings(node.input);
      const setup = motionSetupFor(team, settings.style === "team" ? undefined : settings.style);
      const title =
        settings.title || titleFromFileName(typeof fileName === "string" ? fileName : "");
      plan = planMotionByRules({
        words,
        duration,
        setup,
        chapters,
        title,
        logo: brand.logo,
      });
      const level = motionStepLevel(setup, settings);
      request = motionRequest(heard.url, plan, setup, brand, {
        level,
        pieceSounds: level !== "off",
      });
    } else {
      const level = soundStepLevel(team, soundStepSettings(node.input));
      plan = { pieces: [], sounds: planSoundsByRules({ words, duration, level, chapters }) };
      request = motionRequest(heard.url, plan, team, {}, { level: "heavy", pieceSounds: false });
    }
    renders.push({ stepId: "video-motion", input: request });
    placed.push(placedFrom(heard.url, plan));
  }
  if (renders.length === 0) {
    await failStep(ctx, run, step, byNode, "No video reached this step.");
    await advance(ctx, run._id);
    return;
  }
  const queued = await enqueueAll(ctx, run, step, renders);
  if (!queued.ok) {
    await failStep(ctx, run, step, byNode, queued.message);
    await advance(ctx, run._id);
    return;
  }
  await ctx.db.patch(step._id, { stage: "render", jobIds: queued.jobIds, placed });
  await advance(ctx, run._id);
}
