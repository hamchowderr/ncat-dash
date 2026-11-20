import type { AgentControllerChannelsConfig, ChannelHandler } from "@mastra/core/channels";
import { onAlertButton } from "./alert-buttons";
import { asTheDiscordWriter, discordAdapter } from "./discord";
import { onReviewReply } from "./review-replies";
import { asTheWriter, slackChannels } from "./slack";
import { asTheTeamsWriter, onTeamsAlertButton, teamsAdapter } from "./teams";

/**
 * The chat apps the agent answers in: Slack (each team's own app), and Discord and
 * Microsoft Teams (the dashboard's one bot each). Each is left out when it is not set up
 * on this server. Every message first finds who wrote it, the way that app allows.
 */
export const byPlatform: ChannelHandler = async (thread, message, next, ctx) => {
  if (thread.id.startsWith("discord:")) return await asTheDiscordWriter(thread, message, next, ctx);
  if (thread.id.startsWith("teams:")) return await asTheTeamsWriter(thread, message, next, ctx);
  return await asTheWriter(thread, message, next, ctx);
};

export function chatChannels(): AgentControllerChannelsConfig | undefined {
  const slack = slackChannels();
  const discord = discordAdapter();
  const teams = teamsAdapter();
  if (!slack && !discord && !teams) return undefined;
  return {
    adapters: {
      ...(slack?.adapters ?? {}),
      ...(discord ? { discord } : {}),
      ...(teams ? { teams } : {}),
    },
    handlers: {
      onMention: byPlatform,
      onDirectMessage: byPlatform,
      onSubscribedMessage: byPlatform,
      // Approve and Send back on the dashboard's alerts: Discord presses, then Teams
      // presses; anything else as before.
      onAction: (event, next, ctx) =>
        onAlertButton(event, () => onTeamsAlertButton(event, next, ctx), ctx),
      // Teammates' replies in a review's Discord thread go to the review; nothing else.
      ...(discord ? { onMessage: onReviewReply } : {}),
    },
  };
}
