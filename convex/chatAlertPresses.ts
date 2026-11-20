import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalQuery } from "./_generated/server";
import { decisionOf } from "./lib/chatAlerts/chatFormats";
import { decryptSecret } from "./lib/crypto";
import { emailOf, postEphemeral } from "./lib/slackApi";
import { slackSigned } from "./lib/slackSignature";

// Approve and Send back pressed on an alert in Slack or Discord. Each app says who
// pressed in its own way; that person is found on the alert's team, and the approval is
// decided as them through the one path every chat app shares (chatAlerts.decideFromChat).

/** The team an alert belongs to, or null when it is gone. */
export const alertTeam = internalQuery({
  args: { alertId: v.string() },
  handler: async (ctx, args) => {
    const alertId = ctx.db.normalizeId("alerts", args.alertId);
    const alert = alertId ? await ctx.db.get(alertId) : null;
    return alert ? { alertId: alert._id, organizationId: alert.organizationId } : null;
  },
});

type SlackPress = {
  type?: string;
  team?: { id?: string };
  user?: { id?: string };
  actions?: { action_id?: string; value?: string }[];
  container?: { channel_id?: string };
  channel?: { id?: string };
};

/**
 * A Slack button press the dashboard was sent: checked with the workspace's own signing
 * secret, then decided in the background, since Slack wants an answer in 3 seconds.
 * Returns the HTTP status to answer Slack with.
 */
export const takeSlackPress = internalAction({
  args: { body: v.string(), timestamp: v.string(), signature: v.string(), now: v.number() },
  handler: async (ctx, args): Promise<number> => {
    let press: SlackPress;
    try {
      press = JSON.parse(new URLSearchParams(args.body).get("payload") ?? "");
    } catch {
      return 400;
    }
    const slackTeamId = press.team?.id;
    if (press.type !== "block_actions" || !slackTeamId) return 200;
    const connection: Doc<"slackConnections"> | null = await ctx.runQuery(
      internal.slack.bySlackTeam,
      { slackTeamId },
    );
    if (!connection) return 404;
    const secret = await decryptSecret(connection.signingSecretCipher);
    if (!(await slackSigned(secret, args))) return 401;
    const action = (press.actions ?? []).find((one) => decisionOf(one.action_id ?? ""));
    const decision = decisionOf(action?.action_id ?? "");
    const slackUserId = press.user?.id;
    const channel = press.container?.channel_id ?? press.channel?.id;
    if (!decision || !action?.value || !slackUserId || !channel) return 200;
    await ctx.scheduler.runAfter(0, internal.chatAlertPresses.slackPress, {
      connectionId: connection._id,
      alertId: action.value,
      decision,
      slackUserId,
      channel,
    });
    return 200;
  },
});

export const connectionById = internalQuery({
  args: { connectionId: v.id("slackConnections") },
  handler: async (ctx, args) => await ctx.db.get(args.connectionId),
});

export const slackPress = internalAction({
  args: {
    connectionId: v.id("slackConnections"),
    alertId: v.string(),
    decision: v.union(v.literal("approve"), v.literal("send_back")),
    slackUserId: v.string(),
    channel: v.string(),
  },
  handler: async (ctx, args) => {
    const connection: Doc<"slackConnections"> | null = await ctx.runQuery(
      internal.chatAlertPresses.connectionById,
      { connectionId: args.connectionId },
    );
    if (!connection) return;
    const token = await decryptSecret(connection.botTokenCipher);
    const tell = (text: string) =>
      postEphemeral(token, { channel: args.channel, user: args.slackUserId, text });
    const alert = await ctx.runQuery(internal.chatAlertPresses.alertTeam, {
      alertId: args.alertId,
    });
    if (!alert || alert.organizationId !== connection.organizationId) {
      await tell("That alert is no longer in the dashboard.");
      return;
    }
    const email = await emailOf(token, args.slackUserId);
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: connection.organizationId,
    });
    const member = email ? team.members.find((one) => one.email.toLowerCase() === email) : null;
    if (!member) {
      await tell(
        email
          ? `Nothing was decided: ${email} is not on the team in the dashboard.`
          : "Nothing was decided: the dashboard could not read your Slack email address.",
      );
      return;
    }
    const answer = await ctx.runMutation(internal.chatAlerts.decideFromChat, {
      alertId: alert.alertId,
      userId: member.userId,
      decision: args.decision,
      channel: "slack",
    });
    if (!answer.ok) await tell(answer.message);
  },
});

export const discordLink = internalQuery({
  args: { discordUserId: v.string(), organizationId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("discordPeople")
      .withIndex("by_discord_user", (q) =>
        q.eq("discordUserId", args.discordUserId).eq("organizationId", args.organizationId),
      )
      .unique(),
});

/**
 * A Discord button press, handed over by the agent server (which holds the Gateway
 * connection Discord delivers presses on). The presser is whoever linked that Discord
 * account on the alert's team. Says how it went, for the agent to tell them if it failed.
 */
export const discordPress = internalAction({
  args: {
    alertId: v.string(),
    discordUserId: v.string(),
    decision: v.union(v.literal("approve"), v.literal("send_back")),
  },
  returns: v.object({ ok: v.boolean(), message: v.string() }),
  handler: async (ctx, args): Promise<{ ok: boolean; message: string }> => {
    const alert = await ctx.runQuery(internal.chatAlertPresses.alertTeam, {
      alertId: args.alertId,
    });
    if (!alert) return { ok: false, message: "That alert is no longer in the dashboard." };
    const link: Doc<"discordPeople"> | null = await ctx.runQuery(
      internal.chatAlertPresses.discordLink,
      { discordUserId: args.discordUserId, organizationId: alert.organizationId },
    );
    if (!link) {
      return {
        ok: false,
        message:
          'Nothing was decided: your Discord is not linked to this team. Open Settings in the dashboard and press "Link my Discord".',
      };
    }
    const answer: { ok: boolean; message: string } = await ctx.runMutation(
      internal.chatAlerts.decideFromChat,
      {
        alertId: alert.alertId,
        userId: link.userId,
        decision: args.decision,
        channel: "discord",
      },
    );
    return answer;
  },
});
