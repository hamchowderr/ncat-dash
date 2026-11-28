import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel.js";
import { type MutationCtx, mutation, query } from "./_generated/server.js";
import { messageFields, side, status, ticketFields } from "./schema.js";

// The support tickets component: tickets, the messages on them and private notes. It
// knows nothing about who is signed in. The app decides who may call what (a customer
// sees only their own tickets, support staff see all) and passes plain ids and names in.

export const LIMITS = { subject: 200, body: 10_000, preview: 160, label: 60 } as const;

/** A category or channel name: short, or left out when empty. */
function label(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, LIMITS.label) : undefined;
}

const ticket = v.object({ _id: v.id("tickets"), _creationTime: v.number(), ...ticketFields });
const message = v.object({ _id: v.id("messages"), _creationTime: v.number(), ...messageFields });

function clean(value: string, max: number, what: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ConvexError({ code: "empty", message: `Write a ${what} first.` });
  if (trimmed.length > max) {
    throw new ConvexError({
      code: "too_long",
      message: `That ${what} is too long: keep it under ${max.toLocaleString("en-US")} characters.`,
    });
  }
  return trimmed;
}

function previewOf(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > LIMITS.preview ? `${flat.slice(0, LIMITS.preview - 1)}…` : flat;
}

async function nextNumber(ctx: MutationCtx): Promise<number> {
  const counter = await ctx.db
    .query("counters")
    .withIndex("by_name", (q) => q.eq("name", "tickets"))
    .unique();
  if (!counter) {
    await ctx.db.insert("counters", { name: "tickets", next: 2 });
    return 1;
  }
  await ctx.db.patch(counter._id, { next: counter.next + 1 });
  return counter.next;
}

async function mustGet(ctx: MutationCtx, ticketId: Id<"tickets">): Promise<Doc<"tickets">> {
  const found = await ctx.db.get(ticketId);
  if (!found) throw new ConvexError({ code: "not_found", message: "That ticket is gone." });
  return found;
}

/** Opens a ticket with its first message, and returns its id and number. */
export const open = mutation({
  args: {
    requesterId: v.string(),
    requesterName: v.string(),
    requesterEmail: v.string(),
    scope: v.optional(v.string()),
    subject: v.string(),
    body: v.string(),
    category: v.optional(v.string()),
    via: v.optional(v.string()),
    context: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.object({ ticketId: v.id("tickets"), number: v.number() }),
  handler: async (ctx, args) => {
    const subject = clean(args.subject, LIMITS.subject, "subject");
    const body = clean(args.body, LIMITS.body, "message");
    const category = label(args.category);
    const via = label(args.via);
    const number = await nextNumber(ctx);
    const now = Date.now();
    const ticketId = await ctx.db.insert("tickets", {
      number,
      subject,
      status: "open",
      requesterId: args.requesterId,
      requesterName: args.requesterName,
      requesterEmail: args.requesterEmail,
      ...(args.scope ? { scope: args.scope } : {}),
      ...(category ? { category } : {}),
      ...(via ? { via } : {}),
      ...(args.context && Object.keys(args.context).length ? { context: args.context } : {}),
      lastMessageAt: now,
      lastPublicFrom: "customer",
      preview: previewOf(body),
      customerUnread: false,
      staffUnread: true,
      messageCount: 1,
    });
    await ctx.db.insert("messages", {
      ticketId,
      from: "customer",
      authorId: args.requesterId,
      authorName: args.requesterName,
      body,
      private: false,
    });
    return { ticketId, number };
  },
});

/**
 * Adds a message. A customer writing on a closed ticket opens it again. A private note
 * (staff only) changes nothing the customer sees.
 */
export const reply = mutation({
  args: {
    ticketId: v.id("tickets"),
    from: side,
    authorId: v.string(),
    authorName: v.string(),
    body: v.string(),
    private: v.optional(v.boolean()),
  },
  returns: v.object({ messageId: v.id("messages"), reopened: v.boolean() }),
  handler: async (ctx, args) => {
    const found = await mustGet(ctx, args.ticketId);
    const isPrivate = args.private ?? false;
    if (isPrivate && args.from !== "staff") {
      throw new ConvexError({ code: "forbidden", message: "Only support can add private notes." });
    }
    const body = clean(args.body, LIMITS.body, isPrivate ? "note" : "message");
    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      ticketId: found._id,
      from: args.from,
      authorId: args.authorId,
      authorName: args.authorName,
      body,
      private: isPrivate,
    });
    const reopened = !isPrivate && args.from === "customer" && found.status === "closed";
    await ctx.db.patch(found._id, {
      lastMessageAt: now,
      messageCount: found.messageCount + 1,
      ...(isPrivate
        ? {}
        : {
            lastPublicFrom: args.from,
            preview: previewOf(body),
            ...(args.from === "staff" ? { customerUnread: true } : { staffUnread: true }),
          }),
      ...(reopened ? { status: "open" as const, closedAt: undefined } : {}),
    });
    return { messageId, reopened };
  },
});

/** Closes or reopens a ticket. Closing by support tells the customer; by themselves doesn't. */
export const setStatus = mutation({
  args: { ticketId: v.id("tickets"), status, by: side },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const found = await mustGet(ctx, args.ticketId);
    if (found.status === args.status) return false;
    await ctx.db.patch(found._id, {
      status: args.status,
      closedAt: args.status === "closed" ? Date.now() : undefined,
      ...(args.by === "staff" ? { customerUnread: true } : { staffUnread: args.status === "open" }),
    });
    return true;
  },
});

/** Files a ticket under another category, or none. Nobody is told: it only sorts the inbox. */
export const setCategory = mutation({
  args: { ticketId: v.id("tickets"), category: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const found = await mustGet(ctx, args.ticketId);
    await ctx.db.patch(found._id, { category: label(args.category) });
    return null;
  },
});

/**
 * Hands a ticket to an outside fixer with a summary staff wrote or checked, or changes
 * the summary of one already sent. A fixed ticket stays fixed: sending it again throws.
 */
export const handOff = mutation({
  args: {
    ticketId: v.id("tickets"),
    summary: v.string(),
    sentById: v.string(),
    sentByName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const found = await mustGet(ctx, args.ticketId);
    if (found.handoffStatus === "fixed") {
      throw new ConvexError({ code: "conflict", message: "That ticket is already fixed." });
    }
    const summary = clean(args.summary, LIMITS.subject, "summary");
    const now = Date.now();
    await ctx.db.patch(found._id, {
      handoffStatus: "sent",
      handoff: {
        summary,
        sentAt: found.handoff?.sentAt ?? now,
        sentById: args.sentById,
        sentByName: args.sentByName,
        updatedAt: now,
      },
    });
    return null;
  },
});

/** Counts the ticket as seen by one side. */
export const markRead = mutation({
  args: { ticketId: v.id("tickets"), by: side },
  returns: v.null(),
  handler: async (ctx, args) => {
    const found = await ctx.db.get(args.ticketId);
    if (!found) return null;
    if (args.by === "customer" && found.customerUnread) {
      await ctx.db.patch(found._id, { customerUnread: false });
    }
    if (args.by === "staff" && found.staffUnread) {
      await ctx.db.patch(found._id, { staffUnread: false });
    }
    return null;
  },
});

/** One ticket and its messages, oldest first. Private notes only when asked for. */
export const get = query({
  args: { ticketId: v.id("tickets"), withPrivate: v.optional(v.boolean()) },
  returns: v.union(v.null(), v.object({ ticket, messages: v.array(message) })),
  handler: async (ctx, args) => {
    const found = await ctx.db.get(args.ticketId);
    if (!found) return null;
    const all = await ctx.db
      .query("messages")
      .withIndex("by_ticket", (q) => q.eq("ticketId", found._id))
      .collect();
    return { ticket: found, messages: args.withPrivate ? all : all.filter((m) => !m.private) };
  },
});

/** Finds a ticket by its number, for support typing "42". */
export const byNumber = query({
  args: { number: v.number() },
  returns: v.union(v.null(), ticket),
  handler: async (ctx, args) =>
    await ctx.db
      .query("tickets")
      .withIndex("by_number", (q) => q.eq("number", args.number))
      .unique(),
});

/** One person's tickets, the latest first. */
export const listByRequester = query({
  args: { requesterId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(ticket),
  handler: async (ctx, args) =>
    await ctx.db
      .query("tickets")
      .withIndex("by_requester", (q) => q.eq("requesterId", args.requesterId))
      .order("desc")
      .take(Math.min(args.limit ?? 50, 200)),
});

/** Open or closed tickets, the latest first, for support's inbox; one category's with `category`. */
export const listByStatus = query({
  args: { status, category: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.array(ticket),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 100, 500);
    const { category } = args;
    if (category === undefined) {
      return await ctx.db
        .query("tickets")
        .withIndex("by_status", (q) => q.eq("status", args.status))
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("tickets")
      .withIndex("by_status_and_category", (q) =>
        q.eq("status", args.status).eq("category", category),
      )
      .order("desc")
      .take(limit);
  },
});

/**
 * How many open tickets there are, how many of them have something support hasn't seen,
 * and how many are open in each category (tickets with none are left out of that list).
 */
export const staffCounts = query({
  args: {},
  returns: v.object({
    open: v.number(),
    unread: v.number(),
    byCategory: v.array(v.object({ category: v.string(), open: v.number() })),
  }),
  handler: async (ctx) => {
    const open = await ctx.db
      .query("tickets")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .take(1000);
    const counts = new Map<string, number>();
    for (const each of open) {
      if (each.category) counts.set(each.category, (counts.get(each.category) ?? 0) + 1);
    }
    return {
      open: open.length,
      unread: open.filter((t) => t.staffUnread).length,
      byCategory: [...counts].map(([category, n]) => ({ category, open: n })),
    };
  },
});

/** How many of one person's tickets have something they haven't seen. */
export const customerUnread = query({
  args: { requesterId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const mine = await ctx.db
      .query("tickets")
      .withIndex("by_requester", (q) => q.eq("requesterId", args.requesterId))
      .take(200);
    return mine.filter((t) => t.customerUnread).length;
  },
});

async function removeTickets(ctx: MutationCtx, tickets: Doc<"tickets">[]): Promise<number> {
  for (const each of tickets) {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_ticket", (q) => q.eq("ticketId", each._id))
      .collect();
    for (const m of messages) await ctx.db.delete(m._id);
    await ctx.db.delete(each._id);
  }
  return tickets.length;
}

/**
 * Deletes one person's tickets and their messages, a batch at a time, when their account
 * goes. Returns how many went; call again while it returns the batch size.
 */
export const removeByRequester = mutation({
  args: { requesterId: v.string(), batch: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, args) =>
    await removeTickets(
      ctx,
      await ctx.db
        .query("tickets")
        .withIndex("by_requester", (q) => q.eq("requesterId", args.requesterId))
        .take(args.batch ?? 50),
    ),
});

/** Deletes the tickets of one scope (such as a team being deleted), a batch at a time. */
export const removeByScope = mutation({
  args: { scope: v.string(), batch: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, args) =>
    await removeTickets(
      ctx,
      await ctx.db
        .query("tickets")
        .withIndex("by_scope", (q) => q.eq("scope", args.scope))
        .take(args.batch ?? 50),
    ),
});
