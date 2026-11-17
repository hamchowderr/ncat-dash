import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { isFor } from "./lib/alerts";
import { requireMember } from "./lib/authz";
import { alertHref, preferenceOf, wants } from "./lib/notifications";

// The bell shows this many; older ones are still on each automation's list of runs.
const SHOWN = 30;

/**
 * The team's latest alerts for the person asking, newest first, with whether they have
 * seen each one, and how many they have not. An alert meant for certain members, such as
 * an approval waiting for its reviewers, is shown only to them, and a kind the person
 * switched off for the bell in their notification settings is not shown at all.
 */
export const list = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const preference = await preferenceOf(ctx, args.organizationId, userId);
    const alerts = await ctx.db
      .query("alerts")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(SHOWN * 3);
    const shown = alerts
      .filter((alert) => isFor(alert, userId) && wants(preference, alert.kind, "bell"))
      .slice(0, SHOWN)
      .map((alert) => ({
        _id: alert._id,
        kind: alert.kind,
        at: alert._creationTime,
        href: alertHref(alert),
        automationName: alert.automationName,
        stepName: alert.stepName ?? null,
        message: alert.message,
        retries: alert.retries,
        from: alert.from ?? null,
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
