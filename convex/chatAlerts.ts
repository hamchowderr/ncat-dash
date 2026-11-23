import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { isFor } from "./lib/alerts";
import { type ChatAlert, type ChatTarget, SENDERS, senderFor, wordAlert } from "./lib/chatAlerts";
import { alertHref, preferenceOf, wants, type ChatApp } from "./lib/notifications";
import { decideApproval } from "./lib/runner";

// Alerts in chat apps (Telegram, Slack, Discord, Teams): who gets one where, sending it,
// approving from a button, and changing the messages once an approval is decided. How
// each app sends is in convex/lib/chatAlerts/<app>.ts.

const chatApp = v.union(
  v.literal("telegram"),
  v.literal("slack"),
  v.literal("discord"),
  v.literal("teams"),
);

/** The dashboard's own address for a path, as links in chat apps need it whole. */
export function siteUrl(path: string): string {
  return `${(process.env.SITE_URL ?? "").replace(/\/+$/, "")}${path}`;
}

/** An alert worded for chat apps, and where each app should send it. */
export const plan = internalQuery({
  args: { alertId: v.id("alerts") },
  handler: async (
    ctx,
    args,
  ): Promise<{ alert: ChatAlert; sends: { app: ChatApp; targets: ChatTarget[] }[] } | null> => {
    const alert = await ctx.db.get(args.alertId);
    if (!alert) return null;
    if (SENDERS.length === 0) return null;
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: alert.organizationId,
    });
    const wanting = new Map<ChatApp, string[]>();
    for (const member of team.members) {
      if (!isFor(alert, member.userId)) continue;
      const preference = await preferenceOf(ctx, alert.organizationId, member.userId);
      for (const sender of SENDERS) {
        if (!wants(preference, alert.kind, sender.app)) continue;
        wanting.set(sender.app, [...(wanting.get(sender.app) ?? []), member.userId]);
      }
    }
    const sends: { app: ChatApp; targets: ChatTarget[] }[] = [];
    for (const sender of SENDERS) {
      const userIds = wanting.get(sender.app) ?? [];
      if (userIds.length === 0) continue;
      const targets = await sender.targets(ctx, alert.organizationId, userIds);
      if (targets.length > 0) sends.push({ app: sender.app, targets });
    }
    return { alert: wordAlert(alert, siteUrl(alertHref(alert))), sends };
  },
});

/**
 * Sends an alert to every chat app that should have it. Booked by `notify`. One app
 * failing never stops the others, and nothing here touches what raised the alert.
 */
export const deliver = internalAction({
  args: { alertId: v.id("alerts") },
  handler: async (ctx, args) => {
    const planned = await ctx.runQuery(internal.chatAlerts.plan, { alertId: args.alertId });
    if (!planned) return;
    for (const { app, targets } of planned.sends) {
      const sender = senderFor(app);
      if (!sender) continue;
      for (const target of targets) {
        let sent = null;
        try {
          sent = await sender.send(ctx, planned.alert, target);
        } catch (error) {
          console.warn(`Could not send a ${app} alert`, error);
        }
        if (!sent) continue;
        await ctx.runMutation(internal.chatAlerts.record, {
          organizationId: planned.alert.organizationId,
          alertId: args.alertId,
          runStepId: planned.alert.runStepId,
          app,
          userId: target.userId,
          ref: sent.ref,
          text: sent.text,
        });
      }
    }
  },
});

export const record = internalMutation({
  args: {
    organizationId: v.string(),
    alertId: v.id("alerts"),
    runStepId: v.optional(v.id("runSteps")),
    app: chatApp,
    userId: v.optional(v.string()),
    ref: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    // Decided while it was being sent: say so on this message straight away.
    const step = args.runStepId ? await ctx.db.get(args.runStepId) : null;
    const id = await ctx.db.insert("chatAlertMessages", args);
    if (step && step.status !== "waiting_approval" && args.runStepId) {
      await ctx.scheduler.runAfter(0, internal.chatAlerts.settle, { runStepId: args.runStepId });
    }
    return id;
  },
});

/**
 * Approves or sends back an approval from a button in a chat app. Each app's webhook
 * finds which member pressed it (their linked account) and calls this. The same rules as
 * the run page apply: the reviewers it names, or a team owner or admin, may decide.
 * Returns what to tell the person.
 */
export const decideFromChat = internalMutation({
  args: {
    runStepId: v.id("runSteps"),
    userId: v.string(),
    decision: v.union(v.literal("approve"), v.literal("send_back")),
    app: chatApp,
  },
  handler: async (ctx, args): Promise<{ ok: boolean; message: string }> => {
    const step = await ctx.db.get(args.runStepId);
    if (!step) return { ok: false, message: "This approval no longer exists." };
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: step.organizationId,
    });
    if (!team.members.some((member) => member.userId === args.userId)) {
      return { ok: false, message: "You are no longer on this team." };
    }
    if (step.status !== "waiting_approval") {
      return { ok: false, message: "Someone has already decided this." };
    }
    try {
      await decideApproval(ctx, step, args.decision === "approve", args.userId);
    } catch (error) {
      if (error instanceof ConvexError) {
        const data = error.data as { message?: string } | string;
        return {
          ok: false,
          message: typeof data === "string" ? data : (data.message ?? "That did not work."),
        };
      }
      throw error;
    }
    return { ok: true, message: args.decision === "approve" ? "Approved." : "Sent back." };
  },
});

/** The messages sent about an approval that still show their buttons, and how it ended. */
export const toSettle = internalQuery({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.runStepId);
    if (!step || step.status === "waiting_approval") return null;
    const messages = (
      await ctx.db
        .query("chatAlertMessages")
        .withIndex("by_runStep", (q) => q.eq("runStepId", args.runStepId))
        .take(100)
    ).filter((message) => message.settledAt === undefined);
    if (messages.length === 0) return null;
    let by: string | null = null;
    if (step.decidedBy) {
      const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
        organizationId: step.organizationId,
      });
      by = team.members.find((member) => member.userId === step.decidedBy)?.name ?? null;
    }
    const approved = step.status === "done";
    const outcome = step.decidedAutomatically
      ? `${approved ? "Approved" : "Sent back"} by itself: nobody decided in time.`
      : `${approved ? "Approved" : "Sent back"}${by ? ` by ${by}` : ""}.`;
    return {
      outcome,
      messages: messages.map((message) => ({
        _id: message._id,
        app: message.app,
        ref: message.ref,
        text: message.text,
      })),
    };
  },
});

/**
 * Once an approval is decided, from the dashboard or any app, changes every chat message
 * about it to say how it ended, without its buttons. Booked by `decideApproval`.
 */
export const settle = internalAction({
  args: { runStepId: v.id("runSteps") },
  handler: async (ctx, args) => {
    const found = await ctx.runQuery(internal.chatAlerts.toSettle, { runStepId: args.runStepId });
    if (!found) return;
    const done: Id<"chatAlertMessages">[] = [];
    for (const message of found.messages) {
      const sender = senderFor(message.app);
      try {
        await sender?.settle?.(ctx, { ref: message.ref, text: message.text }, found.outcome);
      } catch (error) {
        console.warn(`Could not change a ${message.app} alert`, error);
      }
      done.push(message._id);
    }
    await ctx.runMutation(internal.chatAlerts.markSettled, { ids: done });
  },
});

export const markSettled = internalMutation({
  args: { ids: v.array(v.id("chatAlertMessages")) },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const id of args.ids) await ctx.db.patch(id, { settledAt: now });
  },
});
