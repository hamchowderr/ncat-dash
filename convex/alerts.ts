import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireMember } from "./lib/authz";

// The bell shows this many; older ones are still on each automation's list of runs.
const SHOWN = 30;

/**
 * The team's latest alerts, newest first, with whether the person asking has seen each
 * one, and how many they have not.
 */
export const list = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const alerts = await ctx.db
      .query("alerts")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(SHOWN);
    const shown = alerts.map((alert) => ({
      _id: alert._id,
      at: alert._creationTime,
      runId: alert.runId,
      automationId: alert.automationId,
      automationName: alert.automationName,
      stepName: alert.stepName ?? null,
      message: alert.message,
      retries: alert.retries,
      seen: alert.seenBy.includes(userId),
    }));
    return { alerts: shown, unseen: shown.filter((alert) => !alert.seen).length };
  },
});

/** Marks alerts as seen by the person asking: one, or all of the team's when none is named. */
export const markSeen = mutation({
  args: { organizationId: v.string(), alertId: v.optional(v.id("alerts")) },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const alerts = args.alertId
      ? [await ctx.db.get(args.alertId)]
      : await ctx.db
          .query("alerts")
          .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
          .order("desc")
          .take(SHOWN);
    for (const alert of alerts) {
      if (!alert || alert.organizationId !== args.organizationId) continue;
      if (alert.seenBy.includes(userId)) continue;
      await ctx.db.patch(alert._id, { seenBy: [...alert.seenBy, userId] });
    }
  },
});
