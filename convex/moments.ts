import {
  type AutomationNode,
  chapterSettings,
  momentSettings,
  sourceKey,
  transcriptText,
  type Word,
  wordsFromSegments,
} from "@ncat-dash/automation-core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { advance, failStep } from "./lib/runner";
import { finishPicking, heardFrom, MAX_WORDS, wordsFor } from "./lib/moments";
import { signAgentToken } from "./reviewAgent";

/**
 * The "pick" stage of the Best moments and Chapters steps (see lib/moments.ts): gets each
 * video's words, asks the agent server's model to pick from the transcript, and hands the
 * answers back to the run, which checks every pick against the words itself.
 */

// The model reads a long transcript; give it time.
const AGENT_TIMEOUT_MS = 240_000;
const WORDS_FILE_TIMEOUT_MS = 60_000;
const WORDS_FILE_LIMIT = 50_000_000;

/** What the pick needs to know about a step waiting at "pick". */
export const loadPick = internalQuery({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.runStepId);
    if (!step || step.status !== "running" || step.stage !== "pick") return null;
    const run = await ctx.db.get(step.runId);
    if (!run || (run.status !== "running" && run.status !== "waiting")) return null;
    const node = (run.nodes as AutomationNode[]).find((candidate) => candidate.id === step.nodeId);
    if (!node || (node.kind !== "moments" && node.kind !== "chapters")) return null;
    const jobs = (await Promise.all(step.jobIds.map((id) => ctx.db.get(id)))).filter(
      (job) => job !== null,
    );
    const videos = [];
    for (const heard of heardFrom(jobs)) {
      const known = await wordsFor(ctx, run.organizationId, heard.url);
      const avoid =
        node.kind === "moments" && momentSettings(node.input).skipPicked
          ? await ctx.db
              .query("pickedMoments")
              .withIndex("by_source", (q) =>
                q.eq("organizationId", run.organizationId).eq("source", sourceKey(heard.url)),
              )
              .take(500)
          : [];
      videos.push({
        url: heard.url,
        duration: heard.duration ?? known?.duration ?? 0,
        wordsFile: heard.wordsFile,
        segments: known ? null : heard.segments,
        words: known?.words ?? null,
        avoid: avoid.map(({ start, end }) => ({ start, end })),
      });
    }
    const settings = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", run.organizationId))
      .first();
    const fileName = (run.trigger as { file_name?: unknown } | null)?.file_name;
    return {
      organizationId: run.organizationId,
      kind: node.kind,
      input: node.input,
      title: typeof fileName === "string" ? fileName : run.automationName,
      askedBy: run.startedBy ?? "automation",
      houseRules: settings?.agent?.houseRules ?? "",
      videos,
    };
  },
});

/** Keeps a video's words so it is not transcribed again. */
export const saveWords = internalMutation({
  args: {
    organizationId: v.string(),
    source: v.string(),
    duration: v.number(),
    words: v.array(v.object({ t: v.string(), s: v.number(), e: v.number() })),
  },
  handler: async (ctx, args) => {
    const source = sourceKey(args.source);
    const found = await ctx.db
      .query("spokenWords")
      .withIndex("by_source", (q) =>
        q.eq("organizationId", args.organizationId).eq("source", source),
      )
      .first();
    const row = { ...args, source };
    if (found) await ctx.db.replace(found._id, row);
    else await ctx.db.insert("spokenWords", row);
  },
});

/** Hands the model's answers back to the run, or fails the step with a plain reason. */
export const finishPick = internalMutation({
  args: {
    runStepId: v.id("runSteps"),
    answers: v.array(v.object({ url: v.string(), answer: v.string() })),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.runStepId);
    if (!step || step.status !== "running" || step.stage !== "pick") return;
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
    await finishPicking(ctx, run, step, args.answers);
  },
});

/** The words in a toolkit transcript file of segments with word timestamps. */
export async function readWordsFile(url: string): Promise<Word[] | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(WORDS_FILE_TIMEOUT_MS) });
    if (!response.ok) return null;
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > WORDS_FILE_LIMIT) return null;
    return wordsFromSegments(await response.json());
  } catch {
    return null;
  }
}

class PickError extends Error {}

/** Asks the agent server's model to pick from one transcript. Returns its answer as text. */
async function askModel(body: Record<string, unknown>, askedBy: string): Promise<string> {
  const url = process.env.AGENT_URL;
  const secret = process.env.MASTRA_JWT_SECRET;
  if (!url || !secret) {
    throw new PickError(
      "The agent is not set up on this dashboard yet, and it is what picks. Whoever runs the dashboard sets AGENT_URL and MASTRA_JWT_SECRET for Convex.",
    );
  }
  let response: Response;
  try {
    response = await fetch(new URL("/ncat/moments", url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await signAgentToken(secret, askedBy)}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
    });
  } catch {
    throw new PickError("The agent could not be reached to pick. Run it again in a moment.");
  }
  const result = (await response.json().catch(() => null)) as { answer?: unknown } | null;
  if (!response.ok || typeof result?.answer !== "string" || result.answer.trim() === "") {
    throw new PickError("The agent did not answer when asked to pick. Run it again in a moment.");
  }
  return result.answer;
}

/** The pick itself: words for each video, then one question to the model per video. */
export const pick = internalAction({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const loaded = await ctx.runQuery(internal.moments.loadPick, args);
    if (!loaded) return;
    const finish = (answers: { url: string; answer: string }[], error?: string) =>
      ctx.runMutation(internal.moments.finishPick, {
        runStepId: args.runStepId as Id<"runSteps">,
        answers,
        ...(error !== undefined ? { error } : {}),
      });
    try {
      const answers: { url: string; answer: string }[] = [];
      for (const video of loaded.videos) {
        let words: Word[] | null = video.words;
        if (!words) {
          words =
            (Array.isArray(video.segments) ? wordsFromSegments(video.segments) : null) ??
            (video.wordsFile ? await readWordsFile(video.wordsFile) : null);
          if (!words) throw new PickError("Could not read the transcript the toolkit made.");
          if (words.length === 0) throw new PickError("No speech was heard in the video.");
          words = words.slice(0, MAX_WORDS);
          await ctx.runMutation(internal.moments.saveWords, {
            organizationId: loaded.organizationId,
            source: video.url,
            duration: video.duration || words[words.length - 1].end,
            words: words.map((word) => ({ t: word.text, s: word.start, e: word.end })),
          });
        }
        if (words.length === 0) throw new PickError("No speech was heard in the video.");
        const duration = video.duration || words[words.length - 1].end;
        const settings =
          loaded.kind === "moments"
            ? (() => {
                const s = momentSettings(loaded.input);
                return {
                  count: s.count,
                  minSeconds: s.minSeconds,
                  maxSeconds: s.maxSeconds,
                  platform: s.platform,
                  topics: s.topics,
                  lookFor: s.lookFor,
                };
              })()
            : chapterSettings(loaded.input);
        const answer = await askModel(
          {
            kind: loaded.kind,
            title: loaded.title.slice(0, 300),
            duration,
            transcript: transcriptText(words),
            settings,
            ...(loaded.kind === "moments" ? { avoid: video.avoid } : {}),
            houseRules: loaded.houseRules.slice(0, 2000),
          },
          loaded.askedBy,
        );
        answers.push({ url: video.url, answer });
      }
      await finish(answers);
    } catch (error) {
      await finish(
        [],
        error instanceof PickError ? error.message : "Picking failed. Run it again in a moment.",
      );
    }
  },
});
