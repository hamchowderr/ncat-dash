import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { isEmailAddress } from "@takewon/email";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getCaller } from "./lib/caller";
import { limiter } from "./lib/limits";
import {
  giveConsent,
  newsFor,
  normalEmail,
  requestConsent,
  SETTINGS_WORDING,
  SIGN_UP_WORDING,
  subscriberOf,
  WEBSITE_WORDING,
  withdrawConsent,
} from "./lib/news";
import { readNewsToken } from "./lib/newsToken";
import { requireOperator } from "./lib/operator";

// Product news (newsletters). People agree at sign-up (an unticked box), in Settings,
// Email Preferences, or on the website (confirmed by email first). The rules are in
// lib/news.ts; the emails themselves go out from broadcasts.ts.

async function signedIn(ctx: Parameters<typeof getCaller>[0]) {
  const caller = await getCaller(ctx);
  if (!caller) throw new ConvexError({ code: "unauthenticated", message: "Sign in first." });
  return caller;
}

/** Whether I get product news, for Settings, Email Preferences. */
export const mine = query({
  args: {},
  returns: v.object({
    subscribed: v.boolean(),
    since: v.union(v.null(), v.number()),
    email: v.string(),
    wording: v.string(),
  }),
  handler: async (ctx) => {
    const caller = await signedIn(ctx);
    const row = await newsFor(ctx, { userId: caller._id, email: caller.email });
    const subscribed = row?.status === "subscribed";
    return {
      subscribed,
      since: subscribed ? (row?.subscribedAt ?? null) : null,
      email: caller.email,
      wording: SETTINGS_WORDING,
    };
  },
});

/** Switches my product news on or off. */
export const setMine = mutation({
  args: { subscribed: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const caller = await signedIn(ctx);
    const row = await newsFor(ctx, { userId: caller._id, email: caller.email });
    const change = {
      email: row?.email ?? caller.email,
      userId: caller._id,
      name: caller.name,
      source: "settings" as const,
      wording: SETTINGS_WORDING,
    };
    if (args.subscribed) {
      if (row?.status !== "subscribed") await giveConsent(ctx, change);
    } else {
      await withdrawConsent(ctx, change);
    }
    return null;
  },
});

/** From the sign-up form, when its product news box was ticked. */
export const fromSignUp = internalMutation({
  args: {
    userId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    networkKey: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await giveConsent(ctx, { ...args, source: "signup", wording: SIGN_UP_WORDING });
    return null;
  },
});

/**
 * A sign-up from the website's newsletter box. Books the confirmation email unless the
 * address already gets product news. Says "ok" either way, so the box never tells anyone
 * whether an address is on the list.
 */
export const requestFromWebsite = internalMutation({
  args: {
    email: v.string(),
    networkKey: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  returns: v.union(v.literal("ok"), v.literal("invalid"), v.literal("busy")),
  handler: async (ctx, args) => {
    const email = normalEmail(args.email);
    if (email.length > 254 || !isEmailAddress(email)) return "invalid";
    const all = await limiter.limit(ctx, "newsSignUps");
    if (!all.ok) return "busy";
    const one = await limiter.limit(ctx, "newsSignUpToAddress", { key: email });
    // Quietly: someone is filling in another person's address over and over.
    if (!one.ok) return "ok";
    const needsConfirming = await requestConsent(ctx, {
      ...args,
      email,
      source: "website",
      wording: WEBSITE_WORDING,
    });
    if (needsConfirming) {
      await ctx.scheduler.runAfter(0, internal.broadcasts.sendConfirmation, { email });
    }
    return "ok";
  },
});

/** The link in the confirmation email. Returns the address now subscribed, or null. */
export const confirm = internalMutation({
  args: {
    token: v.string(),
    networkKey: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const link = await readNewsToken(args.token);
    if (link?.purpose !== "confirm") return null;
    const existing = await subscriberOf(ctx, link.email);
    // Stopped since the link was sent: the old link does not start it again.
    if (!existing || existing.status === "unsubscribed") return null;
    if (existing.confirmSentAt && link.issuedAt < existing.confirmSentAt - 1000) return null;
    if (existing.status !== "subscribed") {
      await giveConsent(ctx, {
        email: link.email,
        source: "website",
        wording: WEBSITE_WORDING,
        ...(args.networkKey ? { networkKey: args.networkKey } : {}),
        ...(args.userAgent ? { userAgent: args.userAgent } : {}),
      });
    }
    return link.email;
  },
});

/** The unsubscribe link in product news. Returns the address, or null for a bad link. */
export const unsubscribe = internalMutation({
  args: { token: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const link = await readNewsToken(args.token);
    if (link?.purpose !== "unsubscribe") return null;
    const broadcastId = link.broadcastId
      ? ctx.db.normalizeId("broadcasts", link.broadcastId)
      : null;
    const changed = await withdrawConsent(ctx, {
      email: link.email,
      source: "unsubscribe_link",
      ...(broadcastId ? { broadcastId } : {}),
    });
    if (changed && broadcastId) {
      const broadcast = await ctx.db.get(broadcastId);
      if (broadcast) await ctx.db.patch(broadcastId, { unsubscribed: broadcast.unsubscribed + 1 });
    }
    return link.email;
  },
});

/** For the confirmation email: still waiting to be confirmed? */
export const pending = internalQuery({
  args: { email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => (await subscriberOf(ctx, args.email))?.status === "pending",
});

// ---- For the operator: the Subscribers page ----

const statusFilter = v.union(
  v.literal("subscribed"),
  v.literal("pending"),
  v.literal("unsubscribed"),
);

const COUNT_UP_TO = 10_000;

/** How many addresses are in each state, counted up to 10,000. */
export const counts = query({
  args: {},
  returns: v.object({ subscribed: v.number(), pending: v.number(), unsubscribed: v.number() }),
  handler: async (ctx) => {
    await requireOperator(ctx);
    const count = async (status: Doc<"subscribers">["status"]) =>
      (
        await ctx.db
          .query("subscribers")
          .withIndex("by_status", (q) => q.eq("status", status))
          .take(COUNT_UP_TO)
      ).length;
    return {
      subscribed: await count("subscribed"),
      pending: await count("pending"),
      unsubscribed: await count("unsubscribed"),
    };
  },
});

/** Subscribers, newest change first; a search matches the start of the address. */
export const list = query({
  args: {
    search: v.optional(v.string()),
    status: v.optional(statusFilter),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const search = args.search ? normalEmail(args.search) : "";
    const status = args.status;
    if (search) {
      const result = await ctx.db
        .query("subscribers")
        .withIndex("by_email", (q) => q.gte("email", search).lt("email", `${search}￿`))
        .filter((q) => (status ? q.eq(q.field("status"), status) : true))
        .paginate(args.paginationOpts);
      return result;
    }
    if (status) {
      return await ctx.db
        .query("subscribers")
        .withIndex("by_status", (q) => q.eq("status", status))
        .order("desc")
        .paginate(args.paginationOpts);
    }
    return await ctx.db
      .query("subscribers")
      .withIndex("by_updated")
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

/** One address's consent records, newest first: when, where, and the words agreed to. */
export const history = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return await ctx.db
      .query("consentRecords")
      .withIndex("by_email", (q) => q.eq("email", normalEmail(args.email)))
      .order("desc")
      .take(50);
  },
});

/** The operator stops product news for an address, say after someone asked by email. */
export const stopFor = mutation({
  args: { email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await withdrawConsent(ctx, {
      email: args.email,
      source: "operator",
      wording: `Stopped by ${operator.email}`,
    });
  },
});
