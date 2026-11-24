import {
  type AutomationEdge,
  type AutomationNode,
  type Chapter,
  type MotionPlan,
  type MotionSetup,
  motionRequest,
  motionSetupFor,
  motionStepLevel,
  motionStepSettings,
  withStepEffects,
  NO_MOTION_SETUP,
  nearestUpstreamOfKind,
  nothingToDrawNote,
  type PlacedPiece,
  placedFrom,
  planMotionByRules,
  planSoundsByRules,
  soundStepLevel,
  type SoundLevel,
  soundStepSettings,
  TEAM_STYLE,
  tidyMotionSetup,
} from "@takewon/automation-core";
// The editing steps' reading of a file name: dashes and underscores become spaces.
import { titleFromFileName } from "@takewon/step-catalog";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { finishCleanup } from "./cleanup";
import { heardFrom, wordsFor } from "./moments";
import { startingFileName } from "./outputs";
import { brandOf } from "./queue";
import { advance, enqueueAll, failStep } from "./runner";

/**
 * The Add Motion Graphics and Add Sound Effects steps in a run. Both start like Best
 * moments: each video is transcribed with word timestamps ("listen", lib/moments.ts).
 * Then its words are read into the dashboard ("place", convex/motion.ts), the pieces and
 * sounds are placed by plain rules, and one render per video is sent ("render"). No AI.
 */

export const isMotionKind = (kind: string) => kind === "motion" || kind === "sound-effects";

/** Steps that transcribe, read the words into the dashboard ("place"), then render. */
export const isPlaceKind = (kind: string) => isMotionKind(kind) || kind === "cleanup";

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

/**
 * For a Plan Motion Graphics step: the style of the Add Motion Graphics step after it that
 * will draw the plan, and the sound level that step plays at. With no motion step after it,
 * the team's own style.
 */
export async function motionPlanOf(
  ctx: QueryCtx,
  organizationId: string,
  planNodeId: string,
  nodes: AutomationNode[],
  edges: AutomationEdge[],
): Promise<{ setup: MotionSetup; level: SoundLevel }> {
  const carried = nodes.find(
    (node) =>
      node.kind === "motion" &&
      nearestUpstreamOfKind(node.id, "motion-plan", nodes, edges)?.id === planNodeId,
  );
  const settings = motionStepSettings(carried?.input ?? {});
  const team = await motionSetupOf(ctx, organizationId);
  const setup = motionSetupFor(team, settings.style === TEAM_STYLE ? undefined : settings.style);
  return { setup, level: motionStepLevel(setup, settings) };
}

/** The beats a Plan Motion Graphics step before this one planned for each video, if any. */
function plannedBeats(
  run: Doc<"runs">,
  nodeId: string,
  byNode: Map<string, Doc<"runSteps">>,
): Map<string, PlacedPiece[]> | null {
  const planNode = nearestUpstreamOfKind(
    nodeId,
    "motion-plan",
    run.nodes as AutomationNode[],
    run.edges as AutomationEdge[],
  );
  const planStep = planNode ? byNode.get(planNode.id) : undefined;
  if (!Array.isArray(planStep?.aiPlan)) return null;
  return new Map(
    (planStep.aiPlan as { source: string; beats: PlacedPiece[] }[]).map((one) => [
      one.source,
      one.beats,
    ]),
  );
}

/** After "listen": reads each video's words, unless a job could not be done. */
export async function finishMotionListening(
  ctx: MutationCtx,
  run: Doc<"runs">,
  step: Doc<"runSteps">,
  byNode: Map<string, Doc<"runSteps">>,
  jobs: Doc<"jobs">[],
) {
  // Without its pauses a cleanup still works, from the gaps between the words.
  const failed = jobs.find(
    (job) => job.status === "failed" && job.stepId !== "media-silence-detect",
  );
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
  if (node.kind === "cleanup") {
    await finishCleanup(ctx, run, node, step, byNode, jobs);
    return;
  }
  const team = await motionSetupOf(ctx, run.organizationId);
  const brand = await brandOf(ctx, run.organizationId, run.clientId);
  // As uploaded, or from its address when the run was started with a link or Run now.
  const fileName = startingFileName(run.trigger) ?? "";

  const planned = node.kind === "motion" ? plannedBeats(run, node.id, byNode) : null;
  const renders: { stepId: string; input: unknown }[] = [];
  // Videos with nothing to put on them go on as they are, with no render.
  const unchanged: string[] = [];
  let noteSetup = team;
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
      noteSetup = setup;
      const title = settings.title || titleFromFileName(fileName);
      plan = planMotionByRules({
        words,
        duration,
        setup,
        chapters,
        title,
        logo: brand.logo,
        // A Plan Motion Graphics step before this one chose the beats; the rules add the rest.
        ...(planned ? { beats: planned.get(heard.url) ?? [] } : {}),
      });
      plan = withStepEffects(plan, settings, duration);
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
    placed.push(placedFrom(heard.url, plan));
    if (plan.pieces.length === 0 && plan.sounds.length === 0) unchanged.push(heard.url);
    else renders.push({ stepId: "video-motion", input: request });
  }
  const note =
    unchanged.length > 0
      ? nothingToDrawNote(
          node.kind === "motion" ? "motion" : "sound-effects",
          noteSetup,
          unchanged.length,
        )
      : undefined;
  if (renders.length === 0 && unchanged.length > 0) {
    await ctx.db.patch(step._id, {
      status: "done",
      stage: undefined,
      outputs: unchanged,
      placed,
      pickNote: note,
      finishedAt: Date.now(),
    });
    await advance(ctx, run._id);
    return;
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
  // The unchanged videos wait in `outputs` and go on with the drawn ones (lib/runner.ts).
  await ctx.db.patch(step._id, {
    stage: "render",
    jobIds: queued.jobIds,
    placed,
    outputs: unchanged,
    ...(note ? { pickNote: note } : {}),
  });
  await advance(ctx, run._id);
}
