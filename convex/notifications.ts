import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireMember } from "./lib/authz";
import {
  ALWAYS_RIGHT_AWAY,
  DEFAULT_DIGEST_HOUR,
  digestDue,
  NOTIFICATION_KINDS,
  preferenceOf,
  wants,
} from "./lib/notifications";

// Each member's own notification settings, per team: for every kind of news, whether it
// shows under the bell and whether it is emailed, and whether emails come as they happen
// or as one summary a day.

const kind = v.union(
  v.literal("run_failed"),
  v.literal("approval_waiting"),
  v.literal("approval_timed_out"),
  v.literal("mention"),
);

/** The person asking's notification settings on a team, with every kind spelled out. */
export const get = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const preference = await preferenceOf(ctx, args.organizationId, userId);
    const emailReady =
      Boolean(process.env.TOSEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim()) ||
      (await ctx.db.query("emailConnections").first()) !== null;
    return {
      kinds: NOTIFICATION_KINDS.map((entry) => ({
        kind: entry.kind,
        title: entry.title,
        description: entry.description,
        bell: wants(preference, entry.kind, "bell"),
        email: wants(preference, entry.kind, "email"),
        alwaysRightAway: ALWAYS_RIGHT_AWAY.includes(entry.kind),
      })),
      emailTiming: preference?.emailTiming ?? ("now" as const),
      digestHour: preference?.digestHour ?? DEFAULT_DIGEST_HOUR,
      timeZone: preference?.timeZone ?? null,
      emailReady,
    };
  },
});

/** Switches one kind of news on or off under the bell or by email, for the person asking. */
export const set = mutation({
  args: {
    organizationId: v.string(),
    kind,
    channel: v.union(v.literal("bell"), v.literal("email")),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const existing = await preferenceOf(ctx, args.organizationId, userId);
    const kinds = { ...existing?.kinds };
    kinds[args.kind] = { ...kinds[args.kind], [args.channel]: args.enabled };
    if (existing) await ctx.db.patch(existing._id, { kinds });
    else
      await ctx.db.insert("notificationPreferences", {
        organizationId: args.organizationId,
        userId,
        kinds,
      });
  },
});

/** Whether the person asking gets emails as they happen, or one summary a day at an hour of theirs. */
export const setEmailTiming = mutation({
  args: {
    organizationId: v.string(),
    emailTiming: v.union(v.literal("now"), v.literal("daily")),
    digestHour: v.optional(v.number()),
    timeZone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    if (
      args.digestHour !== undefined &&
      (!Number.isInteger(args.digestHour) || args.digestHour < 0 || args.digestHour > 23)
    ) {
      throw new ConvexError({ code: "invalid", message: "Pick an hour of the day." });
    }
    if (args.timeZone !== undefined && !knownZone(args.timeZone)) {
      throw new ConvexError({ code: "invalid", message: "That time zone is not one we know." });
    }
    const fields = {
      emailTiming: args.emailTiming,
      ...(args.digestHour !== undefined ? { digestHour: args.digestHour } : {}),
      ...(args.timeZone !== undefined ? { timeZone: args.timeZone } : {}),
    };
    const existing = await preferenceOf(ctx, args.organizationId, userId);
    // A summary covers what happened after the switch, not everything ever.
    const startFresh =
      args.emailTiming === "daily" && existing?.emailTiming !== "daily"
        ? { lastDigestAt: Date.now() }
        : {};
    if (existing) await ctx.db.patch(existing._id, { ...fields, ...startFresh });
    else {
      await ctx.db.insert("notificationPreferences", {
        organizationId: args.organizationId,
        userId,
        ...fields,
        ...startFresh,
      });
    }
  },
});

function knownZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run every hour: books the daily summary of each member whose hour it is, and moves
 * their `lastDigestAt` on first so a summary is never booked twice.
 */
export const bookDigests = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const daily = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_emailTiming", (q) => q.eq("emailTiming", "daily"))
      .take(1000);
    for (const preference of daily) {
      if (!digestDue(preference, now)) continue;
      const since = preference.lastDigestAt ?? now - 24 * 3_600_000;
      await ctx.db.patch(preference._id, { lastDigestAt: now });
      await ctx.scheduler.runAfter(0, internal.email.sendDigest, {
        preferenceId: preference._id,
        since,
        until: now,
      });
    }
  },
});
