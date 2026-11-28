import { supportReplyEmail, supportTicketEmail, DEFAULT_APP_NAME } from "@takewon/email";
import type { Ticket } from "convex-support-tickets";
import { ConvexError, v } from "convex/values";

import { components, internal } from "./_generated/api";
import { type MutationCtx, internalMutation, mutation, query } from "./_generated/server";
import { MANAGER_ROLES, requireMember, type TeamRole } from "./lib/authz";
import { type Caller, getCaller } from "./lib/caller";
import { limiter, waitLabel } from "./lib/limits";
import { callerIsOperator, operatorEmails, requireOperator } from "./lib/operator";
import { stepLogOf, support } from "./lib/support";
import { isSupportCategory, type SupportVia } from "./lib/supportCategories";

// Support tickets. Customers ask for help from the Get help page (/help) and see the
// answers there; whoever runs this copy (the operator, OPERATOR_EMAILS) answers from the
// Support page under Admin (/admin/support). The tickets themselves live in the
// convex-support-tickets component (packages/support-tickets); this file decides who
// may see and do what, and sends the emails. support@takewon.com stays a backup way in.

const HELP_PATH = "/help";
const ADMIN_PATH = "/admin/support";

function siteUrl(path: string): string {
  return `${(process.env.SITE_URL ?? "").replace(/\/+$/, "")}${path}`;
}

const branding = () => ({ appName: process.env.EMAIL_FROM_NAME?.trim() || DEFAULT_APP_NAME });

async function signedIn(ctx: Parameters<typeof getCaller>[0]): Promise<Caller> {
  const caller = await getCaller(ctx);
  if (!caller) throw new ConvexError({ code: "unauthenticated", message: "Sign in first." });
  return caller;
}

async function spend(ctx: MutationCtx, userId: string) {
  const status = await limiter.limit(ctx, "supportMessage", { key: userId });
  if (!status.ok) {
    throw new ConvexError({
      code: "rate_limited",
      message: `That's a lot of messages at once. Try again ${waitLabel(status.retryAfter)}.`,
    });
  }
}

/** The caller's own ticket, or "not found": nobody learns whether someone else's exists. */
async function ownTicket(ctx: Parameters<typeof getCaller>[0], ticketId: string) {
  const caller = await signedIn(ctx);
  const found = await support.get(ctx, ticketId).catch(() => null);
  if (!found || found.ticket.requesterId !== caller._id) {
    throw new ConvexError({ code: "not_found", message: "That request is gone." });
  }
  return { caller, found };
}

/** What a customer sees of a ticket in their list: no notes, no context. */
function customerView(ticket: Ticket) {
  return {
    id: ticket._id,
    number: ticket.number,
    subject: ticket.subject,
    status: ticket.status,
    preview: ticket.preview,
    lastMessageAt: ticket.lastMessageAt,
    answered: ticket.lastPublicFrom === "staff",
    unread: ticket.customerUnread,
    category: ticket.category ?? null,
    via: ticket.via ?? null,
  };
}

const customerTicket = v.object({
  id: v.string(),
  number: v.number(),
  subject: v.string(),
  status: v.union(v.literal("open"), v.literal("closed")),
  preview: v.string(),
  lastMessageAt: v.number(),
  answered: v.boolean(),
  unread: v.boolean(),
  category: v.union(v.null(), v.string()),
  via: v.union(v.null(), v.string()),
});

const shownMessage = v.object({
  id: v.string(),
  at: v.number(),
  from: v.union(v.literal("customer"), v.literal("staff")),
  authorName: v.string(),
  body: v.string(),
  private: v.boolean(),
});

/** Emails the operator about a new request or a new message on one. */
async function tellOperator(
  ctx: MutationCtx,
  args: { kind: "new" | "message"; ticket: Ticket; from: string; body: string },
) {
  const message = supportTicketEmail(
    {
      kind: args.kind,
      number: args.ticket.number,
      subject: args.ticket.subject,
      from: args.from,
      teamName: args.ticket.context?.team,
      body: args.body,
      ticketUrl: siteUrl(`${ADMIN_PATH}?ticket=${args.ticket._id}`),
    },
    branding(),
  );
  for (const to of operatorEmails()) {
    await ctx.scheduler.runAfter(0, internal.email.send, { to, ...message });
  }
}

// ---------------------------------------------------------------------------------------
// The customer's side: the Get help page.

/** The address people can also write to (SUPPORT_EMAIL), shown as a backup on Get help. */
export const contact = query({
  args: {},
  returns: v.object({ email: v.union(v.null(), v.string()) }),
  handler: async () => ({ email: process.env.SUPPORT_EMAIL?.trim() || null }),
});

/** The caller's requests, the latest first. */
export const mine = query({
  args: {},
  returns: v.array(customerTicket),
  handler: async (ctx) => {
    const caller = await getCaller(ctx);
    if (!caller) return [];
    return (await support.listForRequester(ctx, caller._id)).map(customerView);
  },
});

/** How many of the caller's requests have an answer they haven't read, for the menu. */
export const unread = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const caller = await getCaller(ctx);
    if (!caller) return 0;
    return await support.customerUnread(ctx, caller._id);
  },
});

/** One of the caller's requests and its messages. Never shows support's private notes. */
export const conversation = query({
  args: { ticketId: v.string() },
  returns: v.union(v.null(), v.object({ ticket: customerTicket, messages: v.array(shownMessage) })),
  handler: async (ctx, args) => {
    const caller = await getCaller(ctx);
    if (!caller) return null;
    const found = await support.get(ctx, args.ticketId).catch(() => null);
    if (!found || found.ticket.requesterId !== caller._id) return null;
    return {
      ticket: customerView(found.ticket),
      messages: found.messages.map((m) => ({
        id: m._id,
        at: m._creationTime,
        from: m.from,
        authorName: m.from === "staff" ? "Support" : m.authorName,
        body: m.body,
        private: false,
      })),
    };
  },
});

/** The person asking, as a request needs them. */
type Asker = { _id: string; name: string; email: string };

/**
 * Opens a request for someone on a team. Keeps the team, the page they were on and the
 * team's latest runs with it, so support doesn't have to ask. Used by the Get Help form,
 * by the assistant in chat (as the person) and by AI apps over MCP.
 */
async function openRequest(
  ctx: MutationCtx,
  asker: Asker,
  args: {
    organizationId: string;
    subject: string;
    body: string;
    category?: string;
    via?: SupportVia;
    page?: string;
    browser?: string;
  },
) {
  await spend(ctx, asker._id);
  const teams = await ctx.runQuery(components.betterAuth.members.teamsFor, {
    userId: asker._id,
  });
  const team = teams.find((each) => each.id === args.organizationId);
  const latest = await ctx.db
    .query("runs")
    .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
    .order("desc")
    .first();
  const failed = await ctx.db
    .query("runs")
    .withIndex("by_organization_and_status", (q) =>
      q.eq("organizationId", args.organizationId).eq("status", "failed"),
    )
    .order("desc")
    .first();
  const context: Record<string, string> = {};
  if (team) context.team = team.name;
  if (args.page) context.page = args.page.slice(0, 300);
  if (args.browser) context.browser = args.browser.slice(0, 300);
  // Support can't open a team's runs, so the facts that matter travel with the request.
  if (latest) {
    context.latestRun = `${latest.automationName}: ${latest.status} (${latest._id})`;
  }
  if (failed) {
    context.latestFailedRun = `${failed.automationName} (${failed._id})${failed.error ? `: ${failed.error.slice(0, 300)}` : ""}`;
    context.failedRunId = failed._id;
    context.stepLog = await stepLogOf(ctx, failed);
  }

  const opened = await support.open(ctx, {
    requester: { id: asker._id, name: asker.name || asker.email, email: asker.email },
    scope: args.organizationId,
    subject: args.subject,
    body: args.body,
    // Anything not on the list (an older screen, a guess) is filed as "Something else".
    category: isSupportCategory(args.category) ? args.category : "other",
    ...(args.via ? { via: args.via } : {}),
    context,
  });
  const ticket = (await support.get(ctx, opened.ticketId))!.ticket;
  await tellOperator(ctx, { kind: "new", ticket, from: ticket.requesterName, body: args.body });
  return {
    ticketId: opened.ticketId,
    number: opened.number,
    address: `${HELP_PATH}?ticket=${opened.ticketId}`,
  };
}

const opened = v.object({ ticketId: v.string(), number: v.number(), address: v.string() });

/** Whether the caller may file a request for this team: its owners and admins only. */
export const canFile = query({
  args: { organizationId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const caller = await getCaller(ctx);
    if (!caller) return false;
    const role = (await ctx.runQuery(components.betterAuth.members.roleFor, {
      userId: caller._id,
      organizationId: args.organizationId,
    })) as TeamRole | null;
    return role !== null && MANAGER_ROLES.includes(role);
  },
});

/**
 * Asks for help, from the Get Help form or from the assistant in chat on the person's
 * behalf (`via: "assistant"`, after they said yes to it on the assistant's card).
 */
export const open = mutation({
  args: {
    organizationId: v.string(),
    subject: v.string(),
    body: v.string(),
    category: v.optional(v.string()),
    via: v.optional(v.literal("assistant")),
    page: v.optional(v.string()),
    browser: v.optional(v.string()),
  },
  returns: opened,
  handler: async (ctx, args) => {
    // Only a team's owners and admins file requests; a member asks one of them.
    await requireMember(ctx, args.organizationId, MANAGER_ROLES);
    const caller = await signedIn(ctx);
    return await openRequest(ctx, caller, args);
  },
});

/** The same for an AI app over MCP, as the person who connected it. */
export const openAs = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    subject: v.string(),
    body: v.string(),
    category: v.optional(v.string()),
  },
  returns: opened,
  handler: async (ctx, { userId, ...args }) => {
    const [role, person] = await Promise.all([
      ctx.runQuery(components.betterAuth.members.roleFor, {
        userId,
        organizationId: args.organizationId,
      }),
      ctx.runQuery(components.betterAuth.members.contact, { userId }),
    ]);
    if (!role || !person) {
      throw new ConvexError({ code: "forbidden", message: "You are not on this team." });
    }
    if (!MANAGER_ROLES.includes(role as TeamRole)) {
      throw new ConvexError({
        code: "forbidden",
        message: "Only a team owner or admin can do this.",
      });
    }
    return await openRequest(ctx, { _id: userId, ...person }, { ...args, via: "mcp" });
  },
});

/** Writes again on one of the caller's requests. Writing on a closed one opens it again. */
export const reply = mutation({
  args: { ticketId: v.string(), body: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { caller, found } = await ownTicket(ctx, args.ticketId);
    await spend(ctx, caller._id);
    await support.reply(ctx, {
      ticketId: args.ticketId,
      from: "customer",
      author: { id: caller._id, name: caller.name || caller.email },
      body: args.body,
    });
    await tellOperator(ctx, {
      kind: "message",
      ticket: found.ticket,
      from: found.ticket.requesterName,
      body: args.body,
    });
    return null;
  },
});

/** The caller says their question is answered. */
export const close = mutation({
  args: { ticketId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ownTicket(ctx, args.ticketId);
    await support.close(ctx, args.ticketId, "customer");
    return null;
  },
});

/** The caller has read the request's latest answer. */
export const markRead = mutation({
  args: { ticketId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const caller = await getCaller(ctx);
    if (!caller) return null;
    const found = await support.get(ctx, args.ticketId).catch(() => null);
    if (!found || found.ticket.requesterId !== caller._id || !found.ticket.customerUnread) {
      return null;
    }
    await support.markRead(ctx, args.ticketId, "customer");
    return null;
  },
});

// ---------------------------------------------------------------------------------------
// The operator's side: the Support page under Admin.

const staffTicket = v.object({
  id: v.string(),
  number: v.number(),
  subject: v.string(),
  status: v.union(v.literal("open"), v.literal("closed")),
  requesterName: v.string(),
  requesterEmail: v.string(),
  team: v.union(v.null(), v.string()),
  preview: v.string(),
  lastMessageAt: v.number(),
  waitingOnUs: v.boolean(),
  unread: v.boolean(),
  category: v.union(v.null(), v.string()),
  via: v.union(v.null(), v.string()),
});

function staffView(ticket: Ticket) {
  return {
    id: ticket._id,
    number: ticket.number,
    subject: ticket.subject,
    status: ticket.status,
    requesterName: ticket.requesterName,
    requesterEmail: ticket.requesterEmail,
    team: ticket.context?.team ?? null,
    preview: ticket.preview,
    lastMessageAt: ticket.lastMessageAt,
    waitingOnUs: ticket.status === "open" && ticket.lastPublicFrom === "customer",
    unread: ticket.staffUnread,
    category: ticket.category ?? null,
    via: ticket.via ?? null,
  };
}

/**
 * Open or closed requests, the latest first, with how many are open and unread and how
 * many are open in each category. With `category`, only that category's.
 */
export const inbox = query({
  args: {
    status: v.union(v.literal("open"), v.literal("closed")),
    category: v.optional(v.string()),
  },
  returns: v.object({
    tickets: v.array(staffTicket),
    counts: v.object({
      open: v.number(),
      unread: v.number(),
      byCategory: v.array(v.object({ category: v.string(), open: v.number() })),
    }),
  }),
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const [tickets, counts] = await Promise.all([
      support.listByStatus(ctx, args.status, { category: args.category }),
      support.staffCounts(ctx),
    ]);
    return { tickets: tickets.map(staffView), counts };
  },
});

/** Files a request under another category. Only sorts the inbox; nobody is told. */
export const setCategory = mutation({
  args: { ticketId: v.string(), category: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    if (!isSupportCategory(args.category)) {
      throw new ConvexError({ code: "invalid", message: "That category isn't on the list." });
    }
    await support.setCategory(ctx, args.ticketId, args.category);
    return null;
  },
});

/** How many open requests support hasn't read, beside Support in the menu. 0 for others. */
export const staffUnread = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    if (!callerIsOperator(await getCaller(ctx))) return 0;
    return (await support.staffCounts(ctx)).unread;
  },
});

/** One request with everything: private notes and what was kept when it was opened. */
export const staffConversation = query({
  args: { ticketId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      ticket: staffTicket,
      context: v.record(v.string(), v.string()),
      messages: v.array(shownMessage),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const found = await support.get(ctx, args.ticketId, { withPrivate: true }).catch(() => null);
    if (!found) return null;
    return {
      ticket: staffView(found.ticket),
      context: found.ticket.context ?? {},
      messages: found.messages.map((m) => ({
        id: m._id,
        at: m._creationTime,
        from: m.from,
        authorName: m.authorName,
        body: m.body,
        private: m.private,
      })),
    };
  },
});

/**
 * Answers a request, or adds a private note. An answer is emailed to the person with a
 * link back here; a note is for support only and sends nothing.
 */
export const answer = mutation({
  args: { ticketId: v.string(), body: v.string(), private: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const caller = await requireOperator(ctx);
    const found = await support.get(ctx, args.ticketId).catch(() => null);
    if (!found) throw new ConvexError({ code: "not_found", message: "That request is gone." });
    await support.reply(ctx, {
      ticketId: args.ticketId,
      from: "staff",
      author: { id: caller._id, name: caller.name || "Support" },
      body: args.body,
      private: args.private ?? false,
    });
    await support.markRead(ctx, args.ticketId, "staff");
    if (!args.private) {
      const { ticket } = found;
      await ctx.scheduler.runAfter(0, internal.email.send, {
        to: ticket.requesterEmail,
        ...supportReplyEmail(
          {
            name: ticket.requesterName.split(" ")[0],
            number: ticket.number,
            subject: ticket.subject,
            from: `${branding().appName} support`,
            reply: args.body,
            ticketUrl: siteUrl(`${HELP_PATH}?ticket=${ticket._id}`),
          },
          branding(),
        ),
      });
    }
    return null;
  },
});

/** Closes a request, or opens it again. */
export const setStatus = mutation({
  args: { ticketId: v.string(), status: v.union(v.literal("open"), v.literal("closed")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    if (args.status === "closed") await support.close(ctx, args.ticketId, "staff");
    else await support.reopen(ctx, args.ticketId, "staff");
    return null;
  },
});

/** Support has read the request. */
export const staffMarkRead = mutation({
  args: { ticketId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    await support.markRead(ctx, args.ticketId, "staff");
    return null;
  },
});
