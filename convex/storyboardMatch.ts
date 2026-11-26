import { clipRef, matchTakes, timeRangeOf } from "@takewon/automation-core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { memberOrCaller } from "./lib/authz";
import { spokenIn } from "./lib/spoken";

/**
 * Putting recorded takes into a storyboard by what was said in them. The person picks the
 * recordings; each line that needs your take is matched with where it was said, and of
 * several takes of a line the best is used (automation-core's matchTakes).
 */

const fail = (code: string, message: string): never => {
  throw new ConvexError({ code, message });
};

/** At most this many recordings are matched at once. */
export const MOST_RECORDINGS = 20;

/** The storyboard's lines, numbered through the whole video, with whether each has a take. */
/** Who is asking, when it is an MCP client rather than the person signed in. */
const asCaller = v.optional(v.object({ organizationId: v.string(), userId: v.string() }));

export const lines = internalQuery({
  args: { storyboardId: v.id("storyboards"), as: asCaller },
  handler: async (ctx, args) => {
    const board = await ctx.db.get(args.storyboardId);
    if (!board) return null;
    await memberOrCaller(ctx, board.organizationId, args.as);
    const chapters = (
      await ctx.db
        .query("storyboardChapters")
        .withIndex("by_storyboard", (q) => q.eq("storyboardId", board._id))
        .collect()
    ).sort((a, b) => a.order - b.order);
    const takes = (
      await ctx.db
        .query("storyboardTakes")
        .withIndex("by_storyboard", (q) => q.eq("storyboardId", board._id))
        .collect()
    ).sort((a, b) => a.order - b.order);
    let number = 0;
    return {
      organizationId: board.organizationId,
      lines: chapters.flatMap((chapter) =>
        takes
          .filter((take) => take.chapterId === chapter._id)
          .map((take) => ({
            takeId: take._id,
            number: ++number,
            line: take.line,
            needsYou: take.parts.includes("you"),
            hasYou: !!take.files.you,
          })),
      ),
    };
  },
});

/** What was said in a recording, with how to point at a stretch of it. */
export const recording = internalQuery({
  args: { itemId: v.id("libraryItems"), organizationId: v.string() },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.organizationId !== args.organizationId) return null;
    if (item.kind !== "video" && item.kind !== "audio") return null;
    if (item.transcript?.status !== "ready") return { title: item.title, words: null };
    const link = item.url && /^https?:\/\/\S+$/.test(item.url) && !timeRangeOf(item.url);
    return {
      title: item.title,
      uploadId: item.uploadId ?? null,
      url: link ? item.url! : null,
      length: item.details?.duration ?? null,
      words: await spokenIn(ctx, item._id),
    };
  },
});

/** Puts each matched take's clip in as that line's take of you. */
export const apply = internalMutation({
  args: {
    storyboardId: v.id("storyboards"),
    files: v.array(v.object({ takeId: v.id("storyboardTakes"), file: v.string() })),
    as: asCaller,
  },
  handler: async (ctx, args) => {
    const board = await ctx.db.get(args.storyboardId);
    if (!board) return fail("not_found", "That storyboard is gone.");
    await memberOrCaller(ctx, board.organizationId, args.as);
    for (const { takeId, file } of args.files) {
      const take = await ctx.db.get(takeId);
      if (!take || take.storyboardId !== board._id || !take.parts.includes("you")) continue;
      await ctx.db.patch(take._id, { files: { ...take.files, you: file } });
    }
    await ctx.db.patch(board._id, { updatedAt: Date.now() });
  },
});

type Result = {
  matched: number;
  /** Lines said more than once, by number, where the best take was picked. */
  picked: number[];
  /** Lines that need your take and were not found in the recordings, by number. */
  missing: number[];
  /** Recordings that could not be read yet, by name. */
  notReady: string[];
};

/**
 * Matches the takes in the picked recordings to the storyboard's lines by what was said,
 * and puts the best take of each line in. Lines that have a take already keep it unless
 * `replace` is set.
 */
async function matchInto(
  ctx: ActionCtx,
  args: {
    storyboardId: Id<"storyboards">;
    libraryItemIds: Id<"libraryItems">[];
    replace?: boolean;
  },
  as?: { organizationId: string; userId: string },
): Promise<Result> {
  const board = await ctx.runQuery(internal.storyboardMatch.lines, {
    storyboardId: args.storyboardId,
    ...(as ? { as } : {}),
  });
  if (!board) return fail("not_found", "That storyboard is gone.");
  const ids = [...new Set(args.libraryItemIds)];
  if (ids.length === 0) fail("invalid_input", "Pick at least one recording.");
  if (ids.length > MOST_RECORDINGS) {
    fail("limit", `Pick up to ${MOST_RECORDINGS} recordings at a time.`);
  }
  const recordings: {
    id: string;
    words: { text: string; start: number; end: number }[];
    length?: number;
    clip: (start: number, end: number) => string | null;
  }[] = [];
  const notReady: string[] = [];
  for (const itemId of ids) {
    const found = await ctx.runQuery(internal.storyboardMatch.recording, {
      itemId,
      organizationId: board.organizationId,
    });
    if (!found) continue;
    if (!found.words) {
      notReady.push(found.title);
      continue;
    }
    const { uploadId, url } = found;
    const round = (value: number) => Math.round(value * 1000) / 1000;
    recordings.push({
      id: itemId,
      words: found.words,
      ...(found.length ? { length: found.length } : {}),
      clip: (start, end) =>
        uploadId
          ? clipRef(uploadId, start, end)
          : url
            ? `${url}#t=${round(start)},${round(end)}`
            : null,
    });
  }
  if (recordings.length === 0) {
    return fail(
      "not_ready",
      notReady.length > 0
        ? "Those recordings are still being transcribed. Try again once their words are in."
        : "None of those recordings has anything said in it.",
    );
  }
  const wanted = board.lines.filter((line) => line.needsYou && (args.replace || !line.hasYou));
  const matched = matchTakes(
    wanted.map((line) => line.line),
    recordings,
  );
  const byId = new Map(recordings.map((one) => [one.id, one]));
  const files: { takeId: Id<"storyboardTakes">; file: string }[] = [];
  const picked: number[] = [];
  for (const one of matched) {
    const line = wanted[one.line]!;
    const file = byId.get(one.recording)?.clip(one.start, one.end);
    if (!file) continue;
    files.push({ takeId: line.takeId, file });
    if (one.takes > 1) picked.push(line.number);
  }
  if (files.length > 0) {
    await ctx.runMutation(internal.storyboardMatch.apply, {
      storyboardId: args.storyboardId,
      files,
      ...(as ? { as } : {}),
    });
  }
  const filled = new Set(files.map((one) => one.takeId));
  return {
    matched: files.length,
    picked,
    missing: wanted.filter((line) => !filled.has(line.takeId)).map((line) => line.number),
    notReady,
  };
}

const matchArgs = {
  libraryItemIds: v.array(v.id("libraryItems")),
  replace: v.optional(v.boolean()),
};
const matched = v.object({
  matched: v.number(),
  picked: v.array(v.number()),
  missing: v.array(v.number()),
  notReady: v.array(v.string()),
});

export const match = action({
  args: { storyboardId: v.id("storyboards"), ...matchArgs },
  returns: matched,
  handler: (ctx, args): Promise<Result> => matchInto(ctx, args),
});

/** `match` for an MCP client, as the person it signed in as. */
export const matchAs = internalAction({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    storyboardId: v.id("storyboards"),
    ...matchArgs,
  },
  returns: matched,
  handler: (ctx, { organizationId, userId, ...args }): Promise<Result> =>
    matchInto(ctx, args, { organizationId, userId }),
});
