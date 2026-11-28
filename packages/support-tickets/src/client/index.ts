import type {
  FunctionArgs,
  FunctionReturnType,
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";

import type { ComponentApi } from "../component/_generated/component.js";

type RunQuery = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
type RunMutation = Pick<GenericMutationCtx<GenericDataModel>, "runMutation">;
type RunAny =
  | RunQuery
  | Pick<GenericMutationCtx<GenericDataModel>, "runQuery">
  | Pick<GenericActionCtx<GenericDataModel>, "runQuery">;

type Api = ComponentApi;
type Tickets = Api["tickets"];

/** Who is writing: the person asking for help, or someone on the support side. */
export type Side = "customer" | "staff";
export type Ticket = NonNullable<FunctionReturnType<Tickets["byNumber"]>>;
export type Conversation = NonNullable<FunctionReturnType<Tickets["get"]>>;
export type Message = Conversation["messages"][number];

/**
 * Support tickets for a Convex app. The component keeps the tickets and their messages;
 * your app decides who may do what, because components can't see who is signed in:
 *
 * ```ts
 * const support = new SupportTickets(components.supportTickets);
 *
 * export const open = mutation({
 *   args: { subject: v.string(), body: v.string() },
 *   handler: async (ctx, args) => {
 *     const me = await requireUser(ctx);
 *     return await support.open(ctx, {
 *       requester: { id: me._id, name: me.name, email: me.email },
 *       ...args,
 *     });
 *   },
 * });
 * ```
 *
 * A customer should only ever reach their own tickets: check `ticket.requesterId` before
 * returning one, and never pass `withPrivate` for them.
 */
export class SupportTickets {
  constructor(public readonly component: Api) {}

  /** Opens a ticket with its first message. */
  async open(
    ctx: RunMutation,
    args: {
      requester: { id: string; name: string; email: string };
      subject: string;
      body: string;
      /** What it belongs to in your app, such as a team id. */
      scope?: string;
      /** What kind of request it is, from a list your app keeps ("billing", "bug"). */
      category?: string;
      /** Where it came from when not the person's own form, such as "assistant". */
      via?: string;
      /** Facts to keep with it: the page they were on, their browser, a job id. */
      context?: Record<string, string>;
    },
  ): Promise<FunctionReturnType<Tickets["open"]>> {
    return await ctx.runMutation(this.component.tickets.open, {
      requesterId: args.requester.id,
      requesterName: args.requester.name,
      requesterEmail: args.requester.email,
      subject: args.subject,
      body: args.body,
      ...(args.scope ? { scope: args.scope } : {}),
      ...(args.category ? { category: args.category } : {}),
      ...(args.via ? { via: args.via } : {}),
      ...(args.context ? { context: args.context } : {}),
    });
  }

  /** Adds a message, or with `private: true` a note only staff see. */
  async reply(
    ctx: RunMutation,
    args: {
      ticketId: string;
      from: Side;
      author: { id: string; name: string };
      body: string;
      private?: boolean;
    },
  ): Promise<FunctionReturnType<Tickets["reply"]>> {
    return await ctx.runMutation(this.component.tickets.reply, {
      ticketId: args.ticketId,
      from: args.from,
      authorId: args.author.id,
      authorName: args.author.name,
      body: args.body,
      ...(args.private ? { private: true } : {}),
    });
  }

  async close(ctx: RunMutation, ticketId: string, by: Side): Promise<boolean> {
    return await ctx.runMutation(this.component.tickets.setStatus, {
      ticketId,
      status: "closed",
      by,
    });
  }

  async reopen(ctx: RunMutation, ticketId: string, by: Side): Promise<boolean> {
    return await ctx.runMutation(this.component.tickets.setStatus, {
      ticketId,
      status: "open",
      by,
    });
  }

  /** Files a ticket under another category; leave `category` out for none. */
  async setCategory(ctx: RunMutation, ticketId: string, category?: string): Promise<void> {
    await ctx.runMutation(this.component.tickets.setCategory, {
      ticketId,
      ...(category ? { category } : {}),
    });
  }

  /**
   * Hands a ticket to an outside fixer (a coding agent's queue, say) with a summary safe
   * to show in public, or changes the summary of one already sent.
   */
  async handOff(
    ctx: RunMutation,
    args: { ticketId: string; summary: string; by: { id: string; name: string } },
  ): Promise<void> {
    await ctx.runMutation(this.component.tickets.handOff, {
      ticketId: args.ticketId,
      summary: args.summary,
      sentById: args.by.id,
      sentByName: args.by.name,
    });
  }

  /**
   * The fixer says a sent ticket is fixed. "already" when it said so before (nothing
   * changes); "missing" when the id names no sent ticket.
   */
  async markFixed(
    ctx: RunMutation,
    args: { ticketId: string; workId: string; reason: string; fixedAt?: number },
  ): Promise<"fixed" | "already" | "missing"> {
    return await ctx.runMutation(this.component.tickets.markFixed, {
      ticketId: args.ticketId,
      workId: args.workId,
      reason: args.reason,
      ...(args.fixedAt !== undefined ? { fixedAt: args.fixedAt } : {}),
    });
  }

  /** Sent, unfixed tickets, oldest first; pass `next` back as `after` for the next page. */
  async listHandedOff(
    ctx: RunAny,
    opts: { after?: number; limit?: number } = {},
  ): Promise<{ tickets: Ticket[]; next: number | null }> {
    return await ctx.runQuery(this.component.tickets.listHandedOff, {
      ...(opts.after !== undefined ? { after: opts.after } : {}),
      ...(opts.limit ? { limit: opts.limit } : {}),
    });
  }

  /** A ticket by an id from outside the app, which may be malformed. No private notes. */
  async find(ctx: RunAny, ticketId: string): Promise<Conversation | null> {
    return await ctx.runQuery(this.component.tickets.find, { ticketId });
  }

  async markRead(ctx: RunMutation, ticketId: string, by: Side): Promise<void> {
    await ctx.runMutation(this.component.tickets.markRead, { ticketId, by });
  }

  /** A ticket and its messages. Private notes only with `withPrivate`, for staff. */
  async get(
    ctx: RunAny,
    ticketId: string,
    opts: { withPrivate?: boolean } = {},
  ): Promise<Conversation | null> {
    return await ctx.runQuery(this.component.tickets.get, {
      ticketId,
      ...(opts.withPrivate ? { withPrivate: true } : {}),
    });
  }

  async byNumber(ctx: RunAny, number: number): Promise<Ticket | null> {
    return await ctx.runQuery(this.component.tickets.byNumber, { number });
  }

  async listForRequester(ctx: RunAny, requesterId: string, limit?: number): Promise<Ticket[]> {
    return await ctx.runQuery(this.component.tickets.listByRequester, {
      requesterId,
      ...(limit ? { limit } : {}),
    });
  }

  async listByStatus(
    ctx: RunAny,
    status: "open" | "closed",
    opts: { category?: string; limit?: number } = {},
  ): Promise<Ticket[]> {
    return await ctx.runQuery(this.component.tickets.listByStatus, {
      status,
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.limit ? { limit: opts.limit } : {}),
    });
  }

  async staffCounts(ctx: RunAny): Promise<FunctionReturnType<Tickets["staffCounts"]>> {
    return await ctx.runQuery(this.component.tickets.staffCounts, {});
  }

  async customerUnread(ctx: RunAny, requesterId: string): Promise<number> {
    return await ctx.runQuery(this.component.tickets.customerUnread, { requesterId });
  }

  /** Deletes everything one person opened. Loops until all of it is gone. */
  async removeForRequester(ctx: RunMutation, requesterId: string): Promise<number> {
    let total = 0;
    for (;;) {
      const gone = await ctx.runMutation(this.component.tickets.removeByRequester, {
        requesterId,
      });
      total += gone;
      if (gone < 50) return total;
    }
  }

  /** Deletes everything in one scope, such as a team. Loops until all of it is gone. */
  async removeForScope(ctx: RunMutation, scope: string): Promise<number> {
    let total = 0;
    for (;;) {
      const gone = await ctx.runMutation(this.component.tickets.removeByScope, { scope });
      total += gone;
      if (gone < 50) return total;
    }
  }
}

export type { ComponentApi };
export type OpenArgs = FunctionArgs<Tickets["open"]>;
