import {
  sourceKey,
  teamFolder,
  toSrt,
  translatedSubtitleCues,
  type TimedWord,
  type Word,
} from "@takewon/automation-core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { TranslateError, translateVideo } from "./captionTranslation";
import { BucketError, bucketOf, putText } from "./lib/bucket";
import { wordsFor } from "./lib/moments";
import { advance, failStep } from "./lib/runner";
import { finishSubtitles } from "./lib/subtitles";

/**
 * The "translate" stage of a Translate Subtitles step (see lib/subtitles.ts): each video's
 * words translated into each language (the same kept translations "Caption video" uses),
 * cut into subtitle cues, and written as SRT files in the team's folder, under
 * Subtitles/<automation>/, where Files shows them.
 */

const FOLDER = "Subtitles/";

export const load = internalQuery({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.runStepId);
    if (!step || step.status !== "running" || step.stage !== "translate") return null;
    const run = await ctx.db.get(step.runId);
    if (!run || (run.status !== "running" && run.status !== "waiting")) return null;
    const files = [];
    for (const file of step.subtitles ?? []) {
      const heard = await wordsFor(ctx, run.organizationId, file.source);
      const kept = await ctx.db
        .query("captionTranslations")
        .withIndex("by_source_and_language", (q) =>
          q
            .eq("organizationId", run.organizationId)
            .eq("source", sourceKey(file.source))
            .eq("language", file.language),
        )
        .first();
      files.push({ ...file, words: heard?.words ?? [], kept: kept?.lines ?? null });
    }
    return {
      organizationId: run.organizationId,
      askedBy: run.startedBy ?? "automation",
      automationName: run.automationName,
      files,
    };
  },
});

const written = v.object({
  source: v.string(),
  language: v.string(),
  name: v.string(),
  key: v.optional(v.string()),
  link: v.optional(v.string()),
});

export const done = internalMutation({
  args: { runStepId: v.id("runSteps"), subtitles: v.array(written), silent: v.number() },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.runStepId);
    if (!step || step.status !== "running" || step.stage !== "translate") return;
    const run = await ctx.db.get(step.runId);
    if (!run) return;
    const note =
      args.silent > 0
        ? args.silent === 1
          ? "No speech was heard in 1 video, so it has no subtitles."
          : `No speech was heard in ${args.silent} videos, so they have no subtitles.`
        : null;
    await finishSubtitles(ctx, run, step, await stepsOf(ctx, run._id), args.subtitles, note);
    await advance(ctx, run._id);
  },
});

export const fail = internalMutation({
  args: { runStepId: v.id("runSteps"), message: v.string() },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.runStepId);
    if (!step || step.status !== "running" || step.stage !== "translate") return;
    const run = await ctx.db.get(step.runId);
    if (!run) return;
    await failStep(ctx, run, step, await stepsOf(ctx, run._id), args.message);
    await advance(ctx, run._id);
  },
});

async function stepsOf(ctx: MutationCtx, runId: Id<"runs">) {
  const steps = await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .take(200);
  return new Map(steps.map((other) => [other.nodeId, other]));
}

/** The address a file in the bucket is opened by, the way the toolkit links its results. */
export function linkOfKey(
  storage: { endpoint: string | null; bucket: string; publicUrl: string | null },
  key: string,
): string | undefined {
  const path = key.split("/").map(encodeURIComponent).join("/");
  const open = storage.publicUrl?.trim().replace(/\/+$/, "");
  if (open) return `${open}/${path}`;
  const endpoint = storage.endpoint?.trim().replace(/\/+$/, "");
  return endpoint ? `${endpoint}/${storage.bucket}/${path}` : undefined;
}

export const translate = internalAction({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const loaded = await ctx.runQuery(internal.subtitleTranslation.load, args);
    if (!loaded) return;
    try {
      const connection = await ctx.runQuery(internal.storage.load, {
        organizationId: loaded.organizationId,
      });
      if (!connection?.storage) {
        throw new TranslateError(
          "Subtitles are kept in your team's storage, and your toolkit has none set up. Connect storage on the Toolkit page.",
        );
      }
      const bucket = await bucketOf(connection);
      const folder = `${FOLDER}${(loaded.automationName.trim() || "Automation").replace(/[/\\]/g, "-")}/`;
      const subtitles = [];
      const silent = new Set<string>();
      for (const file of loaded.files) {
        const words: Word[] = file.words;
        const { kept, source, language, name } = file;
        const entry = { source, language, name };
        if (words.length === 0) {
          silent.add(file.source);
          subtitles.push(entry);
          continue;
        }
        let lines: TimedWord[][] | null = kept;
        if (!lines) {
          const made = await translateVideo(
            ctx,
            args.runStepId,
            loaded.organizationId,
            loaded.askedBy,
            words,
            file.language,
          );
          lines = made.lines;
          await ctx.runMutation(internal.captionTranslation.save, {
            organizationId: loaded.organizationId,
            video: file.source,
            language: file.language,
            lines,
            aiSpent: made.cost,
          });
        }
        const key = `${folder}${file.name}`;
        await putText(
          bucket,
          key,
          toSrt(translatedSubtitleCues(lines, file.language)),
          "application/x-subrip; charset=utf-8",
        );
        const link = linkOfKey(connection.storage, `${teamFolder(loaded.organizationId)}${key}`);
        subtitles.push({ ...entry, key, ...(link ? { link } : {}) });
      }
      await ctx.runMutation(internal.subtitleTranslation.done, {
        runStepId: args.runStepId,
        subtitles,
        silent: silent.size,
      });
    } catch (error) {
      await ctx.runMutation(internal.subtitleTranslation.fail, {
        runStepId: args.runStepId,
        message:
          error instanceof TranslateError
            ? error.message
            : error instanceof BucketError
              ? `The subtitle file could not be put in your team's storage: ${error.message}`
              : "The subtitles could not be made. Run it again in a moment.",
      });
    }
  },
});
