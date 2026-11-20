import { components, internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import { decryptSecret } from "../crypto";
import { postBlocks, slackUserByEmail, updateBlocks } from "../slackApi";
import { slackAlert, slackSettled, slackText } from "./chatFormats";
import type { ChatSender } from "./index";

/**
 * Alerts in Slack, through the team's own Slack app: a direct message to each member
 * whose dashboard email is in the team's Slack workspace (that is how Slack people are
 * known; there is nothing to link). Approve and Send back come back through
 * `/slack/actions` (convex/chatAlertPresses.ts).
 *
 * A message is kept as "<workspace id>:<conversation>:<ts>".
 */
export const slackSender: ChatSender = {
  app: "slack",
  async isLinked(ctx, organizationId) {
    const connection = await ctx.db
      .query("slackConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .unique();
    return connection !== null;
  },
  async targets(ctx, organizationId, userIds) {
    const connection = await ctx.db
      .query("slackConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .unique();
    if (!connection) return [];
    const team = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId,
    });
    return team.members
      .filter((member) => userIds.includes(member.userId) && member.email)
      .map((member) => ({ userId: member.userId, address: member.email }));
  },
  async send(ctx, alert, target) {
    const connection: Doc<"slackConnections"> | null = await ctx.runQuery(
      internal.chatAlertPresses.slackConnectionOf,
      { organizationId: alert.organizationId },
    );
    if (!connection) return null;
    const token = await decryptSecret(connection.botTokenCipher);
    const slackUserId = await slackUserByEmail(token, target.address);
    if (!slackUserId) return null;
    const sent = await postBlocks(token, { channel: slackUserId, ...slackAlert(alert) });
    if (!sent) return null;
    return { ref: `${connection.slackTeamId}:${sent.channel}:${sent.ts}`, text: slackText(alert) };
  },
  async settle(ctx, message, outcome) {
    const [slackTeamId, channel, ts] = message.ref.split(":");
    if (!slackTeamId || !channel || !ts) return;
    const connection: Doc<"slackConnections"> | null = await ctx.runQuery(
      internal.slack.bySlackTeam,
      { slackTeamId },
    );
    if (!connection) return;
    const token = await decryptSecret(connection.botTokenCipher);
    await updateBlocks(token, { channel, ts }, slackSettled(message.text, outcome));
  },
};
