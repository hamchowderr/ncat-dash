import { type Word, wordsFromSegments } from "@takewon/automation-core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { finishHearing } from "./lib/runner";
import { heardFrom, MAX_WORDS, wordsFor } from "./lib/moments";
import { readWordsFile } from "./moments";

/**
 * The "hear" stage of a step that keeps a paid creator's ad disclosure in every cut (see
 * lib/disclosure.ts): reads in the words the toolkit heard in each video and keeps them,
 * then queues the step's jobs. A video whose words cannot be read is cut as if nothing
 * was said in it, and the run page says no disclosure was heard.
 */

export const loadHear = internalQuery({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.runStepId);
    if (!step || step.status !== "running" || step.stage !== "hear") return null;
    const run = await ctx.db.get(step.runId);
    if (!run || (run.status !== "running" && run.status !== "waiting")) return null;
    const jobs = (await Promise.all(step.jobIds.map((id) => ctx.db.get(id)))).filter(
      (job) => job !== null,
    );
    const videos = [];
    for (const heard of heardFrom(jobs)) {
      if (await wordsFor(ctx, run.organizationId, heard.url)) continue;
      videos.push({ url: heard.url, wordsFile: heard.wordsFile, segments: heard.segments });
    }
    return { organizationId: run.organizationId, videos };
  },
});

export const finishHear = internalMutation({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.runStepId);
    if (!step || step.status !== "running" || step.stage !== "hear") return;
    const run = await ctx.db.get(step.runId);
    if (!run || (run.status !== "running" && run.status !== "waiting")) return;
    await finishHearing(ctx, run, step);
  },
});

export const hear = internalAction({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const loaded = await ctx.runQuery(internal.disclosure.loadHear, args);
    if (!loaded) return;
    for (const video of loaded.videos) {
      const words: Word[] | null =
        (Array.isArray(video.segments) ? wordsFromSegments(video.segments) : null) ??
        (video.wordsFile ? await readWordsFile(video.wordsFile) : null);
      if (!words) continue;
      const kept = words.slice(0, MAX_WORDS);
      await ctx.runMutation(internal.moments.saveWords, {
        organizationId: loaded.organizationId,
        source: video.url,
        duration: kept[kept.length - 1]?.end ?? 0,
        words: kept.map((word) => ({ t: word.text, s: word.start, e: word.end })),
      });
    }
    await ctx.runMutation(internal.disclosure.finishHear, args);
  },
});
