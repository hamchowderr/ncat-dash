import type { AgentControllerChannelsConfig, ChannelHandler } from '@mastra/core/channels';
import { asTheDiscordWriter, discordAdapter } from './discord';
import { asTheWriter, slackChannels } from './slack';
import { asTheTeamsWriter, teamsAdapter } from './teams';

/**
 * The chat apps the agent answers in: Slack (each team's own app), and Discord and
 * Microsoft Teams (the dashboard's one bot each). Each is left out when it is not set up
 * on this server. Every message first finds who wrote it, the way that app allows.
 */
export const byPlatform: ChannelHandler = async (thread, message, next, ctx) => {
  if (thread.id.startsWith('discord:')) return await asTheDiscordWriter(thread, message, next, ctx);
  if (thread.id.startsWith('teams:')) return await asTheTeamsWriter(thread, message, next, ctx);
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
    },
  };
}
