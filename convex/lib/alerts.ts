import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";

/** An alert as it is written, without what the database adds or who has seen it. */
export type NewAlert = Omit<Doc<"alerts">, "_id" | "_creationTime" | "seenBy">;

/**
 * Tells people something: an entry under the bell for the members in `recipients` (the
 * whole team when it is left out), and the same news by email and in the chat apps they
 * linked (and the team's Teams channel, when it has one), for those who have not switched that off. Sending is an action of its own, so
 * a problem with email or a chat app never touches what raised the alert.
 */
export async function notify(ctx: MutationCtx, alert: NewAlert): Promise<Id<"alerts">> {
  const alertId = await ctx.db.insert("alerts", { ...alert, seenBy: [] });
  await ctx.scheduler.runAfter(0, internal.email.sendAlert, { alertId });
  await ctx.scheduler.runAfter(0, internal.chatAlerts.deliver, { alertId });
  // And to the team's Microsoft Teams channel, when it picked one.
  const teams = await ctx.db
    .query("teamsTenants")
    .withIndex("by_organization", (q) => q.eq("organizationId", alert.organizationId))
    .unique();
  if (teams?.alertConversationId) {
    await ctx.scheduler.runAfter(0, internal.microsoftTeams.postAlert, { alertId });
  }
  return alertId;
}

/** Whether an alert is for this member. */
export function isFor(alert: Pick<Doc<"alerts">, "recipients">, userId: string): boolean {
  return !alert.recipients || alert.recipients.includes(userId);
}
