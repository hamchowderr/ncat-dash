import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type MutationCtx, internalMutation, internalQuery } from "./_generated/server";
import { preferenceOf, wants } from "./lib/notifications";

// The emails that follow a free trial between the welcome and the reminders that it ends
// (trial.ts): each one gives a single next step toward a first finished clip, and is only
// sent when the owner has not taken that step yet. Booked when the trial starts; the
// "clips ready" one when the team's first run with files finishes (alerts.runFinished).
// Each goes once, to the team's owner, and stops when they switch "Tips during my free
// trial" off in Settings > Notifications or press Unsubscribe.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const tip = v.union(
  v.literal("first_upload"),
  v.literal("clips_ready"),
  v.literal("every_upload"),
  v.literal("come_back"),
  v.literal("come_back_later"),
  v.literal("thanks"),
);

export type Tip =
  "first_upload" | "clips_ready" | "every_upload" | "come_back" | "come_back_later" | "thanks";

/** When each booked tip goes, from the trial's start and end. */
export function tipTimes(startedAt: number, endsAt: number): { tip: Tip; at: number }[] {
  const times: { tip: Tip; at: number }[] = [];
  if (startedAt + 3 * HOUR < endsAt) times.push({ tip: "first_upload", at: startedAt + 3 * HOUR });
  // Not when it would land beside the "ends tomorrow" reminder.
  if (startedAt + DAY < endsAt - DAY) times.push({ tip: "every_upload", at: startedAt + DAY });
  times.push({ tip: "come_back", at: endsAt + 4 * DAY });
  times.push({ tip: "come_back_later", at: endsAt + 11 * DAY });
  return times;
}

/** Books a fresh trial's tips. Called from trial.begin. */
export async function bookTips(
  ctx: MutationCtx,
  organizationId: string,
  startedAt: number,
  endsAt: number,
) {
  for (const { tip: which, at } of tipTimes(startedAt, endsAt)) {
    await ctx.scheduler.runAt(at, internal.email.sendTrialTip, { organizationId, tip: which });
  }
}

/**
 * Books the "clips ready" tip when a team on a free trial has its first run with files.
 * Called from alerts.runFinished; cheap when the team has no trial or already heard.
 */
export async function clipsReady(ctx: MutationCtx, organizationId: string, runId: Id<"runs">) {
  const trial = await ctx.db
    .query("teamTrials")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .unique();
  if (!trial || trial.paidAt !== undefined || trial.repeatOf !== undefined) return;
  if (Date.now() >= trial.endsAt) return;
  const sent = await ctx.db
    .query("trialTipsSent")
    .withIndex("by_organization_and_tip", (q) =>
      q.eq("organizationId", organizationId).eq("tip", "clips_ready"),
    )
    .first();
  if (sent) return;
  await ctx.scheduler.runAfter(0, internal.email.sendTrialTip, {
    organizationId,
    tip: "clips_ready",
    runId,
  });
}

/**
 * Who a tip goes to, or null when it should not go: the team bought (except for the
 * thanks), the tip went already, its owner switched tips off, or they already did what
 * it suggests.
 */
export const tipFor = internalQuery({
  args: { organizationId: v.string(), tip },
  returns: v.union(
    v.null(),
    v.object({ userId: v.string(), email: v.string(), name: v.string(), teamName: v.string() }),
  ),
  handler: async (ctx, args) => {
    const trial = await ctx.db
      .query("teamTrials")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    if (!trial?.ownerId || trial.repeatOf !== undefined) return null;
    const paid = trial.paidAt !== undefined;
    if (args.tip === "thanks" ? !paid : paid) return null;
    const sent = await ctx.db
      .query("trialTipsSent")
      .withIndex("by_organization_and_tip", (q) =>
        q.eq("organizationId", args.organizationId).eq("tip", args.tip),
      )
      .first();
    if (sent) return null;
    const now = Date.now();
    const running = now < trial.endsAt;

    if (args.tip !== "thanks") {
      const preference = await preferenceOf(ctx, args.organizationId, trial.ownerId);
      if (!wants(preference, "trial_tips", "email")) return null;
    }
    if (args.tip === "first_upload" || args.tip === "every_upload") {
      if (!running) return null;
      const uploads = await ctx.db
        .query("uploads")
        .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
        .take(50);
      const uploaded = uploads.some((upload) => upload.purpose !== "brand");
      if (args.tip === "first_upload" && uploaded) return null;
      if (args.tip === "every_upload") {
        if (!uploaded) return null;
        const automations = await ctx.db
          .query("automations")
          .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
          .take(100);
        if (automations.some((automation) => automation.enabled)) return null;
      }
    }
    if (args.tip === "clips_ready" && !running) return null;
    if ((args.tip === "come_back" || args.tip === "come_back_later") && running) return null;

    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: args.organizationId,
    });
    const owner = team.members.find((member) => member.userId === trial.ownerId);
    if (!owner || !team.teamName) return null;
    return { userId: owner.userId, email: owner.email, name: owner.name, teamName: team.teamName };
  },
});

/** Notes that a tip went, so it never goes twice. */
export const recordSent = internalMutation({
  args: { organizationId: v.string(), tip },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("trialTipsSent", { ...args, sentAt: Date.now() });
    return null;
  },
});
