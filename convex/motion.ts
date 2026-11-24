import { type AutomationNode, type Word, wordsFromSegments } from "@takewon/automation-core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { finishPlacing, isPlaceKind } from "./lib/motion";
import { heardFrom, MAX_WORDS, wordsFor } from "./lib/moments";
import { advance, failStep } from "./lib/runner";
import { readWordsFile } from "./moments";

/**
 * The "place" stage of Add Motion Graphics and Add Sound Effects (see lib/motion.ts):
 * reads the words the toolkit heard in each video into the dashboard, then hands back to
 * the run, which places everything by rules. A video with no speech still gets its
 * opening, ending and chapter pieces.
 */

export const loadPlace = internalQuery({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.runStepId);
    if (!step || step.status !== "running" || step.stage !== "place") return null;
    const run = await ctx.db.get(step.runId);
    if (!run || (run.status !== "running" && run.status !== "waiting")) return null;
    const node = (run.nodes as AutomationNode[]).find((candidate) => candidate.id === step.nodeId);
    if (!node || !isPlaceKind(node.kind)) return null;
    const jobs = (await Promise.all(step.jobIds.map((id) => ctx.db.get(id)))).filter(
      (job) => job !== null,
    );
    const videos = [];
    for (const heard of heardFrom(jobs)) {
      if (await wordsFor(ctx, run.organizationId, heard.url)) continue;
      videos.push({
        url: heard.url,
        duration: heard.duration ?? 0,
        wordsFile: heard.wordsFile,
        segments: heard.segments,
      });
    }
    return { organizationId: run.organizationId, videos };
  },
});

export const finishPlace = internalMutation({
  args: { runStepId: v.id("runSteps"), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.runStepId);
    if (!step || step.status !== "running" || step.stage !== "place") return;
    const run = await ctx.db.get(step.runId);
    if (!run || (run.status !== "running" && run.status !== "waiting")) return;
    if (args.error !== undefined) {
      const steps = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .take(200);
      await failStep(
        ctx,
        run,
        step,
        new Map(steps.map((other) => [other.nodeId, other])),
        args.error,
      );
      await advance(ctx, run._id);
      return;
    }
    await finishPlacing(ctx, run, step);
  },
});

export const place = internalAction({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const loaded = await ctx.runQuery(internal.motion.loadPlace, args);
    if (!loaded) return;
    const runStepId = args.runStepId as Id<"runSteps">;
    for (const video of loaded.videos) {
      let words: Word[] | null =
        (Array.isArray(video.segments) ? wordsFromSegments(video.segments) : null) ??
        (video.wordsFile ? await readWordsFile(video.wordsFile) : null);
      if (!words) {
        await ctx.runMutation(internal.motion.finishPlace, {
          runStepId,
          error: "Could not read the transcript the toolkit made.",
        });
        return;
      }
      words = words.slice(0, MAX_WORDS);
      await ctx.runMutation(internal.moments.saveWords, {
        organizationId: loaded.organizationId,
        source: video.url,
        duration: video.duration || words[words.length - 1]?.end || 0,
        words: words.map((word) => ({ t: word.text, s: word.start, e: word.end })),
      });
    }
    await ctx.runMutation(internal.motion.finishPlace, { runStepId });
  },
});
