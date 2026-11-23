import {
  type AiUsage,
  type AutomationEdge,
  type AutomationNode,
  BROLL_GAPS,
  costOfUsage,
  guessCost,
  brollSettings,
  chapterSettings,
  MAX_CUTAWAYS,
  nearestUpstreamOfKind,
  momentSettings,
  motionPlanSettings,
  sourceKey,
  transcriptText,
  type Word,
  wordsFromSegments,
} from "@ncat-dash/automation-core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { advance, bookAgentRetry, failStep } from "./lib/runner";
import { finishPicking, heardFrom, MAX_WORDS, wordsFor } from "./lib/moments";
import { motionPlanOf } from "./lib/motion";
import { startingFileName } from "./lib/outputs";
import { signAgentToken } from "./reviewAgent";

/**
 * The "pick" stage of the Best moments and Chapters steps (see lib/moments.ts): gets each
 * video's words, asks the agent server's model to pick from the transcript, and hands the
 * answers back to the run, which checks every pick against the words itself.
 *
 * What a pick costs:
 * - The same question asked again (same transcript, settings and house rules, such as a
 *   run tried again or a rerun on the same upload) is answered from `pickAnswers`.
 * - A run nobody is watching (a trigger started it, not a person, and it is not a test)
 *   sends its questions as one batch at half the price (agent ncat/moments-batch.ts), and
 *   `checkBatch` looks for the answers, sooner at first and then less often. If the agent
 *   server cannot batch, or the batch fails or takes over a day, the pick asks the usual
 *   way.
 */

// The model reads a long transcript; give it time.
const AGENT_TIMEOUT_MS = 240_000;
const WORDS_FILE_TIMEOUT_MS = 60_000;
const WORDS_FILE_LIMIT = 50_000_000;
// A batch is usually answered within minutes; Anthropic gives up on one after 24 hours.
const FIRST_CHECK_MS = 60_000;
const LONGEST_CHECK_GAP_MS = 15 * 60_000;
const BATCH_GIVE_UP_MS = 25 * 60 * 60_000;
const MAX_BATCH = 20;
// Saved answers are forgotten after this long.
const ANSWER_DAYS = 30;

/** What the pick needs to know about a step waiting at "pick". */
export const loadPick = internalQuery({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.runStepId);
    if (!step || step.status !== "running" || step.stage !== "pick") return null;
    const run = await ctx.db.get(step.runId);
    if (!run || (run.status !== "running" && run.status !== "waiting")) return null;
    const node = (run.nodes as AutomationNode[]).find((candidate) => candidate.id === step.nodeId);
    if (
      !node ||
      (node.kind !== "moments" &&
        node.kind !== "chapters" &&
        node.kind !== "broll-plan" &&
        node.kind !== "motion-plan")
    ) {
      return null;
    }
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
    const fileName = startingFileName(run.trigger);
    return {
      organizationId: run.organizationId,
      kind: node.kind,
      input: node.input,
      // For Plan B-Roll: the settings of the Add B-Roll step that will carry the plan out.
      carriedOutBy:
        node.kind === "broll-plan"
          ? ((run.nodes as AutomationNode[]).find(
              (other) =>
                other.kind === "broll" &&
                nearestUpstreamOfKind(
                  other.id,
                  "broll-plan",
                  run.nodes as AutomationNode[],
                  run.edges as AutomationEdge[],
                )?.id === node.id,
            )?.input ?? {})
          : {},
      // For Plan Motion Graphics: the style of the Add Motion Graphics that will draw the plan.
      motion:
        node.kind === "motion-plan"
          ? await motionPlanOf(
              ctx,
              run.organizationId,
              node.id,
              run.nodes as AutomationNode[],
              run.edges as AutomationEdge[],
            )
          : null,
      title: fileName ?? run.automationName,
      askedBy: run.startedBy ?? "automation",
      unattended: run.startedBy === null && run.test === undefined,
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
    // True when the failure may pass, so the step tries again while it has tries left.
    tryAgain: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.runStepId);
    if (!step || step.status !== "running" || step.stage !== "pick") return;
    const run = await ctx.db.get(step.runId);
    if (!run || (run.status !== "running" && run.status !== "waiting")) return;
    if (args.error !== undefined && args.tryAgain) {
      if (await bookAgentRetry(ctx, run, step, args.error, "pick")) return;
    }
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

/** Saved answers to these questions (by SHA-256), from the last 30 days. */
export const savedAnswers = internalQuery({
  args: { organizationId: v.string(), questions: v.array(v.string()) },
  handler: async (ctx, args) => {
    const since = Date.now() - ANSWER_DAYS * 86_400_000;
    const found: { question: string; answer: string }[] = [];
    for (const question of args.questions) {
      const row = await ctx.db
        .query("pickAnswers")
        .withIndex("by_question", (q) =>
          q.eq("organizationId", args.organizationId).eq("question", question),
        )
        .first();
      if (row && row.savedAt >= since) found.push({ question, answer: row.answer });
    }
    return found;
  },
});

/** Keeps the model's answers, so the same questions are not paid for again. */
export const saveAnswers = internalMutation({
  args: {
    organizationId: v.string(),
    answers: v.array(v.object({ question: v.string(), answer: v.string() })),
  },
  handler: async (ctx, args) => {
    for (const { question, answer } of args.answers) {
      const found = await ctx.db
        .query("pickAnswers")
        .withIndex("by_question", (q) =>
          q.eq("organizationId", args.organizationId).eq("question", question),
        )
        .first();
      const row = { organizationId: args.organizationId, question, answer, savedAt: Date.now() };
      if (found) await ctx.db.replace(found._id, row);
      else await ctx.db.insert("pickAnswers", row);
    }
  },
});

/** Forgets saved answers more than 30 days old, a few hundred at a time. */
export const forgetOldAnswers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const before = Date.now() - ANSWER_DAYS * 86_400_000;
    const old = await ctx.db
      .query("pickAnswers")
      .withIndex("by_saved", (q) => q.lt("savedAt", before))
      .take(500);
    for (const row of old) await ctx.db.delete(row._id);
    if (old.length === 500) await ctx.scheduler.runAfter(0, internal.moments.forgetOldAnswers, {});
  },
});

/** Notes the batch a step's questions went in, and when to look for its answers. */
export const waitForBatch = internalMutation({
  args: { runStepId: v.id("runSteps"), organizationId: v.string(), batchId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("pickBatches", { ...args, sentAt: Date.now(), checks: 0 });
    await ctx.scheduler.runAfter(FIRST_CHECK_MS, internal.moments.checkBatch, {
      runStepId: args.runStepId,
    });
  },
});

/** The batch a step waits on, and whether the step still waits for it. */
export const loadBatch = internalQuery({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const batch = await ctx.db
      .query("pickBatches")
      .withIndex("by_step", (q) => q.eq("runStepId", args.runStepId))
      .first();
    if (!batch) return null;
    const step = await ctx.db.get(args.runStepId);
    const run = step ? await ctx.db.get(step.runId) : null;
    const waiting =
      !!step &&
      step.status === "running" &&
      step.stage === "pick" &&
      !!run &&
      (run.status === "running" || run.status === "waiting");
    return {
      batchId: batch.batchId,
      organizationId: batch.organizationId,
      sentAt: batch.sentAt,
      waiting,
    };
  },
});

/** Looks again later, waiting twice as long each time up to 15 minutes. */
export const checkLater = internalMutation({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const batch = await ctx.db
      .query("pickBatches")
      .withIndex("by_step", (q) => q.eq("runStepId", args.runStepId))
      .first();
    if (!batch) return;
    const checks = batch.checks + 1;
    await ctx.db.patch(batch._id, { checks });
    await ctx.scheduler.runAfter(
      Math.min(FIRST_CHECK_MS * 2 ** checks, LONGEST_CHECK_GAP_MS),
      internal.moments.checkBatch,
      args,
    );
  },
});

/**
 * Done with a step's batch. When the step still waits, the pick runs again: the answers
 * the batch brought are saved by then, and any it did not bring are asked the usual way.
 */
export const endBatch = internalMutation({
  args: { runStepId: v.id("runSteps"), pickAgain: v.boolean() },
  handler: async (ctx, args) => {
    const batch = await ctx.db
      .query("pickBatches")
      .withIndex("by_step", (q) => q.eq("runStepId", args.runStepId))
      .first();
    if (batch) await ctx.db.delete(batch._id);
    if (args.pickAgain) {
      await ctx.scheduler.runAfter(0, internal.moments.pick, {
        runStepId: args.runStepId,
        live: true,
      });
    }
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

export class PickError extends Error {}

/**
 * The agent could not answer this time (busy, out of reach, or an empty answer): the
 * step tries again later, on the team's retries, before it fails.
 */
export class AgentBusyError extends PickError {}

/** Whether a failure in asking the agent may pass if the step tries again. */
export function mayPass(error: unknown): boolean {
  return error instanceof AgentBusyError || !(error instanceof PickError);
}

/** What Plan B-Roll asks for, from its own settings and those of the Add B-Roll after it. */
function brollPlanSettings(
  input: Record<string, unknown>,
  carriedOutBy: Record<string, unknown>,
  duration: number,
) {
  const add = brollSettings(carriedOutBy);
  const gap = BROLL_GAPS[add.often];
  return {
    count: Math.max(1, Math.min(MAX_CUTAWAYS, Math.ceil(duration / (gap + add.seconds)))),
    gap,
    skipOpening: add.skipOpening,
    lookFor: typeof input.lookFor === "string" ? input.lookFor.trim().slice(0, 1000) : "",
  };
}

/**
 * A video's words: kept from before, or read from what "listen" heard and kept for next
 * time. Throws a PickError with a plain reason when there are none.
 */
export async function wordsOfVideo(
  ctx: ActionCtx,
  organizationId: string,
  video: {
    url: string;
    duration: number;
    words: Word[] | null;
    segments: unknown;
    wordsFile: string | null;
  },
): Promise<Word[]> {
  let words: Word[] | null = video.words;
  if (!words) {
    words =
      (Array.isArray(video.segments) ? wordsFromSegments(video.segments) : null) ??
      (video.wordsFile ? await readWordsFile(video.wordsFile) : null);
    if (!words) throw new PickError("Could not read the transcript the toolkit made.");
    if (words.length === 0) throw new PickError("No speech was heard in the video.");
    words = words.slice(0, MAX_WORDS);
    await ctx.runMutation(internal.moments.saveWords, {
      organizationId,
      source: video.url,
      duration: video.duration || words[words.length - 1].end,
      words: words.map((word) => ({ t: word.text, s: word.start, e: word.end })),
    });
  }
  if (words.length === 0) throw new PickError("No speech was heard in the video.");
  return words;
}

/** The question's SHA-256, which its saved answer is kept under. */
async function questionKey(body: Record<string, unknown>): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(body)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A signed POST to the agent server, or null when it is not set up or not reachable. */
async function postToAgent(
  path: string,
  body: unknown,
  askedBy: string,
  timeoutMs = 60_000,
): Promise<Response | null> {
  const url = process.env.AGENT_URL;
  const secret = process.env.MASTRA_JWT_SECRET;
  if (!url || !secret) return null;
  try {
    return await fetch(new URL(path, url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await signAgentToken(secret, askedBy)}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
}

/** Sends the questions as one batch. Returns its id, or null to ask the usual way. */
async function sendBatch(
  questions: { key: string; body: Record<string, unknown> }[],
  askedBy: string,
  organizationId: string,
): Promise<string | null> {
  if (questions.length === 0 || questions.length > MAX_BATCH) return null;
  const response = await postToAgent(
    "/ncat/moments/batch",
    { organizationId, requests: questions.map(({ key, body }) => ({ id: key, request: body })) },
    askedBy,
  );
  if (!response?.ok) return null;
  const result = (await response.json().catch(() => null)) as { batchId?: unknown } | null;
  return typeof result?.batchId === "string" ? result.batchId : null;
}

/** What the agent server says an answer used, read leniently. */
export function usageOf(value: unknown): AiUsage {
  const usage = (value ?? {}) as Record<string, unknown>;
  const n = (key: string) => (typeof usage[key] === "number" ? (usage[key] as number) : 0);
  return {
    inputTokens: n("inputTokens"),
    outputTokens: n("outputTokens"),
    cacheReadTokens: n("cacheReadTokens"),
    cacheWriteTokens: n("cacheWriteTokens"),
  };
}

/** What one answer cost, from what the agent server reported with it, in micros. */
export function answerCost(result: { usage?: unknown; model?: unknown }, batch = false): number {
  // No model named: priced as the dearest, so the run's limit still holds.
  const model = typeof result.model === "string" ? result.model : "";
  return costOfUsage(model, usageOf(result.usage), batch);
}

/**
 * Asks the agent server's model to pick from one transcript. Returns its answer as text,
 * and what it cost in millionths of a dollar.
 */
async function askModel(
  body: Record<string, unknown>,
  askedBy: string,
  organizationId: string,
): Promise<{ answer: string; cost: number }> {
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
      // The team, so the agent server uses the team's own Anthropic key when it has one.
      body: JSON.stringify({ ...body, organizationId }),
      signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
    });
  } catch {
    throw new AgentBusyError("The agent could not be reached to pick.");
  }
  const result = (await response.json().catch(() => null)) as {
    answer?: unknown;
    usage?: unknown;
    model?: unknown;
  } | null;
  if (!response.ok || typeof result?.answer !== "string" || result.answer.trim() === "") {
    throw new AgentBusyError("The agent did not answer when asked to pick.");
  }
  return { answer: result.answer, cost: answerCost(result) };
}

/**
 * The pick itself: words for each video, then one question to the model per video,
 * answered from a saved answer, a batch (unattended runs) or the model straight away.
 * `live` skips the batch, once a batch has been tried.
 */
export const pick = internalAction({
  args: { runStepId: v.id("runSteps"), live: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const loaded = await ctx.runQuery(internal.moments.loadPick, { runStepId: args.runStepId });
    if (!loaded) return;
    const finish = (
      answers: { url: string; answer: string }[],
      error?: string,
      tryAgain?: boolean,
    ) =>
      ctx.runMutation(internal.moments.finishPick, {
        runStepId: args.runStepId as Id<"runSteps">,
        answers,
        ...(error !== undefined ? { error } : {}),
        ...(tryAgain ? { tryAgain } : {}),
      });
    // What the answers asked this time really cost, in micros.
    let spent = 0;
    try {
      const questions: { url: string; key: string; body: Record<string, unknown> }[] = [];
      for (const video of loaded.videos) {
        const words = await wordsOfVideo(ctx, loaded.organizationId, video);
        if (words.length === 0) throw new PickError("No speech was heard in the video.");
        const duration = video.duration || words[words.length - 1].end;
        const settings =
          loaded.kind === "broll-plan"
            ? brollPlanSettings(loaded.input, loaded.carriedOutBy, duration)
            : loaded.kind === "motion-plan" && loaded.motion
              ? motionPlanSettings(loaded.motion.setup, duration, loaded.input, loaded.motion.level)
              : loaded.kind === "moments"
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
        const body = {
          kind:
            loaded.kind === "broll-plan"
              ? ("broll" as const)
              : loaded.kind === "motion-plan"
                ? ("motion" as const)
                : loaded.kind,
          title: loaded.title.slice(0, 300),
          duration,
          transcript: transcriptText(words),
          settings,
          ...(loaded.kind === "moments" ? { avoid: video.avoid } : {}),
          houseRules: loaded.houseRules.slice(0, 2000),
        };
        questions.push({ url: video.url, key: await questionKey(body), body });
      }

      const saved = new Map(
        (
          await ctx.runQuery(internal.moments.savedAnswers, {
            organizationId: loaded.organizationId,
            questions: questions.map(({ key }) => key),
          })
        ).map(({ question, answer }) => [question, answer]),
      );
      const unanswered = questions.filter(({ key }) => !saved.has(key));
      const batching = unanswered.length > 0 && loaded.unattended && !args.live;
      // Hold a generous guess against the run's AI limit before asking anything.
      if (unanswered.length > 0) {
        const guess = unanswered.reduce(
          (sum, { body }) => sum + guessCost("", JSON.stringify(body).length, batching),
          0,
        );
        const held = await ctx.runMutation(internal.aiSpend.hold, {
          runStepId: args.runStepId,
          micros: guess,
        });
        if (!held.ok) throw new PickError(held.message);
      }
      if (batching) {
        const batchId = await sendBatch(unanswered, loaded.askedBy, loaded.organizationId);
        if (batchId) {
          await ctx.runMutation(internal.moments.waitForBatch, {
            runStepId: args.runStepId,
            organizationId: loaded.organizationId,
            batchId,
          });
          return;
        }
      }

      const answers: { url: string; answer: string }[] = [];
      try {
        for (const question of questions) {
          let answer = saved.get(question.key);
          if (answer === undefined) {
            const asked = await askModel(question.body, loaded.askedBy, loaded.organizationId);
            answer = asked.answer;
            spent += asked.cost;
            await ctx.runMutation(internal.moments.saveAnswers, {
              organizationId: loaded.organizationId,
              answers: [{ question: question.key, answer }],
            });
          }
          answers.push({ url: question.url, answer });
        }
      } finally {
        if (unanswered.length > 0) {
          await ctx.runMutation(internal.aiSpend.settle, {
            runStepId: args.runStepId,
            micros: spent,
          });
        }
      }
      await finish(answers);
    } catch (error) {
      await finish(
        [],
        error instanceof PickError ? error.message : "Picking failed.",
        mayPass(error),
      );
    }
  },
});

/** Looks for a batch's answers; saves them and picks again once they are in. */
export const checkBatch = internalAction({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const batch = await ctx.runQuery(internal.moments.loadBatch, args);
    if (!batch) return;
    if (!batch.waiting) {
      await ctx.runMutation(internal.moments.endBatch, { ...args, pickAgain: false });
      return;
    }
    const response = await postToAgent(
      "/ncat/moments/batch/answers",
      { batchId: batch.batchId, organizationId: batch.organizationId },
      "automation",
    );
    const result = response?.ok
      ? ((await response.json().catch(() => null)) as {
          pending?: unknown;
          answers?: { id?: unknown; answer?: unknown; usage?: unknown; model?: unknown }[];
        } | null)
      : null;
    const answers = Array.isArray(result?.answers) ? result.answers : null;
    // Still working, or not reachable just now: look again later, up to a day.
    if (!answers && Date.now() - batch.sentAt < BATCH_GIVE_UP_MS && response?.status !== 409) {
      await ctx.runMutation(internal.moments.checkLater, args);
      return;
    }
    const good = (answers ?? []).flatMap(({ id, answer }) =>
      typeof id === "string" && typeof answer === "string" && answer.trim() !== ""
        ? [{ question: id, answer }]
        : [],
    );
    // Every answer the batch gave was paid for, at the batch price, even one not usable.
    if (answers) {
      await ctx.runMutation(internal.aiSpend.settle, {
        runStepId: args.runStepId,
        micros: answers.reduce((sum, one) => sum + answerCost(one, true), 0),
      });
    }
    if (good.length > 0) {
      await ctx.runMutation(internal.moments.saveAnswers, {
        organizationId: batch.organizationId,
        answers: good,
      });
    }
    await ctx.runMutation(internal.moments.endBatch, { ...args, pickAgain: true });
  },
});
