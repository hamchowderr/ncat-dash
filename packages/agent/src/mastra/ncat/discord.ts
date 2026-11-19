import { createDiscordAdapter } from '@chat-adapter/discord';
import type { ChannelHandler } from '@mastra/core/channels';
import type { Message } from 'chat';
import { env } from '../../lib/env';
import { TURN_USER_KEY } from '../lib/turn-user';
import { rememberSession } from './session-store';
import { convexSiteUrl, signForDashboard } from './slack';
import { hearVoiceNotes } from './voice-notes';

/**
 * The agent in Discord, on the dashboard's ONE Discord bot (DISCORD_BOT_TOKEN,
 * DISCORD_APPLICATION_ID and DISCORD_PUBLIC_KEY here; whoever runs the dashboard sets it
 * up once). Teams add that bot to their own Discord server from Settings, which links the
 * server to the team. Normal messages only arrive over Discord's Gateway, a live
 * connection this long-running server keeps open; no interactions address is needed.
 *
 * Discord gives bots no email address, so each member links their own Discord account
 * once in Settings. Whoever writes is looked up by their Discord id on the team that owns
 * the server, and the agent acts in the dashboard as them, with their rights and nothing
 * more. Someone not linked gets a short answer saying how to link, and nothing else.
 */

export type DiscordPerson =
  | { ok: true; userId: string; name: string; organizationId: string; convexToken: string }
  | { ok: false; reason: 'not_connected' | 'not_linked' | 'pick_server' }
  // The dashboard says no to this reply: the trial is over, the team or person is
  // blocked, or they have sent a great many messages. `message` is what to tell them.
  | { ok: false; reason: 'refused'; message: string };

type Ask = (body: Record<string, string>) => Promise<DiscordPerson | null>;

const askDashboard: Ask = async (body) => {
  const site = convexSiteUrl();
  const secret = env.MASTRA_JWT_SECRET;
  if (!site || !secret) return null;
  try {
    const response = await fetch(`${site}/discord/person`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${signForDashboard(secret)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`The dashboard answered ${response.status}`);
    return (await response.json()) as DiscordPerson;
  } catch (error) {
    console.error('[discord] could not reach the dashboard', error);
    return null;
  }
};

let ask: Ask = askDashboard;

/** For tests: answer the dashboard's side without a deployment. Pass nothing to undo. */
export function useDashboardForTests(answer?: Ask): void {
  ask = answer ?? askDashboard;
}

/**
 * The Discord server a thread is in, from the Chat SDK thread id
 * `discord:{guildId}:{channelId}[:{threadId}]`. A direct message is "@me".
 */
export function guildOfThread(threadId: string): string | null {
  const [platform, guildId] = threadId.split(':');
  return platform === 'discord' && guildId ? guildId : null;
}

/** What someone the agent cannot help is told, where they wrote. */
export function refusalText(person: DiscordPerson | null): string {
  if (!person) return "I can't reach the dashboard right now. Try again in a minute.";
  if (person.ok) return '';
  switch (person.reason) {
    case 'refused':
      return person.message;
    case 'not_linked':
      return `I only work for people on the team who linked their Discord. Open Settings in the dashboard, press "Link my Discord", then write to me again.`;
    case 'pick_server':
      return "You're on more than one team, so I can't tell which one you mean here. Write to me in that team's Discord server instead.";
    default:
      return 'This Discord server is not linked to a team in the dashboard. A team owner can add me from Settings.';
  }
}

/**
 * Before the agent answers a Discord message: find who wrote it on the team, and let the
 * run act as them. Like Slack, the Mastra thread belongs to `channel:<thread id>`.
 */
export const asTheDiscordWriter: ChannelHandler = async (thread, message: Message, next, ctx) => {
  if (message.author.isBot || message.author.isMe) return;
  const guildId = guildOfThread(thread.id);
  const person = guildId ? await ask({ guildId, discordUserId: message.author.userId }) : null;
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
  // A voice note is read as the words said in it, by the team's own toolkit.
  await hearVoiceNotes(thread, message, person.organizationId);
  await next(thread, message);
};

/** Whether this server has the dashboard's Discord bot set up. */
export function discordReady(): boolean {
  return Boolean(
    env.DISCORD_BOT_TOKEN &&
      env.DISCORD_APPLICATION_ID &&
      env.DISCORD_PUBLIC_KEY &&
      env.MASTRA_JWT_SECRET &&
      convexSiteUrl(),
  );
}

/** The Discord adapter entry for the agent controller, or none without a bot. */
export function discordAdapter() {
  if (!discordReady()) return undefined;
  return {
    adapter: createDiscordAdapter({
      botToken: env.DISCORD_BOT_TOKEN,
      applicationId: env.DISCORD_APPLICATION_ID,
      publicKey: env.DISCORD_PUBLIC_KEY,
      ...(env.DISCORD_API_URL ? { apiUrl: env.DISCORD_API_URL } : {}),
    }),
    toolDisplay: 'hidden' as const,
    formatError: () => ({
      markdown: 'Something went wrong on my side and I stopped. Try asking again.',
    }),
  };
}
