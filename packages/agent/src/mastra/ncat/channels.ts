import type {
  ActionChannelHandler,
  AgentControllerChannelsConfig,
  ChannelHandler,
  SlashCommandChannelHandler,
} from '@mastra/core/channels';
import { asTheDiscordWriter, discordAdapter } from './discord';
import { asTheWriter, slackChannels } from './slack';
import { asTheTeamsWriter, teamsAdapter } from './teams';
import { asTheTelegramWriter, onTelegramAction, onTelegramCommand, telegramAdapter } from './telegram';

/**
 * The chat apps the agent answers in: Slack (each team's own app), and Discord, Microsoft
 * Teams and Telegram (the dashboard's one bot each). Each is left out when it is not set up
 * on this server. Every message first finds who wrote it, the way that app allows.
 */
export const byPlatform: ChannelHandler = async (thread, message, next, ctx) => {
  if (thread.id.startsWith('discord:')) return await asTheDiscordWriter(thread, message, next, ctx);
  if (thread.id.startsWith('teams:')) return await asTheTeamsWriter(thread, message, next, ctx);
  if (thread.id.startsWith('telegram:')) return await asTheTelegramWriter(thread, message, next, ctx);
  return await asTheWriter(thread, message, next, ctx);
};

/** Button presses: Telegram's alert buttons are handled here; the rest as usual. */
export const actionByPlatform: ActionChannelHandler = async (event, defaultHandler, ctx) => {
  if (event.threadId?.startsWith('telegram:')) return await onTelegramAction(event, defaultHandler, ctx);
  return await defaultHandler();
};

/** Commands: Telegram's /start links a person or group; the rest as usual. */
export const commandByPlatform: SlashCommandChannelHandler = async (event, defaultHandler, ctx) => {
  if (event.channel?.id?.startsWith('telegram:')) return await onTelegramCommand(event, defaultHandler, ctx);
  return await defaultHandler();
};

export function chatChannels(): AgentControllerChannelsConfig | undefined {
  const slack = slackChannels();
  const discord = discordAdapter();
  const teams = teamsAdapter();
  const telegram = telegramAdapter();
  if (!slack && !discord && !teams && !telegram) return undefined;
  return {
    adapters: {
      ...(slack?.adapters ?? {}),
      ...(discord ? { discord } : {}),
      ...(teams ? { teams } : {}),
      ...(telegram ? { telegram } : {}),
    },
    handlers: {
      onMention: byPlatform,
      onDirectMessage: byPlatform,
      onSubscribedMessage: byPlatform,
      onAction: actionByPlatform,
      onSlashCommand: commandByPlatform,
    },
  };
}
