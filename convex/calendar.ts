import {
  fillQueue,
  isCalendarPlatform,
  QUEUE_WEEKS,
  scheduleTimes,
  slotProblem,
  slotTimes,
} from "@ncat-dash/automation-core";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { requireMember } from "./lib/authz";

// The content calendar: posts planned for a day and time, repeating slots that queued
// posts fill, project slots that are due, and the times scheduled automations run.
// Nothing is posted from here yet; a post's time is the plan.

const DAY = 24 * 60 * 60_000;
/** The longest stretch one read covers: a month view with its leading and trailing days. */
const LONGEST_RANGE = 45 * DAY;
const TITLE_LIMIT = 140;
const MAX_POSTS = 2000;
const MAX_SLOTS = 100;
const LISTED = 200;

const fail = (code: string, message: string): never => {
  throw new ConvexError({ code, message });
};

function cleanTitle(title: string): string {
  const trimmed = title.trim().replace(/\s+/g, " ");
  if (!trimmed) fail("invalid_input", "Give the post a title.");
  if (trimmed.length > TITLE_LIMIT)
    fail("invalid_input", `Keep the title to ${TITLE_LIMIT} letters.`);
  return trimmed;
}

function checkPlatform(platform: string) {
  if (!isCalendarPlatform(platform)) fail("invalid_input", "Pick where it is posted.");
}

async function clientOf(ctx: QueryCtx, organizationId: string, clientId?: Id<"clients"> | null) {
  if (!clientId) return null;
  const client = await ctx.db.get(clientId);
  return client && client.organizationId === organizationId ? client : null;
}

async function requireClient(ctx: QueryCtx, organizationId: string, clientId?: Id<"clients">) {
  if (!clientId) return undefined;
  const client = await clientOf(ctx, organizationId, clientId);
  if (!client) fail("not_found", "That client is gone.");
  return clientId;
}

async function loadPost(ctx: MutationCtx, postId: Id<"calendarPosts">) {
  const post = await ctx.db.get(postId);
  if (!post) return fail("not_found", "That post is gone.");
  const { userId } = await requireMember(ctx, post.organizationId);
  return { post, userId };
}

async function slotsOf(ctx: QueryCtx, organizationId: string) {
  return await ctx.db
    .query("calendarSlots")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(MAX_SLOTS);
}

/** Posts planned between `from` and `to`. */
async function postsBetween(ctx: QueryCtx, organizationId: string, from: number, to: number) {
  return await ctx.db
    .query("calendarPosts")
    .withIndex("by_organization_and_at", (q) =>
      q.eq("organizationId", organizationId).gte("at", from).lt("at", to),
    )
    .take(MAX_POSTS);
}

/**
 * Gives each queued post the next free time of a slot for its platform. Returns how many
 * were placed. A slot time is taken when a post it placed is still there.
 */
async function fillSlots(ctx: MutationCtx, organizationId: string): Promise<number> {
  const slots = await slotsOf(ctx, organizationId);
  if (slots.length === 0) return 0;
  const queued = (
    await ctx.db
      .query("calendarPosts")
      .withIndex("by_organization_and_at", (q) =>
        q.eq("organizationId", organizationId).eq("at", null),
      )
      .take(MAX_POSTS)
  )
    .filter((post) => post.queued)
    .sort((a, b) => a.queuedAt - b.queuedAt);
  if (queued.length === 0) return 0;
  const now = Date.now();
  const ahead = await postsBetween(ctx, organizationId, now, now + (QUEUE_WEEKS * 7 + 1) * DAY);
  const taken = ahead.flatMap((post) =>
    post.slotId && post.at !== null ? [{ slotId: post.slotId as string, at: post.at }] : [],
  );
  const placed = fillQueue(
    queued.map((post) => ({ id: post._id, platform: post.platform, clientId: post.clientId })),
    slots.map((slot) => ({ ...slot, id: slot._id, clientId: slot.clientId })),
    taken,
    now,
  );
  for (const { id, slotId, at } of placed) {
    await ctx.db.patch(id as Id<"calendarPosts">, {
      at,
      slotId: slotId as Id<"calendarSlots">,
      queued: false,
      updatedAt: now,
    });
  }
  return placed.length;
}

async function fileOf(ctx: QueryCtx, organizationId: string, itemId?: Id<"libraryItems">) {
  if (!itemId) return null;
  const item = await ctx.db.get(itemId);
  if (!item || item.organizationId !== organizationId) return null;
  return { _id: item._id, shortId: item.shortId, title: item.title, kind: item.kind };
}

async function shownPost(ctx: QueryCtx, post: Doc<"calendarPosts">) {
  const client = await clientOf(ctx, post.organizationId, post.clientId);
  return {
    _id: post._id,
    title: post.title,
    platform: post.platform,
    at: post.at,
    queued: post.queued,
    status: post.status,
    fromSlot: post.slotId !== undefined,
    file: await fileOf(ctx, post.organizationId, post.libraryItemId),
    client: client ? { _id: client._id, name: client.name } : null,
  };
}

/** Project slots with a due date between `from` and `to`, with their project. */
async function dueBetween(
  ctx: QueryCtx,
  organizationId: string,
  from: number,
  to: number,
  clientId?: Id<"clients">,
) {
  const slots = await ctx.db
    .query("deliverables")
    .withIndex("by_organization_and_dueAt", (q) =>
      q.eq("organizationId", organizationId).gte("dueAt", from).lt("dueAt", to),
    )
    .take(MAX_POSTS);
  return await shownDeliverables(ctx, slots, clientId);
}

async function shownDeliverables(
  ctx: QueryCtx,
  slots: Doc<"deliverables">[],
  clientId?: Id<"clients">,
) {
  const projects = new Map<Id<"projects">, Doc<"projects"> | null>();
  const rows = [];
  for (const slot of slots) {
    if (!projects.has(slot.projectId))
      projects.set(slot.projectId, await ctx.db.get(slot.projectId));
    const project = projects.get(slot.projectId);
    if (!project) continue;
    if (clientId && project.clientId !== clientId) continue;
    rows.push({
      _id: slot._id,
      label: slot.label,
      kind: slot.kind,
      status: slot.status,
      dueAt: slot.dueAt ?? null,
      project: { _id: project._id, name: project.name },
    });
  }
  return rows;
}

/**
 * Everything on the calendar between `from` and `to`: planned posts, project slots due,
 * free times of the repeating slots, and when scheduled automations run. With a client,
 * only what is for that client (and slots kept for anyone).
 */
export const range = query({
  args: {
    organizationId: v.string(),
    from: v.number(),
    to: v.number(),
    clientId: v.optional(v.id("clients")),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    if (args.to <= args.from || args.to - args.from > LONGEST_RANGE) {
      fail("invalid_input", "Show at most six weeks at a time.");
    }
    const now = Date.now();
    const forClient = <T extends { clientId?: Id<"clients"> }>(row: T) =>
      !args.clientId || row.clientId === args.clientId;

    const postRows = (await postsBetween(ctx, args.organizationId, args.from, args.to)).filter(
      forClient,
    );
    const posts = await Promise.all(postRows.map((post) => shownPost(ctx, post)));

    const due = await dueBetween(ctx, args.organizationId, args.from, args.to, args.clientId);

    // Free times of the repeating slots, from now on.
    const taken = new Set(
      postRows.flatMap((post) => (post.slotId ? [`${post.slotId}@${post.at}`] : [])),
    );
    const openSlots = [];
    for (const slot of await slotsOf(ctx, args.organizationId)) {
      if (args.clientId && slot.clientId && slot.clientId !== args.clientId) continue;
      for (const at of slotTimes(slot, Math.max(args.from, now), args.to)) {
        if (taken.has(`${slot._id}@${at}`)) continue;
        openSlots.push({ slotId: slot._id, platform: slot.platform, at });
      }
    }

    // When the team's switched-on scheduled automations run, from now on.
    const automations = (
      await ctx.db
        .query("automations")
        .withIndex("by_enabled_and_trigger_kind", (q) =>
          q.eq("enabled", true).eq("trigger.kind", "schedule"),
        )
        .take(1000)
    ).filter(
      (automation) => automation.organizationId === args.organizationId && forClient(automation),
    );
    const runs: { automationId: Id<"automations">; name: string; at: number }[] = [];
    const repeating: { automationId: Id<"automations">; name: string; minutes: number }[] = [];
    for (const automation of automations) {
      if (automation.trigger.kind !== "schedule") continue;
      const schedule = automation.trigger.schedule;
      const { times, perDay } = scheduleTimes(
        schedule,
        Math.max(args.from, now),
        args.to,
        automation.nextRunAt,
      );
      if (perDay && schedule.mode === "interval") {
        repeating.push({
          automationId: automation._id,
          name: automation.name,
          minutes: schedule.minutes,
        });
      }
      for (const at of times)
        runs.push({ automationId: automation._id, name: automation.name, at });
    }

    return {
      posts: posts.sort((a, b) => (a.at ?? 0) - (b.at ?? 0)),
      due,
      openSlots: openSlots.sort((a, b) => a.at - b.at),
      runs: runs.sort((a, b) => a.at - b.at),
      repeating,
    };
  },
});

/**
 * What waits in the calendar's side list: posts with no time, the queued ones first in
 * queue order, and project slots with no due date that are not published yet.
 */
export const waiting = query({
  args: { organizationId: v.string(), clientId: v.optional(v.id("clients")) },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const rows = (
      await ctx.db
        .query("calendarPosts")
        .withIndex("by_organization_and_at", (q) =>
          q.eq("organizationId", args.organizationId).eq("at", null),
        )
        .take(LISTED)
    ).filter((post) => !args.clientId || post.clientId === args.clientId);
    rows.sort((a, b) => Number(b.queued) - Number(a.queued) || a.queuedAt - b.queuedAt);
    const posts = await Promise.all(rows.map((post) => shownPost(ctx, post)));

    const open = (
      await ctx.db
        .query("deliverables")
        .withIndex("by_organization_and_dueAt", (q) =>
          q.eq("organizationId", args.organizationId).eq("dueAt", undefined),
        )
        .take(LISTED * 2)
    ).filter((slot) => slot.status !== "published");
    const deliverables = (await shownDeliverables(ctx, open, args.clientId)).slice(0, LISTED);
    return { posts, deliverables };
  },
});

/** The team's repeating slots, by day of the week and time. */
export const slots = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const rows = await slotsOf(ctx, args.organizationId);
    const shown = await Promise.all(
      rows.map(async (slot) => {
        const client = await clientOf(ctx, slot.organizationId, slot.clientId);
        return {
          _id: slot._id,
          weekday: slot.weekday,
          time: slot.time,
          timeZone: slot.timeZone,
          platform: slot.platform,
          client: client ? { _id: client._id, name: client.name } : null,
        };
      }),
    );
    return shown.sort((a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time));
  },
});

/**
 * Plans a post. With `at` it goes on that time; with `queue` it waits for the next free
 * slot for its platform; with neither it waits in the side list. `file` is a library
 * short ID such as "C12"; the post takes the file's title and client unless given.
 */
export const addPost = mutation({
  args: {
    organizationId: v.string(),
    title: v.string(),
    platform: v.string(),
    at: v.optional(v.union(v.number(), v.null())),
    queue: v.optional(v.boolean()),
    file: v.optional(v.string()),
    clientId: v.optional(v.id("clients")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    checkPlatform(args.platform);
    let item: Doc<"libraryItems"> | null = null;
    const shortId = args.file?.trim().toUpperCase();
    if (shortId) {
      item = await ctx.db
        .query("libraryItems")
        .withIndex("by_organization_and_shortId", (q) =>
          q.eq("organizationId", args.organizationId).eq("shortId", shortId),
        )
        .unique();
      if (!item) fail("not_found", `There is no ${shortId} in the library.`);
    }
    const postId = await insertPost(ctx, userId, args, item);
    if ((args.at ?? null) === null && args.queue) await fillSlots(ctx, args.organizationId);
    return postId;
  },
});

/** The most files one Add Post makes posts for at once. */
const MAX_FILES_AT_ONCE = 25;

/**
 * Plans one post for each file picked from the library, in the order picked, all for the
 * same place and time. Each post takes its file's name unless a title is given, and its
 * file's client unless a client is given. Queued ones take the next free slots in turn.
 */
export const addPosts = mutation({
  args: {
    organizationId: v.string(),
    title: v.optional(v.string()),
    platform: v.string(),
    at: v.optional(v.union(v.number(), v.null())),
    queue: v.optional(v.boolean()),
    itemIds: v.array(v.id("libraryItems")),
    clientId: v.optional(v.id("clients")),
  },
  returns: v.array(v.id("calendarPosts")),
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    checkPlatform(args.platform);
    const itemIds = [...new Set(args.itemIds)];
    if (itemIds.length === 0) fail("invalid", "Pick at least one file.");
    if (itemIds.length > MAX_FILES_AT_ONCE) {
      fail("too_many", `Pick up to ${MAX_FILES_AT_ONCE} files at a time.`);
    }
    const postIds: Id<"calendarPosts">[] = [];
    for (const itemId of itemIds) {
      const item = await ctx.db.get(itemId);
      if (!item || item.organizationId !== args.organizationId) {
        fail("not_found", "One of those files is no longer in the library.");
      }
      postIds.push(await insertPost(ctx, userId, { ...args, title: args.title ?? "" }, item));
    }
    if ((args.at ?? null) === null && args.queue) await fillSlots(ctx, args.organizationId);
    return postIds;
  },
});

async function insertPost(
  ctx: MutationCtx,
  userId: string,
  args: {
    organizationId: string;
    title: string;
    platform: string;
    at?: number | null;
    queue?: boolean;
    clientId?: Id<"clients">;
  },
  item: Doc<"libraryItems"> | null,
) {
  const title = cleanTitle(args.title.trim() || item?.title || "");
  const clientId = await requireClient(ctx, args.organizationId, args.clientId ?? item?.clientId);
  const now = Date.now();
  const at = args.at ?? null;
  return await ctx.db.insert("calendarPosts", {
    organizationId: args.organizationId,
    title,
    platform: args.platform,
    at,
    queued: at === null && args.queue === true,
    queuedAt: now,
    status: "planned",
    ...(item ? { libraryItemId: item._id } : {}),
    ...(clientId ? { clientId } : {}),
    createdBy: userId,
    updatedAt: now,
  });
}

/** Moves a post to another time, as dragging does, or back to the side list with null. */
export const movePost = mutation({
  args: { postId: v.id("calendarPosts"), at: v.union(v.number(), v.null()) },
  handler: async (ctx, args) => {
    const { post } = await loadPost(ctx, args.postId);
    await ctx.db.patch(post._id, {
      at: args.at,
      queued: false,
      slotId: undefined,
      updatedAt: Date.now(),
    });
  },
});

/** Sends a post to the queue, so it takes the next free slot for its platform. */
export const queuePost = mutation({
  args: { postId: v.id("calendarPosts") },
  handler: async (ctx, args) => {
    const { post } = await loadPost(ctx, args.postId);
    const now = Date.now();
    await ctx.db.patch(post._id, {
      at: null,
      queued: true,
      queuedAt: now,
      slotId: undefined,
      updatedAt: now,
    });
    return { placed: (await fillSlots(ctx, post.organizationId)) > 0 };
  },
});

/** Renames a post, changes where it goes, or marks it posted (by hand, for now). */
export const updatePost = mutation({
  args: {
    postId: v.id("calendarPosts"),
    title: v.optional(v.string()),
    platform: v.optional(v.string()),
    posted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { post } = await loadPost(ctx, args.postId);
    const patch: Partial<Doc<"calendarPosts">> = { updatedAt: Date.now() };
    if (args.title !== undefined) patch.title = cleanTitle(args.title);
    if (args.platform !== undefined && args.platform !== post.platform) {
      checkPlatform(args.platform);
      patch.platform = args.platform;
      // A slot is for one platform, so the post leaves it but keeps its time.
      patch.slotId = undefined;
    }
    if (args.posted !== undefined) patch.status = args.posted ? "posted" : "planned";
    await ctx.db.patch(post._id, patch);
  },
});

export const removePost = mutation({
  args: { postId: v.id("calendarPosts") },
  handler: async (ctx, args) => {
    const { post } = await loadPost(ctx, args.postId);
    await ctx.db.delete(post._id);
    // Its slot time is free again for what is queued.
    if (post.slotId) await fillSlots(ctx, post.organizationId);
  },
});

/** Sets when a project slot is due, as dragging it onto a day does. Null clears it. */
export const setDue = mutation({
  args: { deliverableId: v.id("deliverables"), dueAt: v.union(v.number(), v.null()) },
  handler: async (ctx, args) => {
    const slot = await ctx.db.get(args.deliverableId);
    if (!slot) return fail("not_found", "That slot is gone.");
    await requireMember(ctx, slot.organizationId);
    await ctx.db.patch(slot._id, { dueAt: args.dueAt ?? undefined, updatedAt: Date.now() });
  },
});

/** Adds a repeating slot, then fills it from the queue. */
export const addSlot = mutation({
  args: {
    organizationId: v.string(),
    weekday: v.number(),
    time: v.string(),
    timeZone: v.string(),
    platform: v.string(),
    clientId: v.optional(v.id("clients")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const problem = slotProblem(args);
    if (problem) fail("invalid_input", problem);
    const clientId = await requireClient(ctx, args.organizationId, args.clientId);
    const existing = await slotsOf(ctx, args.organizationId);
    if (existing.length >= MAX_SLOTS) fail("invalid_input", `A team can have ${MAX_SLOTS} slots.`);
    if (
      existing.some(
        (slot) =>
          slot.weekday === args.weekday &&
          slot.time === args.time &&
          slot.platform === args.platform &&
          slot.clientId === clientId,
      )
    ) {
      fail("invalid_input", "There is already a slot then for that platform.");
    }
    const slotId = await ctx.db.insert("calendarSlots", {
      organizationId: args.organizationId,
      weekday: args.weekday,
      time: args.time,
      timeZone: args.timeZone,
      platform: args.platform,
      ...(clientId ? { clientId } : {}),
      createdBy: userId,
    });
    const placed = await fillSlots(ctx, args.organizationId);
    return { slotId, placed };
  },
});

/** Removes a repeating slot. Posts it placed keep their times. */
export const removeSlot = mutation({
  args: { slotId: v.id("calendarSlots") },
  handler: async (ctx, args) => {
    const slot = await ctx.db.get(args.slotId);
    if (!slot) return;
    await requireMember(ctx, slot.organizationId);
    const posts = await ctx.db
      .query("calendarPosts")
      .withIndex("by_slot", (q) => q.eq("slotId", slot._id))
      .take(MAX_POSTS);
    for (const post of posts) await ctx.db.patch(post._id, { slotId: undefined });
    await ctx.db.delete(slot._id);
  },
});

/** Fills every free slot time it can from the queue. Returns how many posts were placed. */
export const fill = mutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    return await fillSlots(ctx, args.organizationId);
  },
});
