import {
  clipRef,
  draftStoryboard,
  readClipRef,
  readUploadRef,
  timeRangeOf,
  type Word,
} from "@takewon/automation-core";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { backgroundPool } from "./lib/pools";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server";
import { isMember, MANAGER_ROLES, requireMember, type TeamRole } from "./lib/authz";
import { deleteBoard } from "./lib/storyboards";
import { signAgentToken } from "./reviewAgent";
import {
  aboutLength,
  ASPECTS,
  cleanParts,
  LIMITS,
  type Part,
  PARTS,
  partsForScene,
  readSceneAnswer,
  readScript,
  type Scene,
  secondsFor,
  statusOf,
  type TakeFiles,
  writeScript,
} from "./lib/storyboard";
import { cutValidator, sceneValidator, takePartValidator } from "./schema";

const fail = (code: string, message: string): never => {
  throw new ConvexError({ code, message });
};

const aspectValidator = v.union(...ASPECTS.map((aspect) => v.literal(aspect)));

function cleanText(text: string, limit: number, empty: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) fail("invalid_input", empty);
  if (trimmed.length > limit) fail("invalid_input", `Keep it to ${limit} letters.`);
  return trimmed;
}

/** A file for a take: a web address, or a pointer to one of the team's uploads or part of one. */
function cleanFile(url: string): string {
  const trimmed = url.trim();
  if (readUploadRef(trimmed) || readClipRef(trimmed) || /^https?:\/\/\S+$/.test(trimmed)) {
    return trimmed;
  }
  return fail("invalid_input", "That is not a file link.");
}

function cleanCuts(cuts: { what: string; where: string }[]) {
  if (cuts.length > LIMITS.cuts) fail("limit", `A storyboard can list up to ${LIMITS.cuts} cuts.`);
  return cuts
    .map((cut) => ({
      what: cut.what.trim().replace(/\s+/g, " ").slice(0, LIMITS.cutText),
      where: cut.where.trim().replace(/\s+/g, " ").slice(0, LIMITS.cutText),
    }))
    .filter((cut) => cut.what);
}

async function boardOf(ctx: QueryCtx, projectId: Id<"projects">) {
  return await ctx.db
    .query("storyboards")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .unique();
}

async function draftOf(ctx: QueryCtx, libraryItemId: Id<"libraryItems">) {
  return await ctx.db
    .query("storyboards")
    .withIndex("by_library_item", (q) => q.eq("libraryItemId", libraryItemId))
    .unique();
}

async function chaptersOf(ctx: QueryCtx, storyboardId: Id<"storyboards">) {
  const chapters = await ctx.db
    .query("storyboardChapters")
    .withIndex("by_storyboard", (q) => q.eq("storyboardId", storyboardId))
    .take(LIMITS.chapters + 10);
  return chapters.sort((a, b) => a.order - b.order);
}

async function takesOf(ctx: QueryCtx, storyboardId: Id<"storyboards">) {
  const takes = await ctx.db
    .query("storyboardTakes")
    .withIndex("by_storyboard", (q) => q.eq("storyboardId", storyboardId))
    .take(LIMITS.takes + 50);
  return takes.sort((a, b) => a.order - b.order);
}

async function chapterTakes(ctx: QueryCtx, chapterId: Id<"storyboardChapters">) {
  const takes = await ctx.db
    .query("storyboardTakes")
    .withIndex("by_chapter", (q) => q.eq("chapterId", chapterId))
    .take(LIMITS.takes + 50);
  return takes.sort((a, b) => a.order - b.order);
}

async function loadBoard(ctx: MutationCtx, storyboardId: Id<"storyboards">) {
  const board = await ctx.db.get(storyboardId);
  if (!board) return fail("not_found", "That storyboard is gone.");
  const member = await requireMember(ctx, board.organizationId);
  return { board, ...member };
}

async function loadChapter(ctx: MutationCtx, chapterId: Id<"storyboardChapters">) {
  const chapter = await ctx.db.get(chapterId);
  if (!chapter) return fail("not_found", "That chapter is gone.");
  await requireMember(ctx, chapter.organizationId);
  return chapter;
}

async function loadTake(ctx: MutationCtx, takeId: Id<"storyboardTakes">) {
  const take = await ctx.db.get(takeId);
  if (!take) return fail("not_found", "That take is gone.");
  await requireMember(ctx, take.organizationId);
  return take;
}

const touch = (ctx: MutationCtx, storyboardId: Id<"storyboards">) =>
  ctx.db.patch(storyboardId, { updatedAt: Date.now() });

/** Numbers a chapter's takes 0, 1, 2… in the order given. */
async function renumber(ctx: MutationCtx, takes: Doc<"storyboardTakes">[]) {
  for (const [index, take] of takes.entries()) {
    if (take.order !== index) await ctx.db.patch(take._id, { order: index });
  }
}

async function clearBoard(ctx: MutationCtx, storyboardId: Id<"storyboards">) {
  for (const take of await takesOf(ctx, storyboardId)) await ctx.db.delete(take._id);
  for (const chapter of await chaptersOf(ctx, storyboardId)) await ctx.db.delete(chapter._id);
}

/**
 * Writes a script's chapters and takes into a storyboard. A take whose line is the same as
 * one already there keeps that one's files, so editing the text never loses a take.
 */
async function fillBoard(
  ctx: MutationCtx,
  board: Doc<"storyboards">,
  text: string,
): Promise<{ chapters: number; takes: number }> {
  const script = readScript(text);
  const total = script.chapters.reduce((sum, chapter) => sum + chapter.takes.length, 0);
  if (total === 0) fail("invalid_input", "Write at least one line for a take.");
  if (total > LIMITS.takes) fail("limit", `A storyboard can have up to ${LIMITS.takes} takes.`);
  const kept = new Map<string, TakeFiles[]>();
  for (const take of await takesOf(ctx, board._id)) {
    const files = Object.fromEntries(
      Object.entries(take.files).filter(([, url]) => url),
    ) as TakeFiles;
    if (Object.keys(files).length === 0) continue;
    kept.set(take.line, [...(kept.get(take.line) ?? []), files]);
  }
  await clearBoard(ctx, board._id);
  for (const [order, chapter] of script.chapters.entries()) {
    const chapterId = await ctx.db.insert("storyboardChapters", {
      storyboardId: board._id,
      organizationId: board.organizationId,
      title: chapter.title,
      order,
    });
    for (const [index, take] of chapter.takes.entries()) {
      const before = kept.get(take.line)?.shift() ?? {};
      const files = Object.fromEntries(
        Object.entries(before).filter(([part]) => take.parts.includes(part as Part)),
      );
      await ctx.db.insert("storyboardTakes", {
        storyboardId: board._id,
        chapterId,
        organizationId: board.organizationId,
        order: index,
        line: take.line,
        scene: take.scene,
        parts: take.parts,
        files,
      });
    }
  }
  await touch(ctx, board._id);
  return { chapters: script.chapters.length, takes: total };
}

/**
 * A storyboard with its chapters, their takes numbered through the whole video, and where
 * each take stands.
 */
async function layOut(ctx: QueryCtx, board: Doc<"storyboards">, role: TeamRole) {
  const chapters = await chaptersOf(ctx, board._id);
  const takes = await takesOf(ctx, board._id);
  let number = 0;
  const totals = Object.fromEntries(PARTS.map(({ part }) => [part, { done: 0, all: 0 }])) as Record<
    Part,
    { done: number; all: number }
  >;
  const laidOut = chapters.map((chapter) => {
    const here = takes.filter((take) => take.chapterId === chapter._id);
    const rows = here.map((take) => {
      number += 1;
      const files = take.files as TakeFiles;
      for (const part of take.parts) {
        totals[part].all += 1;
        if (files[part]) totals[part].done += 1;
      }
      return {
        _id: take._id,
        number,
        line: take.line,
        scene: take.scene,
        parts: take.parts,
        files,
        status: statusOf(take.parts, files),
      };
    });
    const needs = Object.fromEntries(
      PARTS.map(({ part }) => [part, here.filter((take) => take.parts.includes(part)).length]),
    ) as Record<Part, number>;
    return {
      _id: chapter._id,
      title: chapter.title,
      takes: rows,
      needs,
      seconds: secondsFor(here.map((take) => take.line)),
      ready: rows.length > 0 && rows.every((row) => row.status.tone === "done"),
    };
  });
  const seconds = secondsFor(takes.map((take) => take.line));
  return {
    _id: board._id,
    organizationId: board.organizationId,
    projectId: board.projectId ?? null,
    libraryItemId: board.libraryItemId ?? null,
    aspect: board.aspect,
    source: board.source ?? null,
    cuts: board.cuts,
    chapters: laidOut,
    takeCount: takes.length,
    seconds,
    length: aboutLength(seconds),
    totals,
    canDelete: MANAGER_ROLES.includes(role),
    updatedAt: board.updatedAt,
  };
}

/** A project's storyboard, laid out. Null when the project has none yet. */
export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || !(await isMember(ctx, project.organizationId))) return null;
    const { role } = await requireMember(ctx, project.organizationId);
    const board = await boardOf(ctx, project._id);
    if (!board) return null;
    return await layOut(ctx, board, role);
  },
});

/** The storyboard drafted from an upload, laid out. Null while there is none. */
export const forUpload = query({
  args: { libraryItemId: v.id("libraryItems") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.libraryItemId);
    if (!item || !(await isMember(ctx, item.organizationId))) return null;
    const { role } = await requireMember(ctx, item.organizationId);
    const board = await draftOf(ctx, item._id);
    if (!board) return null;
    return await layOut(ctx, board, role);
  },
});

/** The storyboard as text, to read, copy or edit all at once. */
export const script = query({
  args: { storyboardId: v.id("storyboards") },
  handler: async (ctx, args) => {
    const board = await ctx.db.get(args.storyboardId);
    if (!board || !(await isMember(ctx, board.organizationId))) return null;
    const chapters = await chaptersOf(ctx, board._id);
    const takes = await takesOf(ctx, board._id);
    return writeScript({
      chapters: chapters.map((chapter) => ({
        title: chapter.title,
        takes: takes
          .filter((take) => take.chapterId === chapter._id)
          .map((take) => ({ line: take.line, scene: take.scene as Scene, parts: take.parts })),
      })),
    });
  },
});

/** Starts a project's storyboard, from a script when one is given, else one empty chapter. */
export const create = mutation({
  args: {
    projectId: v.id("projects"),
    script: v.optional(v.string()),
    aspect: v.optional(aspectValidator),
    source: v.optional(v.string()),
    cuts: v.optional(v.array(cutValidator)),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return fail("not_found", "That project is gone.");
    await requireMember(ctx, project.organizationId);
    if (await boardOf(ctx, project._id)) fail("exists", "This project has a storyboard already.");
    const source = args.source?.trim().replace(/\s+/g, " ").slice(0, LIMITS.source);
    const storyboardId = await ctx.db.insert("storyboards", {
      organizationId: project.organizationId,
      projectId: project._id,
      aspect: args.aspect ?? "16:9",
      ...(source ? { source } : {}),
      cuts: cleanCuts(args.cuts ?? []),
      updatedAt: Date.now(),
    });
    const board = (await ctx.db.get(storyboardId))!;
    if (args.script?.trim()) {
      await fillBoard(ctx, board, args.script);
    } else {
      await ctx.db.insert("storyboardChapters", {
        storyboardId,
        organizationId: project.organizationId,
        title: "Chapter 1",
        order: 0,
      });
    }
    await ctx.db.patch(project._id, { updatedAt: Date.now() });
    return storyboardId;
  },
});

/** Replaces every chapter and take with the ones in a script, keeping files of same lines. */
export const writeFromScript = mutation({
  args: { storyboardId: v.id("storyboards"), script: v.string() },
  handler: async (ctx, args) => {
    const { board } = await loadBoard(ctx, args.storyboardId);
    return await fillBoard(ctx, board, args.script);
  },
});

/** Changes the storyboard's shape, where its lines came from, or the cuts made from it. */
export const setDetails = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    aspect: v.optional(aspectValidator),
    source: v.optional(v.union(v.null(), v.string())),
    cuts: v.optional(v.array(cutValidator)),
  },
  handler: async (ctx, args) => {
    const { board } = await loadBoard(ctx, args.storyboardId);
    const source =
      args.source === undefined
        ? board.source
        : args.source?.trim().replace(/\s+/g, " ").slice(0, LIMITS.source) || undefined;
    await ctx.db.patch(board._id, {
      ...(args.aspect ? { aspect: args.aspect } : {}),
      ...(args.cuts ? { cuts: cleanCuts(args.cuts) } : {}),
      source,
      updatedAt: Date.now(),
    });
  },
});

/** Adds a cut to the end of the storyboard's list. */
export const addCut = mutation({
  args: { storyboardId: v.id("storyboards"), what: v.string(), where: v.string() },
  handler: async (ctx, args) => {
    const { board } = await loadBoard(ctx, args.storyboardId);
    const [cut] = cleanCuts([{ what: args.what, where: args.where }]);
    if (!cut) return fail("invalid_input", "Name the cut.");
    await ctx.db.patch(board._id, {
      cuts: cleanCuts([...board.cuts, cut]),
      updatedAt: Date.now(),
    });
  },
});

/** Takes the cut at a place in the list off it. */
export const removeCut = mutation({
  args: { storyboardId: v.id("storyboards"), index: v.number() },
  handler: async (ctx, args) => {
    const { board } = await loadBoard(ctx, args.storyboardId);
    await ctx.db.patch(board._id, {
      cuts: board.cuts.filter((_, at) => at !== args.index),
      updatedAt: Date.now(),
    });
  },
});

/** Deletes the storyboard with its chapters and takes. The project and its slots stay. */
export const remove = mutation({
  args: { storyboardId: v.id("storyboards") },
  handler: async (ctx, args) => {
    const board = await ctx.db.get(args.storyboardId);
    if (!board) return;
    await requireMember(ctx, board.organizationId, MANAGER_ROLES);
    await deleteBoard(ctx, board);
  },
});

export const addChapter = mutation({
  args: { storyboardId: v.id("storyboards"), title: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { board } = await loadBoard(ctx, args.storyboardId);
    const chapters = await chaptersOf(ctx, board._id);
    if (chapters.length >= LIMITS.chapters) {
      fail("limit", `A storyboard can have up to ${LIMITS.chapters} chapters.`);
    }
    const title = args.title?.trim()
      ? cleanText(args.title, LIMITS.title, "Give the chapter a name.")
      : `Chapter ${chapters.length + 1}`;
    await touch(ctx, board._id);
    return await ctx.db.insert("storyboardChapters", {
      storyboardId: board._id,
      organizationId: board.organizationId,
      title,
      order: (chapters.at(-1)?.order ?? -1) + 1,
    });
  },
});

export const renameChapter = mutation({
  args: { chapterId: v.id("storyboardChapters"), title: v.string() },
  handler: async (ctx, args) => {
    const chapter = await loadChapter(ctx, args.chapterId);
    await ctx.db.patch(chapter._id, {
      title: cleanText(args.title, LIMITS.title, "Give the chapter a name."),
    });
    await touch(ctx, chapter.storyboardId);
  },
});

/** Moves a chapter one place up or down. */
export const moveChapter = mutation({
  args: {
    chapterId: v.id("storyboardChapters"),
    direction: v.union(v.literal("up"), v.literal("down")),
  },
  handler: async (ctx, args) => {
    const chapter = await loadChapter(ctx, args.chapterId);
    const chapters = await chaptersOf(ctx, chapter.storyboardId);
    const at = chapters.findIndex((entry) => entry._id === chapter._id);
    const to = args.direction === "up" ? at - 1 : at + 1;
    if (to < 0 || to >= chapters.length) return;
    [chapters[at], chapters[to]] = [chapters[to], chapters[at]];
    for (const [index, entry] of chapters.entries()) {
      if (entry.order !== index) await ctx.db.patch(entry._id, { order: index });
    }
    await touch(ctx, chapter.storyboardId);
  },
});

/** Deletes a chapter and its takes. The last chapter stays, emptied, so there is a place to write. */
export const removeChapter = mutation({
  args: { chapterId: v.id("storyboardChapters") },
  handler: async (ctx, args) => {
    const chapter = await ctx.db.get(args.chapterId);
    if (!chapter) return;
    await requireMember(ctx, chapter.organizationId);
    const chapters = await chaptersOf(ctx, chapter.storyboardId);
    if (chapters.length <= 1) fail("last", "A storyboard keeps at least one chapter.");
    for (const take of await chapterTakes(ctx, chapter._id)) await ctx.db.delete(take._id);
    await ctx.db.delete(chapter._id);
    await touch(ctx, chapter.storyboardId);
  },
});

/** Adds a take to a chapter, after the one given or at the end. */
export const addTake = mutation({
  args: {
    chapterId: v.id("storyboardChapters"),
    line: v.string(),
    scene: v.optional(sceneValidator),
    parts: v.optional(v.array(takePartValidator)),
    afterTakeId: v.optional(v.id("storyboardTakes")),
  },
  handler: async (ctx, args) => {
    const chapter = await loadChapter(ctx, args.chapterId);
    const all = await takesOf(ctx, chapter.storyboardId);
    if (all.length >= LIMITS.takes)
      fail("limit", `A storyboard can have up to ${LIMITS.takes} takes.`);
    const line = cleanText(args.line, LIMITS.line, "Write the line for the take.");
    const parts = cleanParts(args.parts ?? ["you"]);
    const here = await chapterTakes(ctx, chapter._id);
    const at = args.afterTakeId
      ? here.findIndex((take) => take._id === args.afterTakeId) + 1
      : here.length;
    const takeId = await ctx.db.insert("storyboardTakes", {
      storyboardId: chapter.storyboardId,
      chapterId: chapter._id,
      organizationId: chapter.organizationId,
      order: at - 0.5,
      line,
      scene: args.scene ?? (parts.includes("you") ? "full" : "graphic"),
      parts,
      files: {},
    });
    await renumber(ctx, await chapterTakes(ctx, chapter._id));
    await touch(ctx, chapter.storyboardId);
    return takeId;
  },
});

/** Changes what a take says, the scene it is in, or the parts that go into it. */
export const updateTake = mutation({
  args: {
    takeId: v.id("storyboardTakes"),
    line: v.optional(v.string()),
    scene: v.optional(sceneValidator),
    parts: v.optional(v.array(takePartValidator)),
  },
  handler: async (ctx, args) => {
    const take = await loadTake(ctx, args.takeId);
    const parts = args.parts ? cleanParts(args.parts) : take.parts;
    // A part taken off drops its file too, so a status never counts a file nobody uses.
    const files = Object.fromEntries(
      Object.entries(take.files).filter(([part]) => parts.includes(part as Part)),
    );
    await ctx.db.patch(take._id, {
      ...(args.line !== undefined
        ? { line: cleanText(args.line, LIMITS.line, "Write the line for the take.") }
        : {}),
      ...(args.scene ? { scene: args.scene } : {}),
      parts,
      files,
    });
    await touch(ctx, take.storyboardId);
  },
});

/** Puts a file into one part of a take, or takes it out with null. */
export const setTakeFile = mutation({
  args: {
    takeId: v.id("storyboardTakes"),
    part: takePartValidator,
    url: v.union(v.null(), v.string()),
  },
  handler: async (ctx, args) => {
    const take = await loadTake(ctx, args.takeId);
    if (!take.parts.includes(args.part)) {
      fail("invalid_input", "This take does not use that part. Add it to the take first.");
    }
    const files = { ...take.files };
    if (args.url === null) delete files[args.part];
    else files[args.part] = cleanFile(args.url);
    await ctx.db.patch(take._id, { files });
    await touch(ctx, take.storyboardId);
  },
});

/** Moves a take one place up or down, into the chapter before or after at either end. */
export const moveTake = mutation({
  args: {
    takeId: v.id("storyboardTakes"),
    direction: v.union(v.literal("up"), v.literal("down")),
  },
  handler: async (ctx, args) => {
    const take = await loadTake(ctx, args.takeId);
    const here = await chapterTakes(ctx, take.chapterId);
    const at = here.findIndex((entry) => entry._id === take._id);
    const to = args.direction === "up" ? at - 1 : at + 1;
    if (to >= 0 && to < here.length) {
      [here[at], here[to]] = [here[to], here[at]];
      await renumber(ctx, here);
    } else {
      const chapters = await chaptersOf(ctx, take.storyboardId);
      const index = chapters.findIndex((chapter) => chapter._id === take.chapterId);
      const next = chapters[args.direction === "up" ? index - 1 : index + 1];
      if (!next) return;
      const there = await chapterTakes(ctx, next._id);
      await ctx.db.patch(take._id, {
        chapterId: next._id,
        order: args.direction === "up" ? there.length : -1,
      });
      await renumber(ctx, await chapterTakes(ctx, next._id));
      await renumber(ctx, await chapterTakes(ctx, take.chapterId));
    }
    await touch(ctx, take.storyboardId);
  },
});

export const removeTake = mutation({
  args: { takeId: v.id("storyboardTakes") },
  handler: async (ctx, args) => {
    const take = await ctx.db.get(args.takeId);
    if (!take) return;
    await requireMember(ctx, take.organizationId);
    await ctx.db.delete(take._id);
    await renumber(ctx, await chapterTakes(ctx, take.chapterId));
    await touch(ctx, take.storyboardId);
  },
});

// Drafts made from uploads ---------------------------------------------------------------

/** The words said in an upload, from its transcript. Older transcripts kept no word
 *  timings, so their pieces' words are spread evenly over each piece. */
async function spokenIn(ctx: QueryCtx, itemId: Id<"libraryItems">): Promise<Word[]> {
  const pieces = await ctx.db
    .query("transcriptPieces")
    .withIndex("by_item_and_start", (q) => q.eq("itemId", itemId))
    .take(4000);
  const words: Word[] = [];
  for (const piece of pieces) {
    if (piece.words && piece.words.length > 0) {
      for (const word of piece.words) words.push({ text: word.t, start: word.s, end: word.e });
      continue;
    }
    const said = piece.text.split(/\s+/).filter(Boolean);
    const each = Math.max(0, piece.end - piece.start) / Math.max(1, said.length);
    said.forEach((text, index) =>
      words.push({
        text,
        start: piece.start + index * each,
        end: piece.start + (index + 1) * each,
      }),
    );
  }
  return words;
}

function aspectOf(item: Doc<"libraryItems">): (typeof ASPECTS)[number] {
  const width = item.details?.width;
  const height = item.details?.height;
  if (!width || !height) return "16:9";
  const ratio = width / height;
  if (ratio < 0.7) return "9:16";
  if (ratio < 0.9) return "4:5";
  if (ratio < 1.2) return "1:1";
  return "16:9";
}

/** The clip of an upload from `start` to `end`: a pointer to the upload, or its link. */
function clipOf(item: Doc<"libraryItems">, start: number, end: number): string | null {
  if (item.uploadId) return clipRef(item.uploadId, start, end);
  if (item.url && /^https?:\/\/\S+$/.test(item.url) && !timeRangeOf(item.url)) {
    const round = (value: number) => Math.round(value * 1000) / 1000;
    return `${item.url}#t=${round(start)},${round(end)}`;
  }
  return null;
}

const draftable = (item: Doc<"libraryItems">) =>
  item.source === "upload" &&
  (item.kind === "video" || item.kind === "audio") &&
  item.transcript?.status === "ready";

/** Writes an upload's draft: a line for every sentence, each with its clip, Full Screen. */
async function writeDraft(ctx: MutationCtx, item: Doc<"libraryItems">) {
  const draft = draftStoryboard(await spokenIn(ctx, item._id), item.details?.duration);
  if (draft.chapters.length === 0) return null;
  const storyboardId = await ctx.db.insert("storyboards", {
    organizationId: item.organizationId,
    libraryItemId: item._id,
    aspect: aspectOf(item),
    source: `Drafted from ${item.title}`.slice(0, LIMITS.source),
    cuts: [],
    updatedAt: Date.now(),
  });
  for (const [order, chapter] of draft.chapters.entries()) {
    const chapterId = await ctx.db.insert("storyboardChapters", {
      storyboardId,
      organizationId: item.organizationId,
      title: chapter.title,
      order,
    });
    for (const [index, take] of chapter.takes.entries()) {
      const clip = clipOf(item, take.start, take.end);
      await ctx.db.insert("storyboardTakes", {
        storyboardId,
        chapterId,
        organizationId: item.organizationId,
        order: index,
        line: take.line,
        scene: "full",
        parts: ["you"],
        files: clip ? { you: clip } : {},
      });
    }
  }
  return storyboardId;
}

/**
 * Drafts the storyboard of an upload once its transcript is in. An upload that has a
 * draft already keeps it, so nothing the team changed in it is lost.
 */
export const draftForUpload = internalMutation({
  args: { itemId: v.id("libraryItems") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item || !draftable(item)) return null;
    if (await draftOf(ctx, item._id)) return null;
    return await writeDraft(ctx, item);
  },
});

/** Drafts the upload's storyboard again from its transcript, in place of the one there. */
export const draftAgain = mutation({
  args: { libraryItemId: v.id("libraryItems") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.libraryItemId);
    if (!item) return fail("not_found", "That file is gone.");
    await requireMember(ctx, item.organizationId);
    if (!draftable(item)) fail("not_ready", "The file needs its transcript first.");
    const before = await draftOf(ctx, item._id);
    if (before) await deleteBoard(ctx, before);
    const storyboardId = await writeDraft(ctx, item);
    if (!storyboardId) fail("empty", "Nothing is said in this file, so there are no lines.");
    return storyboardId;
  },
});

const DRAFT_CATCH_UP = 50;

/**
 * Drafts a storyboard for each upload with a transcript and no draft yet, such as ones
 * transcribed before every upload got one. Safe to call on every visit.
 */
export const catchUpDrafts = mutation({
  args: { organizationId: v.string() },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    await requireMember(ctx, args.organizationId);
    const boards = await ctx.db
      .query("storyboards")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(2000);
    const drafted = new Set(boards.map((board) => board.libraryItemId).filter(Boolean));
    const items = await ctx.db
      .query("libraryItems")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(500);
    const waiting = items
      .filter((item) => draftable(item) && !drafted.has(item._id))
      .slice(0, DRAFT_CATCH_UP);
    for (const item of waiting) {
      await backgroundPool.enqueueMutation(ctx, internal.storyboards.draftForUpload, {
        itemId: item._id,
      });
    }
    return waiting.length;
  },
});

/** The team's uploads that have a drafted storyboard, newest first, to gather into a project. */
export const uploadDrafts = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    if (!(await isMember(ctx, args.organizationId))) return [];
    const boards = await ctx.db
      .query("storyboards")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(2000);
    const drafts = [];
    for (const board of boards) {
      if (!board.libraryItemId) continue;
      const item = await ctx.db.get(board.libraryItemId);
      if (!item) continue;
      drafts.push({
        storyboardId: board._id,
        libraryItemId: item._id,
        shortId: item.shortId,
        title: item.title,
        duration: item.details?.duration ?? null,
      });
      if (drafts.length >= 200) break;
    }
    return drafts;
  },
});

/**
 * Adds an upload's drafted chapters to the end of a project's storyboard, with their lines,
 * scenes and clips, starting the storyboard when the project has none yet. The upload's
 * draft stays as it is.
 */
export const gatherUploadDraft = mutation({
  args: { projectId: v.id("projects"), libraryItemId: v.id("libraryItems") },
  returns: v.object({ chapters: v.number(), takes: v.number() }),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return fail("not_found", "That project is gone.");
    await requireMember(ctx, project.organizationId);
    const item = await ctx.db.get(args.libraryItemId);
    if (!item || item.organizationId !== project.organizationId) {
      return fail("not_found", "That upload is gone.");
    }
    const draft = await draftOf(ctx, item._id);
    if (!draft) return fail("not_ready", "That upload has no storyboard draft yet.");
    const fromChapters = await chaptersOf(ctx, draft._id);
    const fromTakes = await takesOf(ctx, draft._id);

    let board = await boardOf(ctx, project._id);
    if (!board) {
      const storyboardId = await ctx.db.insert("storyboards", {
        organizationId: project.organizationId,
        projectId: project._id,
        aspect: draft.aspect,
        source: `Gathered from ${item.title}`.slice(0, LIMITS.source),
        cuts: [],
        updatedAt: Date.now(),
      });
      board = (await ctx.db.get(storyboardId))!;
    }
    const chapters = await chaptersOf(ctx, board._id);
    const takes = await takesOf(ctx, board._id);
    // A storyboard just started has one empty chapter to write in; the draft takes its place.
    const empty = chapters.filter(
      (chapter) => !takes.some((take) => take.chapterId === chapter._id),
    );
    const keptChapters = chapters.length - (takes.length === 0 ? empty.length : 0);
    if (keptChapters + fromChapters.length > LIMITS.chapters) {
      fail("limit", `A storyboard can have up to ${LIMITS.chapters} chapters.`);
    }
    if (takes.length + fromTakes.length > LIMITS.takes) {
      fail("limit", `A storyboard can have up to ${LIMITS.takes} takes.`);
    }
    if (takes.length === 0) for (const chapter of empty) await ctx.db.delete(chapter._id);
    let order = takes.length === 0 ? 0 : (chapters.at(-1)?.order ?? -1) + 1;
    for (const chapter of fromChapters) {
      const chapterId = await ctx.db.insert("storyboardChapters", {
        storyboardId: board._id,
        organizationId: board.organizationId,
        title: chapter.title,
        order: order++,
      });
      for (const take of fromTakes.filter((one) => one.chapterId === chapter._id)) {
        await ctx.db.insert("storyboardTakes", {
          storyboardId: board._id,
          chapterId,
          organizationId: board.organizationId,
          order: take.order,
          line: take.line,
          scene: take.scene,
          parts: take.parts,
          files: take.files,
        });
      }
    }
    await touch(ctx, board._id);
    await ctx.db.patch(project._id, { updatedAt: Date.now() });
    return { chapters: fromChapters.length, takes: fromTakes.length };
  },
});

// Suggest scenes ----------------------------------------------------------------------------

const SCENES_TIMEOUT_MS = 120_000;

/** What the model is asked about a storyboard: its chapters and numbered lines. */
export const sceneQuestion = internalQuery({
  args: { storyboardId: v.id("storyboards") },
  handler: async (ctx, args) => {
    const board = await ctx.db.get(args.storyboardId);
    if (!board) return null;
    const { userId } = await requireMember(ctx, board.organizationId);
    const chapters = await chaptersOf(ctx, board._id);
    const takes = await takesOf(ctx, board._id);
    let number = 0;
    return {
      organizationId: board.organizationId,
      userId,
      name: board.source ?? "A talking video",
      aspect: board.aspect,
      chapters: chapters.map((chapter) => ({
        _id: chapter._id,
        title: chapter.title,
        lines: takes
          .filter((take) => take.chapterId === chapter._id)
          .map((take) => ({ n: ++number, takeId: take._id, line: take.line.slice(0, 600) })),
      })),
    };
  },
});

/** Puts the suggested scenes and chapter names into the storyboard. */
export const applyScenes = internalMutation({
  args: {
    storyboardId: v.id("storyboards"),
    scenes: v.array(v.object({ takeId: v.id("storyboardTakes"), scene: sceneValidator })),
    titles: v.array(v.object({ chapterId: v.id("storyboardChapters"), title: v.string() })),
  },
  handler: async (ctx, args) => {
    const { board } = await loadBoard(ctx, args.storyboardId);
    let scenes = 0;
    for (const { takeId, scene } of args.scenes) {
      const take = await ctx.db.get(takeId);
      if (!take || take.storyboardId !== board._id || take.scene === scene) continue;
      await ctx.db.patch(take._id, { scene, parts: partsForScene(scene, take.parts) });
      scenes += 1;
    }
    let titles = 0;
    for (const { chapterId, title } of args.titles) {
      const chapter = await ctx.db.get(chapterId);
      if (!chapter || chapter.storyboardId !== board._id || chapter.title === title) continue;
      await ctx.db.patch(chapter._id, { title });
      titles += 1;
    }
    await touch(ctx, board._id);
    return { scenes, titles };
  },
});

/**
 * Asks the model, once, how each line is best shown and what each chapter is called, and
 * puts its answer into the storyboard. Only when someone presses "Suggest scenes".
 */
export const suggestScenes = action({
  args: { storyboardId: v.id("storyboards") },
  returns: v.object({ scenes: v.number(), titles: v.number() }),
  handler: async (ctx, args): Promise<{ scenes: number; titles: number }> => {
    const question = await ctx.runQuery(internal.storyboards.sceneQuestion, args);
    if (!question) return fail("not_found", "That storyboard is gone.");
    const lines = question.chapters.flatMap((chapter) => chapter.lines);
    if (lines.length === 0) return fail("empty", "Add a line first, so there is a scene to pick.");
    const url = process.env.AGENT_URL;
    const secret = process.env.MASTRA_JWT_SECRET;
    if (!url || !secret) {
      return fail(
        "not_set_up",
        "The agent is not set up on this dashboard yet, and it is what suggests scenes. Whoever runs the dashboard sets AGENT_URL and MASTRA_JWT_SECRET for Convex.",
      );
    }
    let answer: string | null = null;
    try {
      const response = await fetch(new URL("/ncat/scenes", url), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${await signAgentToken(secret, question.userId)}`,
        },
        body: JSON.stringify({
          organizationId: question.organizationId,
          name: question.name,
          aspect: question.aspect,
          chapters: question.chapters.map((chapter) => ({
            title: chapter.title,
            lines: chapter.lines.map(({ n, line }) => ({ n, line })),
          })),
        }),
        signal: AbortSignal.timeout(SCENES_TIMEOUT_MS),
      });
      const result = (await response.json().catch(() => null)) as { answer?: unknown } | null;
      if (response.ok && typeof result?.answer === "string") answer = result.answer;
    } catch {
      return fail("unreachable", "The agent could not be reached. Try again in a moment.");
    }
    if (!answer) return fail("no_answer", "The agent did not answer. Try again in a moment.");
    const read = readSceneAnswer(answer, question.chapters.length, lines.length);
    return await ctx.runMutation(internal.storyboards.applyScenes, {
      storyboardId: args.storyboardId,
      scenes: lines.flatMap(({ n, takeId }) => {
        const scene = read.scenes.get(n);
        return scene ? [{ takeId, scene }] : [];
      }),
      titles: question.chapters.flatMap((chapter, index) => {
        const title = read.titles.get(index);
        return title ? [{ chapterId: chapter._id, title }] : [];
      }),
    });
  },
});
