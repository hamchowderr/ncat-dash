import { ConvexError, v } from "convex/values";

import { internalMutation, mutation, query } from "./_generated/server";
import { notify } from "./lib/alerts";
import { requireMember } from "./lib/authz";
import { WARN_DAYS, addDays, cleanCreator, dayOf, isDay, rightsMessage } from "./lib/creatorRights";

/**
 * Usage rights per creator: how long the team may use the footage a creator filmed for
 * them. Anyone on the team can set them in Settings > Creators. A week before the last
 * day, a daily check tells everyone on the team, under Inbox, by email and in the chat
 * apps they linked (Slack, Discord, Telegram, and the team's Teams channel).
 */

function refuse(message: string): never {
  throw new ConvexError({ code: "invalid", message });
}

/** The team's creators with an end date, soonest first, and creator folder names seen. */
export const list = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const rows = await ctx.db
      .query("creatorRights")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(500);
    rows.sort((a, b) => a.endsOn.localeCompare(b.endsOn) || a.creator.localeCompare(b.creator));

    // Creators whose folders started runs lately, to pick from when adding one.
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(300);
    const kept = new Set(rows.map((row) => row.creator.toLowerCase()));
    const seen = new Map<string, string>();
    for (const run of runs) {
      const creator = (run.trigger as { creator?: unknown } | null)?.creator;
      if (typeof creator !== "string") continue;
      const name = cleanCreator(creator);
      if (name && !kept.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    }

    return {
      creators: rows.map((row) => ({
        id: row._id,
        creator: row.creator,
        endsOn: row.endsOn,
        note: row.note ?? "",
        alerted: row.alertedFor === row.endsOn,
      })),
      seen: [...seen.values()].sort((a, b) => a.localeCompare(b)),
    };
  },
});

/** Adds a creator's end date, or changes one. A changed date can be alerted about again. */
export const save = mutation({
  args: {
    organizationId: v.string(),
    id: v.optional(v.id("creatorRights")),
    creator: v.string(),
    endsOn: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const creator = cleanCreator(args.creator);
    if (!creator) refuse("Add the creator's name.");
    if (creator.length > 80) refuse("Keep the name under 80 characters.");
    if (!isDay(args.endsOn)) refuse("Pick the last day their footage may be used.");
    const note = args.note?.trim().slice(0, 300) || undefined;

    const rows = await ctx.db
      .query("creatorRights")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(500);
    const same = rows.find(
      (row) => row.creator.toLowerCase() === creator.toLowerCase() && row._id !== args.id,
    );
    if (same) refuse(`${same.creator} already has an end date. Change that one instead.`);

    const fields = {
      creator,
      endsOn: args.endsOn,
      note,
      updatedBy: userId,
      updatedAt: Date.now(),
    };
    if (args.id) {
      const row = rows.find((one) => one._id === args.id);
      if (!row) refuse("That creator is no longer here.");
      await ctx.db.patch(row._id, {
        ...fields,
        alertedFor: row.alertedFor === args.endsOn ? row.alertedFor : undefined,
      });
      return row._id;
    }
    return await ctx.db.insert("creatorRights", {
      organizationId: args.organizationId,
      ...fields,
    });
  },
});

export const remove = mutation({
  args: { organizationId: v.string(), id: v.id("creatorRights") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const row = await ctx.db.get(args.id);
    if (!row || row.organizationId !== args.organizationId) return;
    await ctx.db.delete(row._id);
  },
});

/**
 * Once a day: every creator whose rights end within a week, and who has not been
 * alerted about for that date, raises one alert for the whole team.
 */
export const checkEnding = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const today = dayOf(args.now ?? Date.now());
    const due = await ctx.db
      .query("creatorRights")
      .withIndex("by_ends", (q) => q.gte("endsOn", today).lte("endsOn", addDays(today, WARN_DAYS)))
      .take(1000);
    let sent = 0;
    for (const row of due) {
      if (row.alertedFor === row.endsOn) continue;
      await notify(ctx, {
        organizationId: row.organizationId,
        kind: "rights_ending",
        automationName: row.creator,
        message: rightsMessage(row.endsOn, today),
        retries: 0,
      });
      await ctx.db.patch(row._id, { alertedFor: row.endsOn });
      sent += 1;
    }
    return sent;
  },
});
