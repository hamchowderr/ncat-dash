import { discordBotReady, editMessage, sendDirect } from "../discordApi";
import { discordAlert, discordKept, discordSettled } from "./chatFormats";
import type { ChatSender } from "./index";

/**
 * Alerts in Discord, from the dashboard's one bot: a direct message to each member who
 * linked their Discord on the team. Approve and Send back arrive over the agent server's
 * Gateway connection, which hands them to `/discord/alert-action`.
 *
 * A message is kept as "<DM channel>:<message id>".
 */
export const discordSender: ChatSender = {
  app: "discord",
  async isLinked(ctx, organizationId, userId) {
    if (!discordBotReady()) return false;
    const link = await ctx.db
      .query("discordPeople")
      .withIndex("by_member", (q) => q.eq("organizationId", organizationId).eq("userId", userId))
      .unique();
    return link !== null;
  },
  async targets(ctx, organizationId, userIds) {
    if (!discordBotReady()) return [];
    const links = await ctx.db
      .query("discordPeople")
      .withIndex("by_member", (q) => q.eq("organizationId", organizationId))
      .take(500);
    return links
      .filter((link) => userIds.includes(link.userId))
      .map((link) => ({ userId: link.userId, address: link.discordUserId }));
  },
  async send(_ctx, alert, target) {
    const sent = await sendDirect(target.address, discordAlert(alert));
    if (!sent) return null;
    return { ref: `${sent.channel}:${sent.message}`, text: discordKept(alert) };
  },
  async settle(_ctx, message, outcome) {
    const [channel, id] = message.ref.split(":");
    if (!channel || !id) return;
    await editMessage({ channel, message: id }, discordSettled(message.text, outcome));
  },
};
