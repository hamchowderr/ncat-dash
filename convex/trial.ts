import { v } from "convex/values";

import { internalMutation, query } from "./_generated/server";
import { requireMember } from "./lib/authz";
import { buyUrl, daysLeft, trialDays, trialEnd, trialOf } from "./lib/trial";

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
    }),
  ),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const state = await trialOf(ctx, args.organizationId);
    if (state.kind === "none" || state.kind === "paid") return { kind: state.kind };
    return { ...state, daysLeft: daysLeft(state.endsAt), buyUrl: buyUrl() };
  },
});

/**
 * Starts a new team's trial. Called when the team is made (see `organizationHooks` in
 * auth.ts). Does nothing while trials are off, or when the team already has one.
 */
export const begin = internalMutation({
  args: { organizationId: v.string() },
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
    await ctx.db.insert("teamTrials", {
      organizationId: args.organizationId,
      startedAt,
      endsAt: trialEnd(startedAt, days),
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
