import type {
  ActionChannelHandler,
  AgentControllerChannelsConfig,
  ChannelHandler,
  SlashCommandChannelHandler,
} from '@mastra/core/channels';
import { onAlertButton } from './alert-buttons';
import { asTheDiscordWriter, discordAdapter } from './discord';
import { onReviewReply } from './review-replies';
import { asTheWriter, slackChannels } from './slack';
import { asTheTeamsWriter, onTeamsAlertButton, teamsAdapter, teamsReviewRepliesOnly } from './teams';
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

/** Approve and Send back on the dashboard's alerts: Discord's presses, then Teams'. */
export const onChatAlertButton: ActionChannelHandler = (event, next, ctx) =>
  onAlertButton(event, () => onTeamsAlertButton(event, next, ctx), ctx);

/** Button presses: Telegram's alert buttons are handled here; the rest by onChatAlertButton. */
export const actionByPlatform: ActionChannelHandler = async (event, defaultHandler, ctx) => {
  if (event.threadId?.startsWith('telegram:')) return await onTelegramAction(event, defaultHandler, ctx);
  return await onChatAlertButton(event, defaultHandler, ctx);
};

/** Untagged messages: a reply in a review's thread, in Discord or Teams. */
export const onReviewMessage: ChannelHandler = async (thread, message, next, ctx) => {
  if (thread.id.startsWith('teams:')) return await teamsReviewRepliesOnly(thread, message, next, ctx);
  return await onReviewReply(thread, message, next, ctx);
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
      // Telegram's alert buttons, then Approve and Send back on Discord and Teams alerts;
      // anything else as before.
      onAction: actionByPlatform,
      onSlashCommand: commandByPlatform,
      // Untagged messages: only teammates' replies in a review's Discord or Teams thread
      // are used, and they go to the review; nothing else.
      ...(discord || teams ? { onMessage: onReviewMessage } : {}),
    },
  };
}
