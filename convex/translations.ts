import {
  costOfUsage,
  cuesToTranslate,
  languageOf,
  nextBatchEnd,
  readTranslatedLines,
  translatedCues,
  wrapCue,
} from "@ncat-dash/automation-core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireMember } from "./lib/authz";
import { usageOf } from "./moments";
import { signAgentToken } from "./reviewAgent";

/**
 * What was said in a library file, in other languages: subtitles and captions for viewers
 * who speak another language.
 *
 * Each language of a file is translated once, from the transcript the file already has
 * (nothing is transcribed again), and kept in `translations`. The transcript is cut into
 * the same cues as its own subtitles; the agent server's model translates the cues' words
 * a batch at a time, and each cue keeps its times. A long video is done in several batches,
 * one scheduled after the other, so it shows how far it has got and no single call runs
 * long. A new transcript of the file drops its translations (lib/library.ts deletePieces).
 */

// The model answers a batch in well under a minute; give it room.
const AGENT_TIMEOUT_MS = 120_000;
// A batch whose answer cannot be read is asked again this many times before it fails.
const TRIES = 3;
// A Convex list holds 8,192 items: far more cues than the longest recording has.
const MAX_CUES = 8000;
// Lines said just before a batch, sent along so it reads on from them.
const CONTEXT_LINES = 3;
const MAX_LINE_CHARS = 2000;

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

/** The file's transcript pieces, in order. */
async function piecesOf(ctx: QueryCtx, itemId: Id<"libraryItems">) {
  return await ctx.db
    .query("transcriptPieces")
    .withIndex("by_item_and_start", (q) => q.eq("itemId", itemId))
    .take(4000);
}

/** The cues of the file's transcript, as they are translated. */
async function originalCues(ctx: QueryCtx, itemId: Id<"libraryItems">) {
  const pieces = await piecesOf(ctx, itemId);
  return cuesToTranslate(
    pieces.map((piece) => ({
      start: piece.start,
      end: piece.end,
      text: piece.text,
      ...(piece.words ? { words: piece.words } : {}),
    })),
  );
}

function shown(translation: Doc<"translations">) {
  return {
    _id: translation._id,
    language: translation.language,
    name: languageOf(translation.language)?.name ?? translation.language,
    status: translation.status,
    error: translation.error ?? null,
    done: translation.cues.length,
    total: translation.total,
    cues: translation.cues.map((cue) => ({ start: cue.s, end: cue.e, text: cue.t })),
  };
}

/** A file's translations, by language name. */
export const list = query({
  args: { itemId: v.id("libraryItems") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return [];
    await requireMember(ctx, item.organizationId);
    const translations = await ctx.db
      .query("translations")
      .withIndex("by_item_and_language", (q) => q.eq("itemId", item._id))
      .take(100);
    return translations.map(shown).sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * Translates a file into a language, once. A language it already has (or is being
 * translated into) is left as it is; one that failed is tried again.
 */
export const start = mutation({
  args: { itemId: v.id("libraryItems"), language: v.string() },
  returns: v.id("translations"),
  handler: async (ctx, args): Promise<Id<"translations">> => {
    const item = await ctx.db.get(args.itemId);
    if (!item) fail("not_found", "This file is no longer in the library.");
    const { userId } = await requireMember(ctx, item.organizationId);
    const language = languageOf(args.language);
    if (!language) fail("unknown_language", "Pick a language from the list.");
    if (item.transcript?.status !== "ready") {
      fail("no_transcript", "This file can be translated once what was said in it is ready.");
    }
    const cues = await originalCues(ctx, item._id);
    if (cues.length === 0) fail("nothing_said", "Nothing is said in this file to translate.");
    if (cues.length > MAX_CUES) fail("too_long", "This file is too long to translate in one go.");
    const existing = await ctx.db
      .query("translations")
      .withIndex("by_item_and_language", (q) =>
        q.eq("itemId", item._id).eq("language", language.code),
      )
      .first();
    if (existing && existing.status !== "failed") return existing._id;
    const row = {
      organizationId: item.organizationId,
      itemId: item._id,
      language: language.code,
      status: "working" as const,
      error: undefined,
      cues: existing?.cues ?? [],
      total: cues.length,
      aiSpent: existing?.aiSpent ?? 0,
      requestedBy: userId,
      at: Date.now(),
    };
    let id: Id<"translations">;
    if (existing) {
      // A failed translation carries on from the last batch it finished.
      await ctx.db.patch(existing._id, row);
      id = existing._id;
    } else id = await ctx.db.insert("translations", row);
    await ctx.scheduler.runAfter(0, internal.translations.translateNext, { translationId: id });
    return id;
  },
});

/** Removes a translation, so it can be made again or is no longer offered. */
export const remove = mutation({
  args: { translationId: v.id("translations") },
  handler: async (ctx, args) => {
    const translation = await ctx.db.get(args.translationId);
    if (!translation) return;
    await requireMember(ctx, translation.organizationId);
    await ctx.db.delete(translation._id);
  },
});

/** Corrects one translated line by hand. The line keeps its times. */
export const fixLine = mutation({
  args: { translationId: v.id("translations"), index: v.number(), text: v.string() },
  handler: async (ctx, args) => {
    const translation = await ctx.db.get(args.translationId);
    if (!translation) fail("not_found", "This translation is no longer here.");
    await requireMember(ctx, translation.organizationId);
    if (translation.status !== "ready") fail("not_ready", "Wait for the translation to finish.");
    const cue = translation.cues[args.index];
    if (!Number.isInteger(args.index) || !cue) fail("not_found", "That line is not here.");
    const text = wrapCue(args.text.slice(0, MAX_LINE_CHARS));
    if (!text) fail("empty", "A line needs some words.");
    const cues = translation.cues.map((one, index) =>
      index === args.index ? { ...one, t: text } : one,
    );
    await ctx.db.patch(translation._id, { cues });
  },
});

/** What the next batch needs: the lines still to translate and what came just before. */
export const nextBatch = internalQuery({
  args: { translationId: v.id("translations") },
  handler: async (ctx, args) => {
    const translation = await ctx.db.get(args.translationId);
    if (!translation || translation.status !== "working") return null;
    const item = await ctx.db.get(translation.itemId);
    if (!item) return null;
    const cues = await originalCues(ctx, item._id);
    const lines = cues.map((cue) => cue.text.slice(0, MAX_LINE_CHARS));
    const from = translation.cues.length;
    const end = nextBatchEnd(lines, from);
    return {
      organizationId: translation.organizationId,
      requestedBy: translation.requestedBy,
      language: languageOf(translation.language)?.name ?? translation.language,
      title: item.title,
      from,
      cues: cues.slice(from, end),
      before: lines.slice(Math.max(0, from - CONTEXT_LINES), from),
    };
  },
});

type Asked =
  | { ok: true; lines: string[]; cost: number }
  | { ok: false; error: string; cost: number; tryAgain: boolean };

/** Asks the agent server's model for one batch of lines. */
async function askModel(
  body: Record<string, unknown>,
  count: number,
  askedBy: string,
): Promise<Asked> {
  const url = process.env.AGENT_URL;
  const secret = process.env.MASTRA_JWT_SECRET;
  if (!url || !secret) {
    return {
      ok: false,
      cost: 0,
      tryAgain: false,
      error:
        "The agent is not set up on this dashboard yet, and it is what translates. Whoever runs the dashboard sets AGENT_URL and MASTRA_JWT_SECRET for Convex.",
    };
  }
  let response: Response;
  try {
    response = await fetch(new URL("/ncat/translate", url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await signAgentToken(secret, askedBy)}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, cost: 0, tryAgain: true, error: "The agent could not be reached." };
  }
  const result = (await response.json().catch(() => null)) as {
    answer?: unknown;
    usage?: unknown;
    model?: unknown;
  } | null;
  const model = typeof result?.model === "string" ? result.model : "";
  const cost = result?.usage ? costOfUsage(model, usageOf(result.usage)) : 0;
  if (!response.ok || typeof result?.answer !== "string") {
    return { ok: false, cost, tryAgain: true, error: "The agent did not answer." };
  }
  const lines = readTranslatedLines(result.answer, count);
  if (!lines) {
    return { ok: false, cost, tryAgain: true, error: "The agent's answer could not be read." };
  }
  return { ok: true, lines, cost };
}

/** Translates the next batch of a translation's lines, then schedules the one after. */
export const translateNext = internalAction({
  args: { translationId: v.id("translations"), tries: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batch = await ctx.runQuery(internal.translations.nextBatch, {
      translationId: args.translationId,
    });
    if (!batch) return;
    if (batch.cues.length === 0) {
      await ctx.runMutation(internal.translations.saveBatch, {
        translationId: args.translationId,
        from: batch.from,
        cues: [],
        cost: 0,
      });
      return;
    }
    const asked = await askModel(
      {
        organizationId: batch.organizationId,
        language: batch.language,
        title: batch.title.slice(0, 300),
        lines: batch.cues.map((cue) => cue.text),
        before: batch.before,
      },
      batch.cues.length,
      batch.requestedBy,
    );
    if (!asked.ok) {
      const tries = (args.tries ?? 0) + 1;
      await ctx.runMutation(internal.translations.batchFailed, {
        translationId: args.translationId,
        cost: asked.cost,
        error: asked.tryAgain && tries < TRIES ? null : `${asked.error} Try again in a moment.`,
      });
      if (asked.tryAgain && tries < TRIES) {
        await ctx.scheduler.runAfter(tries * 5_000, internal.translations.translateNext, {
          translationId: args.translationId,
          tries,
        });
      }
      return;
    }
    const cues = translatedCues(batch.cues, asked.lines).map((cue) => ({
      s: cue.start,
      e: cue.end,
      t: cue.text,
    }));
    await ctx.runMutation(internal.translations.saveBatch, {
      translationId: args.translationId,
      from: batch.from,
      cues,
      cost: asked.cost,
    });
  },
});

/** Adds a translated batch, and either schedules the next one or marks it ready. */
export const saveBatch = internalMutation({
  args: {
    translationId: v.id("translations"),
    from: v.number(),
    cues: v.array(v.object({ s: v.number(), e: v.number(), t: v.string() })),
    cost: v.number(),
  },
  handler: async (ctx, args) => {
    const translation = await ctx.db.get(args.translationId);
    // Removed, or another batch already saved here: this answer is not needed.
    if (!translation || translation.status !== "working") return;
    if (translation.cues.length !== args.from) return;
    const cues = [...translation.cues, ...args.cues];
    const done = cues.length >= translation.total;
    await ctx.db.patch(translation._id, {
      cues,
      aiSpent: translation.aiSpent + Math.max(0, Math.ceil(args.cost)),
      ...(done ? { status: "ready" as const, at: Date.now() } : {}),
    });
    if (!done) {
      await ctx.scheduler.runAfter(0, internal.translations.translateNext, {
        translationId: translation._id,
      });
    }
  },
});

/** A batch that did not come back: counts what it cost, and fails it when told why. */
export const batchFailed = internalMutation({
  args: {
    translationId: v.id("translations"),
    cost: v.number(),
    error: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const translation = await ctx.db.get(args.translationId);
    if (!translation || translation.status !== "working") return;
    await ctx.db.patch(translation._id, {
      aiSpent: translation.aiSpent + Math.max(0, Math.ceil(args.cost)),
      ...(args.error ? { status: "failed" as const, error: args.error, at: Date.now() } : {}),
    });
  },
});
