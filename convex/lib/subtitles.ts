import {
  type AutomationNode,
  fileNameOfLink,
  subtitleFileName,
  subtitleLanguagesOf,
} from "@ncat-dash/automation-core";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { listenRequest, wordsFor } from "./moments";
import { outputNamesOf, startingFileName } from "./outputs";
import { enqueueAll, failStep, filesFor, incomingFiles } from "./runner";

/** Once the files are written: the step is done and hands on the files that reached it. */
export async function finishSubtitles(
  ctx: MutationCtx,
  run: Doc<"runs">,
  step: Doc<"runSteps">,
  byNode: Map<string, Doc<"runSteps">>,
  subtitles: NonNullable<Doc<"runSteps">["subtitles"]>,
  note: string | null,
) {
  const node = (run.nodes as AutomationNode[]).find((one) => one.id === step.nodeId);
  if (!node) return;
  await ctx.db.patch(step._id, {
    status: "done",
    subtitles,
    outputs: incomingFiles(node, run, byNode),
    finishedAt: Date.now(),
    ...(note ? { pickNote: note } : {}),
  });
}

/**
 * A Translate Subtitles step in a run. Each video's words are heard first ("hear", once
 * per video, kept for every later step), then translated into each language and written
 * as SRT files in the team's folder ("translate", convex/subtitleTranslation.ts). The
 * translations are the same ones "Caption video" makes for a caption language, so a video
 * is never translated into one language twice. The videos carry on unchanged.
 */

// Each video in each language is a translation, so a step takes this many videos at most.
export const MAX_SUBTITLE_VIDEOS = 10;

export async function startSubtitles(
  ctx: MutationCtx,
  run: Doc<"runs">,
  node: AutomationNode,
  step: Doc<"runSteps">,
  byNode: Map<string, Doc<"runSteps">>,
) {
  const now = Date.now();
  const languages = subtitleLanguagesOf(node.input);
  if (languages.length === 0) {
    await failStep(ctx, run, step, byNode, "Pick at least one language for the subtitles.");
    return;
  }
  const videos = [...new Set(filesFor("media", node, run, byNode))];
  if (videos.length === 0) {
    await failStep(ctx, run, step, byNode, "No video reached this step.");
    return;
  }
  if (videos.length > MAX_SUBTITLE_VIDEOS) {
    await failStep(
      ctx,
      run,
      step,
      byNode,
      `${videos.length} videos reached this step; the most it takes at once is ${MAX_SUBTITLE_VIDEOS}.`,
    );
    return;
  }

  // Each video's words, heard once. A video whose words still could not be read after
  // hearing is not heard again: it gets no subtitles, and the run page says so.
  if (!step.heardWords) {
    const unheard: string[] = [];
    for (const url of videos) {
      if (!(await wordsFor(ctx, run.organizationId, url))) unheard.push(url);
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

  const names = outputNamesOf(run, [...byNode.values()]);
  const starting = startingFileName(run.trigger);
  const nameOf = (url: string) =>
    names[url] ??
    (starting && incomingOfTrigger(run).includes(url) ? starting : null) ??
    fileNameOfLink(url);
  const subtitles = videos.flatMap((source) =>
    languages.map((language) => ({
      source,
      language,
      name: subtitleFileName(nameOf(source), language),
    })),
  );
  await ctx.db.patch(step._id, {
    status: "running",
    stage: "translate",
    jobIds: [],
    subtitles,
    startedAt: step.startedAt ?? now,
  });
  await ctx.scheduler.runAfter(0, internal.subtitleTranslation.translate, {
    runStepId: step._id,
  });
}

function incomingOfTrigger(run: Doc<"runs">): string[] {
  const { file_url: url } = (run.trigger ?? {}) as Record<string, unknown>;
  return typeof url === "string" ? [url] : [];
}
