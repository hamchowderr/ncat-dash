import type { AgentControllerChannelsConfig, ChannelHandler } from '@mastra/core/channels';
import { onAlertButton } from './alert-buttons';
import { asTheDiscordWriter, discordAdapter } from './discord';
import { asTheWriter, slackChannels } from './slack';

/**
 * The chat apps the agent answers in: Slack (each team's own app) and Discord (the
 * dashboard's one bot). Each is left out when it is not set up on this server. Every
 * message first finds who wrote it, the way that app allows.
 */
export const byPlatform: ChannelHandler = async (thread, message, next, ctx) => {
  if (thread.id.startsWith('discord:')) return await asTheDiscordWriter(thread, message, next, ctx);
  return await asTheWriter(thread, message, next, ctx);
};

export function chatChannels(): AgentControllerChannelsConfig | undefined {
  const slack = slackChannels();
  const discord = discordAdapter();
  if (!slack && !discord) return undefined;
  return {
    adapters: {
      ...(slack?.adapters ?? {}),
      ...(discord ? { discord } : {}),
    },
    handlers: {
      onMention: byPlatform,
      onDirectMessage: byPlatform,
      onSubscribedMessage: byPlatform,
      // Approve and Send back on the dashboard's alerts; anything else as before.
      onAction: onAlertButton,
    },
  };
}
