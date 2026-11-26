import { freeName, keyOfUrl, nameProblem } from "@takewon/automation-core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { isMember, memberOrCaller, type TeamCaller } from "./lib/authz";
import { bucketOf, copyObject, listObjects } from "./lib/bucket";
import { addLibraryItem } from "./lib/library";
import { brandOf, enqueueJob } from "./lib/queue";
import type { Part, Scene, TakeFiles } from "./lib/storyboard";
import { sceneRequest } from "./lib/storyboardRender";
import { planTake } from "./lib/storyboardVideos";

/**
 * Making a storyboard into one finished video. Each take is made in its scene by its own
 * job, so the team's limit on jobs at once, and the fair share of a shared toolkit, apply to
 * it like any other work; the takes are then joined in order, and the video is kept in
 * Files under Finished/Storyboard/.
 */

const fail = (code: string, message: string): never => {
  throw new ConvexError({ code, message });
};

/** Where the finished videos are kept in the team's folder. */
const FOLDER = "Finished/Storyboard/";
/** How many of a storyboard's videos are listed with it. */
const SHOWN = 5;

/** Starts making the storyboard, or one chapter of it, into a video. */
const started = v.object({
  videoId: v.id("storyboardVideos"),
  takes: v.number(),
  skipped: v.array(v.number()),
  plain: v.array(v.number()),
});

async function startVideo(
  ctx: MutationCtx,
  args: { storyboardId: Id<"storyboards"> | null; chapterId?: Id<"storyboardChapters"> | null },
  as?: TeamCaller,
) {
  const board = args.storyboardId ? await ctx.db.get(args.storyboardId) : null;
  if (!board) return fail("not_found", "That storyboard is gone.");
  const { userId } = await memberOrCaller(ctx, board.organizationId, as);
  const working = await ctx.db
    .query("storyboardVideos")
    .withIndex("by_storyboard", (q) => q.eq("storyboardId", board._id))
    .order("desc")
    .take(SHOWN);
  if (working.some((video) => video.status === "working")) {
    fail("busy", "A video of this storyboard is being made. Wait for it to finish first.");
  }
  const chapters = (
    await ctx.db
      .query("storyboardChapters")
      .withIndex("by_storyboard", (q) => q.eq("storyboardId", board._id))
      .collect()
  ).sort((a, b) => a.order - b.order);
  const chapter = args.chapterId ? chapters.find((one) => one._id === args.chapterId) : null;
  if (args.chapterId !== undefined && !chapter) fail("not_found", "That chapter is gone.");
  const takes = (
    await ctx.db
      .query("storyboardTakes")
      .withIndex("by_storyboard", (q) => q.eq("storyboardId", board._id))
      .collect()
  ).sort((a, b) => a.order - b.order);

  // Takes are numbered through the whole storyboard, as on the page.
  const ordered: { take: Doc<"storyboardTakes">; number: number }[] = [];
  let number = 0;
  for (const each of chapters) {
    for (const take of takes.filter((one) => one.chapterId === each._id)) {
      number += 1;
      if (!chapter || chapter._id === each._id) ordered.push({ take, number });
    }
  }
  if (ordered.length === 0) fail("empty", "Add a take first, so there is something to make.");

  const accent = (await brandOf(ctx, board.organizationId)).color;
  const planned = [];
  for (const { take, number: n } of ordered) {
    planned.push(
      await planTake(
        ctx,
        board.organizationId,
        {
          line: take.line,
          scene: take.scene as Scene,
          parts: take.parts as Part[],
          files: take.files as TakeFiles,
        },
        n,
        accent,
      ),
    );
  }
  const made = planned.flatMap((one) => ("segment" in one ? [one] : []));
  const skipped = planned.flatMap((one) => ("skipped" in one ? [one.number] : []));
  if (made.length === 0) {
    fail(
      "empty",
      chapter
        ? "None of this chapter's takes has its file in yet, so there is nothing to make."
        : "None of the takes has its file in yet, so there is nothing to make.",
    );
  }

  const project = board.projectId ? await ctx.db.get(board.projectId) : null;
  const item = board.libraryItemId ? await ctx.db.get(board.libraryItemId) : null;
  const name = project?.name ?? item?.title ?? "Storyboard";
  const title = (chapter ? `${name}, ${chapter.title}` : name).slice(0, 160);
  const videoId = await ctx.db.insert("storyboardVideos", {
    organizationId: board.organizationId,
    storyboardId: board._id,
    ...(chapter ? { chapterId: chapter._id } : {}),
    title,
    aspect: board.aspect,
    status: "working",
    takes: [],
    skipped,
    plain: made.filter((one) => one.plain).map((one) => one.number),
    startedBy: userId,
  });
  const jobs: { number: number; jobId: Id<"jobs"> }[] = [];
  for (const one of made) {
    const queued = await enqueueJob(ctx, {
      organizationId: board.organizationId,
      stepId: "ffmpeg-compose",
      input: sceneRequest(one.segment, board.aspect),
      createdBy: userId,
    });
    if (!queued.ok) return fail(queued.code, queued.message);
    await ctx.db.patch(queued.jobId, { storyboardVideoId: videoId });
    jobs.push({ number: one.number, jobId: queued.jobId });
  }
  await ctx.db.patch(videoId, { takes: jobs });
  await ctx.scheduler.runAfter(0, internal.jobs.pumpTeam, {
    organizationId: board.organizationId,
  });
  return {
    videoId,
    takes: jobs.length,
    skipped,
    plain: made.filter((one) => one.plain).map((one) => one.number),
  };
}

export const start = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    chapterId: v.optional(v.id("storyboardChapters")),
  },
  returns: started,
  handler: (ctx, args) => startVideo(ctx, args),
});

/** `start` for an MCP client, as the person it signed in as. */
export const startAs = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    storyboardId: v.string(),
    chapterId: v.optional(v.string()),
  },
  returns: started,
  handler: (ctx, { organizationId, userId, storyboardId, chapterId }) =>
    startVideo(
      ctx,
      {
        storyboardId: ctx.db.normalizeId("storyboards", storyboardId),
        ...(chapterId ? { chapterId: ctx.db.normalizeId("storyboardChapters", chapterId) } : {}),
      },
      { organizationId, userId },
    ),
});

/** A storyboard's latest videos, newest first, with how far along each one is. */
export const list = query({
  args: { storyboardId: v.id("storyboards") },
  handler: async (ctx, args) => {
    const board = await ctx.db.get(args.storyboardId);
    if (!board || !(await isMember(ctx, board.organizationId))) return [];
    const videos = await ctx.db
      .query("storyboardVideos")
      .withIndex("by_storyboard", (q) => q.eq("storyboardId", board._id))
      .order("desc")
      .take(SHOWN);
    const shown = [];
    for (const video of videos) {
      let made = 0;
      if (video.status === "working") {
        for (const take of video.takes) {
          if ((await ctx.db.get(take.jobId))?.status === "done") made += 1;
        }
      }
      const item = video.libraryItemId ? await ctx.db.get(video.libraryItemId) : null;
      shown.push({
        _id: video._id,
        _creationTime: video._creationTime,
        title: video.title,
        chapterId: video.chapterId ?? null,
        aspect: video.aspect,
        status: video.status,
        total: video.takes.length,
        made: video.status === "working" ? made : video.takes.length,
        joining: video.status === "working" && !!video.joinJobId,
        skipped: video.skipped,
        plain: video.plain,
        error: video.error ?? null,
        file: item ? { _id: item._id, shortId: item.shortId, title: item.title } : null,
        finishedAt: video.finishedAt ?? null,
      });
    }
    return shown;
  },
});

/** What `keep` needs: the video, and where the team keeps its files. */
export const toKeep = internalQuery({
  args: { videoId: v.id("storyboardVideos") },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video || video.status !== "working" || !video.url) return null;
    const connections = await ctx.db
      .query("toolkitConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", video.organizationId))
      .take(50);
    const connection = connections.find((one) => one.status === "ok") ?? connections[0] ?? null;
    return { video, connection };
  },
});

/**
 * Copies the finished video into the team's folder, under Finished/Storyboard/, so it shows
 * in Files with a readable name. Left where it was made when it cannot be copied; it is
 * still added to Files by its link.
 */
export const keep = internalAction({
  args: { videoId: v.id("storyboardVideos") },
  handler: async (ctx, args) => {
    const found = await ctx.runQuery(internal.storyboardVideos.toKeep, args);
    if (!found) return;
    const { video, connection } = found;
    let key: string | null = null;
    if (connection?.storage?.endpoint) {
      try {
        const config = await bucketOf(connection);
        const address = {
          endpoint: connection.storage.endpoint,
          bucket: connection.storage.bucket,
          ...(connection.storage.publicUrl ? { publicUrl: connection.storage.publicUrl } : {}),
        };
        const from = keyOfUrl(address, video.url!);
        if (from !== null && !from.startsWith("teams/")) {
          const taken = new Set(
            (await listObjects(config, FOLDER, 1)).map((one) => one.key.slice(FOLDER.length)),
          );
          const plain = video.title.replace(/[/\\]/g, "-");
          const name = freeName(`${nameProblem(plain) ? "Storyboard" : plain}.mp4`, (candidate) =>
            taken.has(candidate),
          );
          await copyObject({ ...config, root: "" }, from, `${config.root}${FOLDER}${name}`);
          key = `${FOLDER}${name}`;
        } else if (from !== null && from.startsWith(config.root)) {
          key = from.slice(config.root.length);
        }
      } catch {
        key = null;
      }
    }
    await ctx.runMutation(internal.storyboardVideos.finish, {
      videoId: video._id,
      ...(key ? { key } : {}),
    });
  },
});

/** Adds the finished video to Files and marks it made. */
export const finish = internalMutation({
  args: { videoId: v.id("storyboardVideos"), key: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video || video.status !== "working" || !video.url) return;
    const board = await ctx.db.get(video.storyboardId);
    const project = board?.projectId ? await ctx.db.get(board.projectId) : null;
    const libraryItemId = await addLibraryItem(ctx, {
      organizationId: video.organizationId,
      kind: "video",
      source: "automation",
      title: video.title,
      ...(args.key ? { key: args.key } : { url: video.url }),
      automationName: "Storyboard",
      ...(board?.libraryItemId ? { parentId: board.libraryItemId } : {}),
      ...(project?.clientId ? { clientId: project.clientId } : {}),
      createdBy: null,
    });
    await ctx.db.patch(video._id, { status: "done", libraryItemId, finishedAt: Date.now() });
  },
});
