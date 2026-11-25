import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import {
  type MutationCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { backOfficeWebhook, contactUpdate, sendContactUpdate } from "./lib/backOffice";
import { outboundPool } from "./lib/pools";

const event = v.union(v.literal("signedUp"), v.literal("trialStarted"), v.literal("paid"));

type Event = "signedUp" | "trialStarted" | "paid";

/** Queues the post for `tell`, from inside another mutation. */
export async function tellBackOffice(ctx: MutationCtx, which: Event, userId: string) {
  if (!backOfficeWebhook()) return;
  await outboundPool.enqueueAction(ctx, internal.backOffice.post, { event: which, userId });
}

/**
 * Tells the Back Office about a person (lib/backOffice.ts). Called when someone signs up,
 * when their team's free trial starts, and when it is marked paid. Does nothing while
 * BACK_OFFICE_WEBHOOK_URL is not set. The post goes through the outbound pool, which tries
 * again when the Back Office can't be reached, so nothing waits on it.
 */
export const tell = internalMutation({
  args: { event, userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await tellBackOffice(ctx, args.event, args.userId);
    return null;
  },
});

export const person = internalQuery({
  args: { userId: v.string() },
  returns: v.union(v.null(), v.object({ email: v.string(), name: v.string() })),
  handler: async (ctx, args) =>
    await ctx.runQuery(components.betterAuth.members.contact, { userId: args.userId }),
});

export const post = internalAction({
  args: { event, userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const webhook = backOfficeWebhook();
    if (!webhook) return null;
    const found = await ctx.runQuery(internal.backOffice.person, { userId: args.userId });
    if (!found) return null;
    await sendContactUpdate(webhook, contactUpdate(args.event, found));
    return null;
  },
});
