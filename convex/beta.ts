import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";

import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { isEmailAddress } from "@takewon/email";
import { limiter } from "./lib/limits";
import { normalEmail, requestConsent } from "./lib/news";
import { requireOperator } from "./lib/operator";

// The beta. The website's "Join the beta" form sends each sign-up here, server to server
// (POST /beta/apply in http.ts, with BETA_SIGNUP_SECRET). The operator reads them on the
// Admin page Beta Testers and invites the ones they want; the invite links to sign-up,
// and the row turns "joined" when that address makes an account. A few days after
// joining, the tester gets one short check-in asking how it went.

export const CHECK_IN_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_ANSWERS = 30;

const status = v.union(v.literal("applied"), v.literal("invited"), v.literal("joined"));
const answer = v.object({ question: v.string(), answer: v.string() });

const clip = (value: string | undefined, max: number) => (value ?? "").trim().slice(0, max);

async function testerOf(ctx: QueryCtx | MutationCtx, email: string) {
  return await ctx.db
    .query("betaTesters")
    .withIndex("by_email", (q) => q.eq("email", normalEmail(email)))
    .first();
}

/**
 * One sign-up from the website. A second sign-up from the same address updates the
 * answers and keeps its place (and an invite or account it already has). Ticking the
 * newsletter box asks for product news the same way the website's newsletter box does:
 * a confirmation email first, and the words they agreed to kept in consentRecords.
 */
export const apply = internalMutation({
  args: {
    email: v.string(),
    name: v.string(),
    link: v.optional(v.string()),
    source: v.optional(v.string()),
    answers: v.array(answer),
    newsletter: v.optional(v.boolean()),
    newsletterWording: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  returns: v.union(v.literal("ok"), v.literal("invalid"), v.literal("busy")),
  handler: async (ctx, args) => {
    const email = normalEmail(args.email);
    const name = clip(args.name, 120);
    if (email.length > 254 || !isEmailAddress(email) || !name) return "invalid";
    const all = await limiter.limit(ctx, "betaSignUps");
    if (!all.ok) return "busy";
    const now = Date.now();
    const answers = args.answers
      .slice(0, MAX_ANSWERS)
      .map((one) => ({ question: clip(one.question, 120), answer: clip(one.answer, 2000) }))
      .filter((one) => one.question && one.answer);
    const link = clip(args.link, 300);
    const source = clip(args.source, 120);
    const newsletter = args.newsletter === true;
    const fields = {
      name,
      answers,
      newsletter,
      updatedAt: now,
      ...(link ? { link } : {}),
      ...(source ? { source } : {}),
    };
    const existing = await testerOf(ctx, email);
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...fields,
        newsletter: existing.newsletter || newsletter,
        timesApplied: existing.timesApplied + 1,
      });
    } else {
      // Someone who already has an account counts as joined straight away.
      const account = await ctx.runQuery(components.betterAuth.members.userByEmail, { email });
      await ctx.db.insert("betaTesters", {
        email,
        ...fields,
        status: account ? "joined" : "applied",
        timesApplied: 1,
        appliedAt: now,
        ...(account ? { userId: account.id, joinedAt: now } : {}),
      });
    }
    if (newsletter) {
      const one = await limiter.limit(ctx, "newsSignUpToAddress", { key: email });
      if (one.ok) {
        const needsConfirming = await requestConsent(ctx, {
          email,
          name,
          source: "website",
          wording: clip(args.newsletterWording, 300) || BETA_NEWSLETTER_WORDING,
          ...(args.userAgent ? { userAgent: clip(args.userAgent, 300) } : {}),
        });
        if (needsConfirming) {
          await ctx.scheduler.runAfter(0, internal.broadcasts.sendConfirmation, { email });
        }
      }
    }
    console.log(`beta: ${existing ? "updated" : "new"} sign-up`, { newsletter });
    return "ok";
  },
});

/** The words next to the newsletter box on the website, when the site doesn't send its own. */
export const BETA_NEWSLETTER_WORDING =
  "Send me Takewon news now and then. I'll confirm by email first, and can stop any time.";

/**
 * Someone made an account. If their address is on the beta list, they have joined: their
 * row says so, and the check-in is booked for a few days on.
 */
export const joined = internalMutation({
  args: { userId: v.string(), email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const tester = await testerOf(ctx, args.email);
    if (!tester) return false;
    if (tester.status === "joined" && tester.userId) return true;
    const now = Date.now();
    await ctx.db.patch(tester._id, {
      status: "joined",
      userId: args.userId,
      joinedAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(CHECK_IN_AFTER_MS, internal.email.sendBetaCheckIn, {
      testerId: tester._id,
    });
    return true;
  },
});

/**
 * Where they met the operator, when the form's "heard about it from" answer names one of
 * the events the operator spoke at ("The KINN", "a16z Tech Week Los Angeles"). Socials,
 * friends and "somewhere else" are not a meeting.
 */
export function metAtEvent(source: string): string | undefined {
  return /summit|tech week|kinn|hackathon|meetup|conference|event/i.test(source)
    ? source.trim()
    : undefined;
}

/** What the invite email needs, or null when this tester has an account already. */
export const inviteFor = internalQuery({
  args: { testerId: v.id("betaTesters") },
  returns: v.union(
    v.null(),
    v.object({ email: v.string(), name: v.string(), metAt: v.optional(v.string()) }),
  ),
  handler: async (ctx, args) => {
    const tester = await ctx.db.get(args.testerId);
    if (!tester || tester.status !== "invited") return null;
    const metAt = tester.source && metAtEvent(tester.source);
    return { email: tester.email, name: tester.name, ...(metAt ? { metAt } : {}) };
  },
});

/**
 * What the check-in email needs: who, and whether their team has had a video yet, so it
 * asks the right question. Null when it went already or they have no account.
 */
export const checkInFor = internalQuery({
  args: { testerId: v.id("betaTesters") },
  returns: v.union(
    v.null(),
    v.object({ email: v.string(), name: v.string(), uploaded: v.boolean() }),
  ),
  handler: async (ctx, args) => {
    const tester = await ctx.db.get(args.testerId);
    if (!tester || tester.status !== "joined" || !tester.userId || tester.checkInSentAt) {
      return null;
    }
    const teams = await ctx.runQuery(components.betterAuth.members.teamsFor, {
      userId: tester.userId,
    });
    let uploaded = false;
    for (const team of teams.slice(0, 5)) {
      const first = await ctx.db
        .query("uploads")
        .withIndex("by_organization", (q) => q.eq("organizationId", team.id))
        .first();
      if (first) {
        uploaded = true;
        break;
      }
    }
    return { email: tester.email, name: tester.name, uploaded };
  },
});

export const markCheckIn = internalMutation({
  args: { testerId: v.id("betaTesters") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.testerId, { checkInSentAt: now, updatedAt: now });
    return null;
  },
});

/** Deletes the beta sign-up for an address, when its account is deleted. */
export async function forgetBetaTester(ctx: MutationCtx, email: string): Promise<void> {
  const tester = await testerOf(ctx, email);
  if (tester) await ctx.db.delete(tester._id);
}

// The Admin page Beta Testers. Operator only.

export const counts = query({
  args: {},
  returns: v.object({ applied: v.number(), invited: v.number(), joined: v.number() }),
  handler: async (ctx) => {
    await requireOperator(ctx);
    const out = { applied: 0, invited: 0, joined: 0 };
    for (const key of Object.keys(out) as (keyof typeof out)[]) {
      const rows = await ctx.db
        .query("betaTesters")
        .withIndex("by_status", (q) => q.eq("status", key))
        .take(5000);
      out[key] = rows.length;
    }
    return out;
  },
});

export const list = query({
  args: {
    search: v.optional(v.string()),
    status: v.optional(status),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const search = args.search ? normalEmail(args.search) : "";
    const wanted = args.status;
    if (search) {
      return await ctx.db
        .query("betaTesters")
        .withIndex("by_email", (q) => q.gte("email", search).lt("email", `${search}￿`))
        .filter((q) => (wanted ? q.eq(q.field("status"), wanted) : true))
        .paginate(args.paginationOpts);
    }
    if (wanted) {
      return await ctx.db
        .query("betaTesters")
        .withIndex("by_status", (q) => q.eq("status", wanted))
        .order("desc")
        .paginate(args.paginationOpts);
    }
    return await ctx.db
      .query("betaTesters")
      .withIndex("by_updated")
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const get = query({
  args: { testerId: v.id("betaTesters") },
  handler: async (ctx, args): Promise<Doc<"betaTesters"> | null> => {
    await requireOperator(ctx);
    return await ctx.db.get(args.testerId);
  },
});

/**
 * Invites testers: each gets an email with a link to make their account. Asking again
 * sends the invite again. Someone who already joined is left alone. Returns how many
 * invites went out.
 */
export const invite = mutation({
  args: { testerIds: v.array(v.id("betaTesters")) },
  returns: v.number(),
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    if (args.testerIds.length > 200) {
      throw new ConvexError({ code: "too_many", message: "Invite up to 200 at a time." });
    }
    const now = Date.now();
    let sent = 0;
    for (const testerId of new Set<Id<"betaTesters">>(args.testerIds)) {
      const tester = await ctx.db.get(testerId);
      if (!tester || tester.status === "joined") continue;
      await ctx.db.patch(testerId, { status: "invited", invitedAt: now, updatedAt: now });
      await ctx.scheduler.runAfter(0, internal.email.sendBetaInvite, { testerId });
      sent += 1;
    }
    return sent;
  },
});
