import { readUploadRef } from "@ncat-dash/automation-core";
import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { isMember, MANAGER_ROLES, requireMember } from "./lib/authz";
import {
  aboutLength,
  ASPECTS,
  cleanParts,
  LIMITS,
  type Part,
  PARTS,
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

/** A file for a take: a web address, or a pointer to one of the team's uploads. */
function cleanFile(url: string): string {
  const trimmed = url.trim();
  if (readUploadRef(trimmed) || /^https?:\/\/\S+$/.test(trimmed)) return trimmed;
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
 * A project's storyboard with its chapters, their takes numbered through the whole video,
 * and where each take stands. Null when the project has none yet.
 */
export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || !(await isMember(ctx, project.organizationId))) return null;
    const { role } = await requireMember(ctx, project.organizationId);
    const board = await boardOf(ctx, project._id);
    if (!board) return null;
    const chapters = await chaptersOf(ctx, board._id);
    const takes = await takesOf(ctx, board._id);
    let number = 0;
    const totals = Object.fromEntries(
      PARTS.map(({ part }) => [part, { done: 0, all: 0 }]),
    ) as Record<Part, { done: number; all: number }>;
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
      projectId: project._id,
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
    await clearBoard(ctx, board._id);
    await ctx.db.delete(board._id);
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
