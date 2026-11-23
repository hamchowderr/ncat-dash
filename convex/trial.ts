import { v } from "convex/values";

import { internalMutation, query } from "./_generated/server";
import { requireMember } from "./lib/authz";
import { UNKNOWN_NETWORK } from "./lib/clientIp";
import { emailKey } from "./lib/emailKey";
import {
  buyUrl,
  daysLeft,
  trialDays,
  trialEnd,
  trialOf,
  trialsPerNetwork,
} from "./lib/trial";

/**
 * A team's free trial, for the bar along the top and the agent: whether it has one, how
 * many days are left, and where to buy. `none` for a team without a trial (every team on
 * a self-hosted copy, and teams made before trials were on) and `paid` once it has bought.
 */
export const status = query({
  args: { organizationId: v.string() },
  returns: v.union(
    v.object({ kind: v.union(v.literal("none"), v.literal("paid")) }),
    v.object({
      kind: v.union(v.literal("trial"), v.literal("ended")),
      endsAt: v.number(),
      daysLeft: v.number(),
      buyUrl: v.union(v.null(), v.string()),
      // True when the team got no fresh days because its owner already had a trial.
      repeat: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const state = await trialOf(ctx, args.organizationId);
    if (state.kind === "none" || state.kind === "paid") return { kind: state.kind };
    return {
      kind: state.kind,
      endsAt: state.endsAt,
      daysLeft: daysLeft(state.endsAt),
      buyUrl: buyUrl(),
      repeat: state.repeat,
    };
  },
});

const NETWORK_WINDOW = 30 * 24 * 60 * 60 * 1000;

/**
 * Starts a new team's trial. Called when the team is made (see `organizationHooks` in
 * auth.ts). Does nothing while trials are off, or when the team already has one.
 *
 * A trial is one person's, not one team's: when the owner's mailbox (however it is
 * written) already had a trial, the new team shares what is left of it rather than
 * starting fresh; and once TRIALS_PER_NETWORK teams from one network have had trials in
 * 30 days, the next starts already over. A team whose earlier trial was bought is a
 * customer's, so it starts fresh.
 */
export const begin = internalMutation({
  args: {
    organizationId: v.string(),
    ownerId: v.optional(v.string()),
    ownerEmail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const days = trialDays();
    if (days === null) return null;
    const existing = await ctx.db
      .query("teamTrials")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    if (existing) return null;
    const startedAt = Date.now();
    const signUp = args.ownerId
      ? await ctx.db
          .query("signUps")
          .withIndex("by_user", (q) => q.eq("userId", args.ownerId!))
          .first()
      : null;
    const mailbox = signUp?.emailKey ?? (args.ownerEmail ? emailKey(args.ownerEmail) : null);
    const network =
      signUp && signUp.networkKey !== UNKNOWN_NETWORK ? signUp.networkKey : undefined;

    let endsAt = trialEnd(startedAt, days);
    let repeatOf: "email" | "network" | undefined;
    if (mailbox) {
      const earlier = await ctx.db
        .query("teamTrials")
        .withIndex("by_email_key", (q) => q.eq("emailKey", mailbox))
        .take(20);
      const unpaid = earlier.filter((trial) => trial.paidAt === undefined);
      if (unpaid.length > 0 && unpaid.length === earlier.length) {
        endsAt = Math.min(...unpaid.map((trial) => trial.endsAt));
        repeatOf = "email";
      }
    }
    if (!repeatOf && network) {
      const recent = await ctx.db
        .query("teamTrials")
        .withIndex("by_network_and_started", (q) =>
          q.eq("networkKey", network).gte("startedAt", startedAt - NETWORK_WINDOW),
        )
        .take(trialsPerNetwork());
      if (recent.length >= trialsPerNetwork()) {
        endsAt = startedAt;
        repeatOf = "network";
      }
    }
    await ctx.db.insert("teamTrials", {
      organizationId: args.organizationId,
      startedAt,
      endsAt,
      ...(args.ownerId ? { ownerId: args.ownerId } : {}),
      ...(mailbox ? { emailKey: mailbox } : {}),
      ...(network ? { networkKey: network } : {}),
      ...(repeatOf ? { repeatOf } : {}),
    });
    return null;
  },
});

/**
 * For the operator, once a team has bought:
 * `npx convex run trial:markPaid '{"organizationId":"..."}'`. The trial stops limiting it.
 */
export const markPaid = internalMutation({
  args: { organizationId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const trial = await ctx.db
      .query("teamTrials")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    if (!trial) return false;
    await ctx.db.patch(trial._id, { paidAt: Date.now() });
    return true;
  },
});

/**
 * For the operator, to give a team more time:
 * `npx convex run trial:extend '{"organizationId":"...","days":2}'`. Counts from now when
 * the trial has already ended, so the team really gets the days.
 */
export const extend = internalMutation({
  args: { organizationId: v.string(), days: v.number() },
  returns: v.union(v.null(), v.number()),
  handler: async (ctx, args) => {
    if (!(args.days > 0)) return null;
    const trial = await ctx.db
      .query("teamTrials")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    if (!trial) return null;
    const endsAt = trialEnd(Math.max(trial.endsAt, Date.now()), args.days);
    await ctx.db.patch(trial._id, { endsAt });
    return endsAt;
  },
});
