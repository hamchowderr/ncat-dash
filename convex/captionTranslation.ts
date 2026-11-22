import {
  ALIGN_BATCH_LINES,
  costOfUsage,
  languageName,
  readAlignedLines,
  spokenLines,
  timeTranslatedLines,
  translatedCaptionFile,
  writtenWithoutSpaces,
  burnRequest,
  sourceKey,
  type AlignedWord,
  type CaptionFileLook,
  type TimedWord,
  type Word,
} from "@ncat-dash/automation-core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { holdSpend, settleSpend } from "./aiSpend";
import { BucketError, bucketOf, presign, putText } from "./lib/bucket";
import { wordsFor } from "./lib/moments";
import { advance, enqueueAll, failStep } from "./lib/runner";
import { usageOf } from "./moments";
import { signAgentToken } from "./reviewAgent";

/**
 * The "translate" stage of "Caption video" with a caption language (see automation-core
 * translated-captions.ts for how the words are timed and drawn). For each video: its words
 * (heard in the stage before), translated a few dozen lines at a time by the agent server's
 * model with each translated word paired to the spoken words it stands for, timed, kept
 * (so the same video is never translated twice into one language), drawn into a caption
 * file in the team's look, and put in the team's bucket. Then the step burns the files in
 * ("render"), the same quick save as captions in the spoken language.
 */

// The model answers a few dozen lines in well under a minute; give it room.
const AGENT_TIMEOUT_MS = 120_000;
// A batch whose answer cannot be read is asked again this many times before the step fails.
const TRIES = 3;
// How long the toolkit's link to a caption file works: long enough for a queued burn.
const CAPTION_LINK_SECONDS = 7 * 24 * 60 * 60;

const timedWord = v.object({ t: v.string(), s: v.number(), e: v.number() });

export const load = internalQuery({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.runStepId);
    if (!step || step.status !== "running" || step.stage !== "translate") return null;
    const run = await ctx.db.get(step.runId);
    if (!run || (run.status !== "running" && run.status !== "waiting")) return null;
    const videos = [];
    for (const entry of step.captionPlan ?? []) {
      const heard = await wordsFor(ctx, run.organizationId, entry.video);
      const kept = entry.language
        ? await ctx.db
            .query("captionTranslations")
            .withIndex("by_source_and_language", (q) =>
              q
                .eq("organizationId", run.organizationId)
                .eq("source", sourceKey(entry.video))
                .eq("language", entry.language),
            )
            .first()
        : null;
      videos.push({
        ...entry,
        words: heard?.words ?? [],
        kept: kept?.lines ?? null,
      });
    }
    return {
      organizationId: run.organizationId,
      askedBy: run.startedBy ?? "automation",
      videos,
    };
  },
});

export const save = internalMutation({
  args: {
    organizationId: v.string(),
    video: v.string(),
    language: v.string(),
    lines: v.array(v.array(timedWord)),
    aiSpent: v.number(),
  },
  handler: async (ctx, args) => {
    const source = sourceKey(args.video);
    const found = await ctx.db
      .query("captionTranslations")
      .withIndex("by_source_and_language", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("source", source)
          .eq("language", args.language),
      )
      .first();
    const row = {
      organizationId: args.organizationId,
      source,
      language: args.language,
      lines: args.lines,
      aiSpent: Math.max(0, Math.ceil(args.aiSpent)),
      savedAt: Date.now(),
    };
    if (found) await ctx.db.replace(found._id, row);
    else await ctx.db.insert("captionTranslations", row);
  },
});

/** The caption files are in the bucket: burn each into its video, the step's last stage. */
export const burn = internalMutation({
  args: {
    runStepId: v.id("runSteps"),
    files: v.array(v.object({ video: v.string(), captions: v.string() })),
  },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.runStepId);
    if (!step || step.status !== "running" || step.stage !== "translate") return;
    const run = await ctx.db.get(step.runId);
    if (!run) return;
    const queued = await enqueueAll(
      ctx,
      run,
      step,
      args.files.map((file) => ({
        stepId: "ffmpeg-compose",
        input: burnRequest(file.video, file.captions),
      })),
    );
    if (!queued.ok) {
      await failStep(ctx, run, step, await stepsOf(ctx, run._id), queued.message);
    } else {
      await ctx.db.patch(step._id, { stage: "render", jobIds: queued.jobIds });
    }
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

export const hold = internalMutation({
  args: { runStepId: v.id("runSteps"), micros: v.number() },
  handler: async (ctx, args) => await holdSpend(ctx, args.runStepId, args.micros),
});

export const settle = internalMutation({
  args: { runStepId: v.id("runSteps"), micros: v.number() },
  handler: async (ctx, args) => {
    await settleSpend(ctx, args.runStepId, args.micros);
  },
});

async function stepsOf(ctx: MutationCtx, runId: Id<"runs">) {
  const steps = await ctx.db
    .query("runSteps")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .take(200);
  return new Map(steps.map((other) => [other.nodeId, other]));
}

class TranslateError extends Error {}

type Asked = { lines: AlignedWord[][] | null; cost: number };

/** Asks the agent server's model for one batch of lines. */
async function askModel(
  body: Record<string, unknown>,
  sizes: number[],
  askedBy: string,
): Promise<Asked> {
  const url = process.env.AGENT_URL;
  const secret = process.env.MASTRA_JWT_SECRET;
  if (!url || !secret) {
    throw new TranslateError(
      "The agent is not set up on this dashboard yet, and it is what translates captions. Whoever runs the dashboard sets AGENT_URL and MASTRA_JWT_SECRET for Convex.",
    );
  }
  let response: Response;
  try {
    response = await fetch(new URL("/ncat/translate-words", url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await signAgentToken(secret, askedBy)}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
    });
  } catch {
    return { lines: null, cost: 0 };
  }
  const result = (await response.json().catch(() => null)) as {
    answer?: unknown;
    usage?: unknown;
    model?: unknown;
  } | null;
  const model = typeof result?.model === "string" ? result.model : "";
  const cost = result?.usage ? costOfUsage(model, usageOf(result.usage)) : 0;
  if (!response.ok || typeof result?.answer !== "string") return { lines: null, cost };
  return { lines: readAlignedLines(result.answer, sizes), cost };
}

// A generous guess at one batch's cost, held against the run's limit before asking: the
// dearest model's price for this many words in and a long answer out.
function batchGuess(words: number): number {
  return costOfUsage("", {
    inputTokens: 1_500 + words * 8,
    outputTokens: 4_000 + words * 30,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}

/** A video's words translated and timed, a batch of lines at a time. */
async function translateVideo(
  ctx: Pick<ActionCtx, "runMutation">,
  runStepId: Id<"runSteps">,
  organizationId: string,
  askedBy: string,
  words: Word[],
  language: string,
): Promise<{ lines: TimedWord[][]; cost: number }> {
  const lines = spokenLines(words);
  const aligned: AlignedWord[][] = [];
  let spent = 0;
  for (let from = 0; from < lines.length; from += ALIGN_BATCH_LINES) {
    const batch = lines.slice(from, from + ALIGN_BATCH_LINES);
    const held = await ctx.runMutation(internal.captionTranslation.hold, {
      runStepId,
      micros: batchGuess(batch.flat().length),
    });
    if (!held.ok) throw new TranslateError(held.message);
    let answer: AlignedWord[][] | null = null;
    let cost = 0;
    for (let tries = 0; tries < TRIES && !answer; tries++) {
      const asked = await askModel(
        {
          organizationId,
          language: languageName(language),
          noSpaces: writtenWithoutSpaces(language),
          lines: batch.map((line) => line.map((k) => words[k]!.text)),
        },
        batch.map((line) => line.length),
        askedBy,
      );
      cost += asked.cost;
      answer = asked.lines;
    }
    await ctx.runMutation(internal.captionTranslation.settle, { runStepId, micros: cost });
    spent += cost;
    if (!answer) {
      throw new TranslateError(
        `The agent did not translate the captions into ${languageName(language)}. Run it again in a moment.`,
      );
    }
    aligned.push(...answer);
  }
  return { lines: timeTranslatedLines(words, lines, aligned), cost: spent };
}

/** The spoken words as they are, one list per line, for a video kept in its own language. */
function spokenAsTimed(words: Word[]): TimedWord[][] {
  return spokenLines(words).map((line) =>
    line.map((k) => ({ t: words[k]!.text, s: words[k]!.start, e: words[k]!.end })),
  );
}

export const translate = internalAction({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const loaded = await ctx.runQuery(internal.captionTranslation.load, args);
    if (!loaded) return;
    try {
      const connection = await ctx.runQuery(internal.storage.load, {
        organizationId: loaded.organizationId,
      });
      if (!connection) {
        throw new TranslateError(
          "Captions in another language are kept in your team's storage, and your toolkit has none set up. Connect storage on the Toolkit page.",
        );
      }
      const bucket = await bucketOf(connection);
      const files: { video: string; captions: string }[] = [];
      const done = new Map<string, TimedWord[][]>();
      for (const video of loaded.videos) {
        const words: Word[] = video.words;
        const key = `${video.video}\n${video.language}`;
        let lines = done.get(key) ?? video.kept;
        if (!lines && !video.language) lines = spokenAsTimed(words);
        if (!lines) {
          const made =
            words.length === 0
              ? { lines: [], cost: 0 }
              : await translateVideo(
                  ctx,
                  args.runStepId,
                  loaded.organizationId,
                  loaded.askedBy,
                  words,
                  video.language,
                );
          lines = made.lines;
          await ctx.runMutation(internal.captionTranslation.save, {
            organizationId: loaded.organizationId,
            video: video.video,
            language: video.language,
            lines,
            aiSpent: made.cost,
          });
        }
        done.set(key, lines);
        const file = translatedCaptionFile(
          lines,
          video.look as CaptionFileLook,
          { width: video.width, height: video.height },
          video.language,
        );
        const name = `captions/translated/${crypto.randomUUID()}.ass`;
        await putText(bucket, name, file, "text/x-ssa; charset=utf-8");
        files.push({
          video: video.video,
          captions: await presign(bucket, "GET", name, CAPTION_LINK_SECONDS),
        });
      }
      await ctx.runMutation(internal.captionTranslation.burn, {
        runStepId: args.runStepId,
        files,
      });
    } catch (error) {
      await ctx.runMutation(internal.captionTranslation.fail, {
        runStepId: args.runStepId,
        message:
          error instanceof TranslateError
            ? error.message
            : error instanceof BucketError
              ? `The caption file could not be put in your team's storage: ${error.message}`
              : "The captions in another language could not be made. Run it again in a moment.",
      });
    }
  },
});
