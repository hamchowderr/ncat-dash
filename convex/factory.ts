import type { Ticket } from "convex-support-tickets";
import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import { support } from "./lib/support";

// The Factory's side of support requests (docs/factory.md). A platform admin sends a
// request to the Factory from Support (support.sendToFactory); the Factory lists the
// sent ones it hasn't fixed, files each as a bead, fixes it in a pull request and says
// so here. The HTTP routes in http.ts check FACTORY_INTAKE_TOKEN and call these.

/** How many tickets one page of the list holds. */
export const FACTORY_PAGE = 50;

/** Ticket ids as the Factory accepts them. Convex ids already fit. */
/** An email address inside other text. */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export const FACTORY_ID = /^[A-Za-z0-9_.:-]+$/;

/**
 * Takes the customer's name, email addresses and team name out of text going to the
 * Factory. The Factory keeps it on a private card, but its agent could quote it in a
 * pull request on a public repository.
 */
export function scrub(text: string, ticket: Pick<Ticket, "requesterName" | "context">): string {
  let out = text.replace(EMAIL, "[email]");
  const names = [ticket.context?.team, ticket.requesterName, ...ticket.requesterName.split(/\s+/)]
    .map((each) => each?.trim())
    .filter((each): each is string => Boolean(each && each.length >= 3))
    .sort((a, b) => b.length - a.length);
  for (const name of names) {
    out = out.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[name]");
  }
  return out;
}

const factoryTicket = v.object({
  id: v.string(),
  title: v.string(),
  category: v.optional(v.string()),
  page: v.optional(v.string()),
  team: v.optional(v.string()),
  description: v.optional(v.string()),
  stepLog: v.optional(v.string()),
  url: v.optional(v.string()),
  updatedAt: v.optional(v.string()),
});

function siteUrl(path: string): string {
  return `${(process.env.SITE_URL ?? "").replace(/\/+$/, "")}${path}`;
}

/** A sent request as the Factory reads it: the public-safe summary as its title. */
function forFactory(ticket: Ticket, firstMessage: string | undefined) {
  const description = firstMessage ? scrub(firstMessage, ticket) : undefined;
  const stepLog = ticket.context?.stepLog ? scrub(ticket.context.stepLog, ticket) : undefined;
  return {
    id: ticket._id,
    title: ticket.handoff!.summary.slice(0, 200),
    ...(ticket.category ? { category: ticket.category } : {}),
    ...(ticket.context?.page ? { page: ticket.context.page } : {}),
    // The team's id, never its name.
    ...(ticket.scope ? { team: ticket.scope } : {}),
    ...(description ? { description } : {}),
    ...(stepLog ? { stepLog } : {}),
    ...(process.env.SITE_URL ? { url: siteUrl(`/admin/support?ticket=${ticket._id}`) } : {}),
    updatedAt: new Date(ticket.handoff!.updatedAt).toISOString(),
  };
}

/** The cursor the Factory sends back: the position after the last ticket of a page. */
function readCursor(cursor: string | undefined): number | undefined {
  if (!cursor) return undefined;
  const at = Number(cursor);
  return Number.isFinite(at) && at > 0 ? at : undefined;
}

/** Sent requests not fixed yet, oldest first, a page at a time. */
export const list = internalQuery({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ tickets: v.array(factoryTicket), nextCursor: v.union(v.null(), v.string()) }),
  handler: async (ctx, args) => {
    const page = await support.listHandedOff(ctx, {
      after: readCursor(args.cursor),
      limit: FACTORY_PAGE,
    });
    const tickets = [];
    for (const ticket of page.tickets) {
      const found = await support.find(ctx, ticket._id);
      const first = found?.messages.find((m) => m.from === "customer")?.body;
      tickets.push(forFactory(ticket, first));
    }
    return { tickets, nextCursor: page.next === null ? null : String(page.next) };
  },
});

/** One sent request not fixed yet, or null. */
export const get = internalQuery({
  args: { id: v.string() },
  returns: v.union(v.null(), factoryTicket),
  handler: async (ctx, args) => {
    if (!FACTORY_ID.test(args.id)) return null;
    const found = await support.find(ctx, args.id);
    if (!found || found.ticket.handoffStatus !== "sent") return null;
    const first = found.messages.find((m) => m.from === "customer")?.body;
    return forFactory(found.ticket, first);
  },
});

/** The Factory fixed a request. A repeat changes nothing. */
export const markFixed = internalMutation({
  args: {
    id: v.string(),
    beadId: v.string(),
    reason: v.string(),
    closedAt: v.optional(v.number()),
  },
  returns: v.union(v.literal("fixed"), v.literal("already"), v.literal("missing")),
  handler: async (ctx, args) => {
    if (!FACTORY_ID.test(args.id)) return "missing";
    return await support.markFixed(ctx, {
      ticketId: args.id,
      workId: args.beadId,
      reason: args.reason,
      ...(args.closedAt !== undefined ? { fixedAt: args.closedAt } : {}),
    });
  },
});
