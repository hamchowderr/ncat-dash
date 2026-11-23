import { createTelegramAdapter } from '@chat-adapter/telegram';
import type { ActionChannelHandler, ChannelHandler, SlashCommandChannelHandler } from '@mastra/core/channels';
import type { Message } from 'chat';
import { env } from '../../lib/env';
import { LONG_CACHE_KEY } from '../lib/cost';
import { TURN_USER_KEY } from '../lib/turn-user';
import { rememberSession } from './session-store';
import { convexSiteUrl, dashboardSecret, signForDashboard } from './slack';
import { hearVoiceNotes } from './voice-notes';

/**
 * The agent in Telegram, on the dashboard's ONE Telegram bot (TELEGRAM_BOT_TOKEN and
 * TELEGRAM_BOT_USERNAME here and on the dashboard; whoever runs the dashboard makes it
 * once in BotFather). This long-running server asks Telegram for new messages itself, so
 * the bot needs no public address.
 *
 * Telegram gives bots no email address, so each member links their Telegram once:
 * Settings opens the bot with a one-time code and pressing Start sends `/start <code>`
 * here, which the dashboard matches. A group is added the same way. Whoever writes is
 * then looked up and the agent acts in the dashboard as them, with their rights and
 * nothing more. Alerts arrive in each person's chat with the bot, and the Approve and
 * Send back buttons on them come back here and are decided on the dashboard.
 */

export type TelegramPerson =
  | { ok: true; userId: string; name: string; organizationId: string; convexToken: string }
  | { ok: false; reason: 'not_connected' | 'not_linked' }
  | { ok: false; reason: 'refused'; message: string };

export type LinkAnswer = {
  result: 'linked' | 'added' | 'expired' | 'not_member' | 'not_manager' | 'taken' | 'use_in_group' | 'use_in_private';
  teamName: string | null;
};

export type Decided = { ok: boolean; message: string };

type Ask = <T>(path: string, body: Record<string, string>) => Promise<T | null>;

const askDashboard: Ask = async <T>(path: string, body: Record<string, string>) => {
  const site = convexSiteUrl();
  const secret = dashboardSecret();
  if (!site || !secret) return null;
  try {
    const response = await fetch(`${site}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${signForDashboard(secret)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`The dashboard answered ${response.status}`);
    return (await response.json()) as T;
  } catch (error) {
    console.error('[telegram] could not reach the dashboard', error);
    return null;
  }
};

let ask: Ask = askDashboard;

/** For tests: answer the dashboard's side without a deployment. Pass nothing to undo. */
export function useDashboardForTests(answer?: Ask): void {
  ask = answer ?? askDashboard;
}

/**
 * The Telegram chat a thread is in, from the Chat SDK thread id `telegram:{chatId}` or
 * `telegram:{chatId}:{topicId}`. Groups have ids that start with "-".
 */
export function chatOfThread(threadId: string): { chatId: string; isGroup: boolean } | null {
  const [platform, chatId] = threadId.split(':');
  if (platform !== 'telegram' || !chatId || chatId === 'biz') return null;
  return { chatId, isGroup: chatId.startsWith('-') };
}

const SETTINGS_HINT = 'Open Settings in the dashboard, go to Telegram and press "Link my Telegram".';

/** What someone the agent cannot help is told, where they wrote. */
export function refusalText(person: TelegramPerson | null): string {
  if (!person) return "I can't reach the dashboard right now. Try again in a minute.";
  if (person.ok) return '';
  switch (person.reason) {
    case 'refused':
      return person.message;
    case 'not_linked':
      return `I only work for people on the team who linked their Telegram. ${SETTINGS_HINT}`;
    default:
      return 'This group is not linked to a team in the dashboard. A team owner can add me from Settings, under Telegram.';
  }
}

/** What the bot says after someone sends it a code from Settings. */
export function linkText(answer: LinkAnswer | null): string {
  if (!answer) return "I can't reach the dashboard right now. Try again in a minute.";
  const team = answer.teamName ? ` on ${answer.teamName}` : '';
  switch (answer.result) {
    case 'linked':
      return `You're linked${team}. Ask me anything about your automations, uploads and runs. Alerts you switched on in Settings will come here too.`;
    case 'added':
      return `I'm in this group now${team}. Tag me to ask for something. Only people who linked their Telegram in Settings can use me here.`;
    case 'expired':
      return 'That link has expired or was already used. Make a new one in Settings, under Telegram.';
    case 'not_member':
      return 'You are no longer on that team, so nothing was linked.';
    case 'not_manager':
      return 'Only a team owner or admin can add me to a group.';
    case 'taken':
      return 'This group is already linked to another team.';
    case 'use_in_group':
      return 'That link is for adding me to a group. Open it again and pick a group.';
    default:
      return 'That link is for your own chat with me. Open it from Settings on your phone or computer, not in a group.';
  }
}

/**
 * Before the agent answers a Telegram message: find who wrote it on the team, and let
 * the run act as them. Like Slack and Discord, the Mastra thread belongs to
 * `channel:<thread id>`.
 */
export const asTheTelegramWriter: ChannelHandler = async (thread, message: Message, next, ctx) => {
  if (message.author.isBot || message.author.isMe) return;
  const chat = chatOfThread(thread.id);
  // A reply in a group to one of the bot's posts about a review goes into the review room.
  if (chat?.isGroup && (await asReviewReply(thread, message, chat.chatId))) return;
  const person = chat
    ? await ask<TelegramPerson>('/telegram/person', {
        chatId: chat.chatId,
        telegramUserId: message.author.userId,
        isGroup: String(chat.isGroup),
      })
    : null;
  if (!person?.ok) {
    await thread.post(refusalText(person));
    return;
  }
  const resourceId = `channel:${thread.id}`;
  rememberSession(resourceId, {
    convexToken: person.convexToken,
    organizationId: person.organizationId,
    automationId: null,
  });
  ctx.requestContext.set(TURN_USER_KEY, resourceId);
  // Chat-app messages come minutes apart: keep the prompt cached an hour (lib/cost.ts).
  ctx.requestContext.set(LONG_CACHE_KEY, true);
  // A voice note is read as the words said in it, by the team's own toolkit.
  await hearVoiceNotes(thread, message, person.organizationId);
  await next(thread, message);
};

export type ReviewReplyAnswer = { handled: boolean; message: string | null };

type RawMessage = { message_id?: number; reply_to_message?: { message_id?: number } };

/**
 * When a group message replies to one of the bot's posts about a review, the dashboard
 * writes it into the review as the linked teammate's reply. Returns whether it was one,
 * so the agent does not also answer it.
 */
async function asReviewReply(thread: { post: (text: string) => Promise<unknown> }, message: Message, chatId: string) {
  const raw = (message.raw ?? {}) as RawMessage;
  const replyTo = raw.reply_to_message?.message_id;
  if (replyTo === undefined || raw.message_id === undefined) return false;
  const answer = await ask<ReviewReplyAnswer>('/telegram/review-reply', {
    chatId,
    replyTo: String(replyTo),
    messageId: String(raw.message_id),
    telegramUserId: message.author.userId,
    text: message.text,
  });
  if (!answer?.handled) return false;
  if (answer.message) await thread.post(answer.message);
  return true;
}

type RawCommand = {
  from?: { id?: number; first_name?: string; last_name?: string; username?: string };
  chat?: { id?: number; type?: string; title?: string };
};

/**
 * Commands sent to the bot. `/start <code>` links a person or group from Settings; with
 * no code it says how to link. Any other command is answered with how to use the bot,
 * never handed to the agent without knowing who sent it.
 */
export const onTelegramCommand: SlashCommandChannelHandler = async (event) => {
  const raw = (event.raw ?? {}) as RawCommand;
  const chat = raw.chat?.id !== undefined ? String(raw.chat.id) : chatOfThread(event.channel.id)?.chatId;
  const from = raw.from;
  if (event.command === '/start' && event.text.trim() && chat && from?.id !== undefined) {
    const isGroup = raw.chat?.type ? raw.chat.type !== 'private' : chat.startsWith('-');
    const name = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
    const answer = await ask<LinkAnswer>('/telegram/link', {
      code: event.text.trim().split(/\s+/)[0],
      chatId: chat,
      telegramUserId: String(from.id),
      isGroup: String(isGroup),
      telegramName: name || from.username || 'Telegram account',
      ...(from.username ? { username: from.username } : {}),
      ...(raw.chat?.title ? { chatTitle: raw.chat.title.slice(0, 64) } : {}),
    });
    await event.channel.post(linkText(answer));
    return;
  }
  if (event.command === '/start') {
    await event.channel.post(
      `Hi! I'm the agent from your team's dashboard. To use me, link your Telegram first. ${SETTINGS_HINT}`,
    );
    return;
  }
  await event.channel.post('Just write to me in plain words, or tag me in a group, and I will help.');
};

/** What pressing Approve or Send back on an alert sends: the decision and the step. */
export function readDecision(actionId: string): { decision: 'approve' | 'send_back'; runStepId: string } | null {
  for (const [prefix, decision] of [
    ['ncat_approve:', 'approve'],
    ['ncat_send_back:', 'send_back'],
  ] as const) {
    if (actionId.startsWith(prefix) && actionId.length > prefix.length) {
      return { decision, runStepId: actionId.slice(prefix.length) };
    }
  }
  return null;
}

/**
 * A button press in Telegram. Approve and Send back on an alert are decided on the
 * dashboard as the linked member who pressed it; the dashboard then changes the alert
 * to say how it ended. Anything else, such as the agent's own approval cards, goes to
 * the usual handling.
 */
export const onTelegramAction: ActionChannelHandler = async (event, defaultHandler) => {
  const pressed = readDecision(event.actionId);
  if (!pressed) return await defaultHandler();
  const answer = await ask<Decided>('/telegram/decide', {
    runStepId: pressed.runStepId,
    telegramUserId: event.user.userId,
    decision: pressed.decision,
  });
  // A decision that went through is shown on the alert itself, by the dashboard.
  if (answer?.ok) return;
  await event.thread?.post(answer?.message ?? "I can't reach the dashboard right now. Try again in a minute.");
};

/** Whether this server has the dashboard's Telegram bot set up. */
export function telegramReady(): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && dashboardSecret() && convexSiteUrl());
}

/** The Telegram adapter entry for the agent controller, or none without a bot. */
export function telegramAdapter() {
  if (!telegramReady()) return undefined;
  return {
    adapter: createTelegramAdapter({
      botToken: env.TELEGRAM_BOT_TOKEN,
      ...(env.TELEGRAM_BOT_USERNAME ? { userName: env.TELEGRAM_BOT_USERNAME.replace(/^@/, '') } : {}),
      ...(env.TELEGRAM_API_URL ? { apiUrl: env.TELEGRAM_API_URL } : {}),
      // This server stays up, so it asks Telegram for new messages: no webhook address.
      mode: 'polling',
      // In a group, replying to the bot counts as talking to it.
      mentionOnReply: true,
      longMessages: 'split',
    }),
    toolDisplay: 'hidden' as const,
    formatError: () => ({
      markdown: 'Something went wrong on my side and I stopped. Try asking again.',
    }),
  };
}
