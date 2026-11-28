import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** Who wrote a message: the person asking for help, or someone on the support side. */
export const side = v.union(v.literal("customer"), v.literal("staff"));
export const status = v.union(v.literal("open"), v.literal("closed"));

/**
 * Where a ticket stands with an outside fixer (such as a coding agent's work queue):
 * "sent" once staff hand it over, "fixed" once the fixer reports it done.
 */
export const handoffStatus = v.union(v.literal("sent"), v.literal("fixed"));

/** The handover: the public-safe summary staff wrote, who sent it, and the fixer's answer. */
export const handoffFields = v.object({
  /** A short summary safe to show in public (a pull request title): no names, no emails. */
  summary: v.string(),
  sentAt: v.number(),
  sentById: v.string(),
  sentByName: v.string(),
  /** Changes whenever the handover does, so the fixer can tell an edited one. */
  updatedAt: v.number(),
  /** What the fixer filed it as (its own id) and how it ended, once fixed. */
  workId: v.optional(v.string()),
  reason: v.optional(v.string()),
  fixedAt: v.optional(v.number()),
});

export const ticketFields = {
  /** A short number people can quote ("ticket 42"), counted up from 1. */
  number: v.number(),
  subject: v.string(),
  status,
  /** The app's id for the person who asked. Ids from the app are plain strings here. */
  requesterId: v.string(),
  requesterName: v.string(),
  requesterEmail: v.string(),
  /** What the ticket belongs to in the app, such as a team or workspace id. */
  scope: v.optional(v.string()),
  /** What kind of request it is, from a short list the app chooses ("billing", "bug"). */
  category: v.optional(v.string()),
  /**
   * Where it was opened, when not by the person themselves in a form: "assistant" when an
   * AI assistant opened it for them, or whatever channel names the app uses.
   */
  via: v.optional(v.string()),
  /** Facts the app adds when the ticket is opened: the page, the latest run, the browser. */
  context: v.optional(v.record(v.string(), v.string())),
  /** When the last message (a private note included) was added. */
  lastMessageAt: v.number(),
  /** Who wrote the last message the customer can see: whose turn it is. */
  lastPublicFrom: side,
  /** A preview of the last message the customer can see. */
  preview: v.string(),
  /** Something the customer hasn't seen yet: a reply, or the ticket being closed. */
  customerUnread: v.boolean(),
  /** Something support hasn't seen yet: a new ticket or a new customer message. */
  staffUnread: v.boolean(),
  messageCount: v.number(),
  closedAt: v.optional(v.number()),
  /** Set once staff send the ticket to an outside fixer. */
  handoffStatus: v.optional(handoffStatus),
  handoff: v.optional(handoffFields),
};

export const messageFields = {
  ticketId: v.id("tickets"),
  from: side,
  authorId: v.string(),
  authorName: v.string(),
  body: v.string(),
  /** A note only support sees. Never shown to the customer or emailed to them. */
  private: v.boolean(),
};

export default defineSchema({
  tickets: defineTable(ticketFields)
    .index("by_requester", ["requesterId", "lastMessageAt"])
    .index("by_status", ["status", "lastMessageAt"])
    .index("by_status_and_category", ["status", "category", "lastMessageAt"])
    .index("by_scope", ["scope"])
    .index("by_number", ["number"])
    // Sent tickets, oldest first, for the fixer to page through.
    .index("by_handoff", ["handoffStatus"]),
  messages: defineTable(messageFields).index("by_ticket", ["ticketId"]),
  // The next ticket number, in one row.
  counters: defineTable({ name: v.string(), next: v.number() }).index("by_name", ["name"]),
});
