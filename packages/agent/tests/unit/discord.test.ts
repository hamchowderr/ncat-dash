import { afterEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  CONVEX_URL: undefined as string | undefined,
  CONVEX_SITE_URL: undefined as string | undefined,
  MASTRA_JWT_SECRET: undefined as string | undefined,
  SLACK_API_URL: undefined as string | undefined,
  DISCORD_BOT_TOKEN: undefined as string | undefined,
  DISCORD_APPLICATION_ID: undefined as string | undefined,
  DISCORD_PUBLIC_KEY: undefined as string | undefined,
  DISCORD_API_URL: undefined as string | undefined,
}));
vi.mock('../../src/lib/env', () => ({ env }));

import { TURN_USER_KEY } from '../../src/mastra/lib/turn-user';
import { byPlatform, chatChannels } from '../../src/mastra/ncat/channels';
import {
  asTheDiscordWriter,
  type DiscordPerson,
  discordReady,
  guildOfThread,
  refusalText,
  useDashboardForTests,
} from '../../src/mastra/ncat/discord';
import { forgetSessions, sessionOf } from '../../src/mastra/ncat/session-store';

// The agent in Discord, on the dashboard's one bot: which server a message is from, who
// on the team wrote it, and that Slack and Discord each find their writer their own way.

afterEach(() => {
  useDashboardForTests();
  forgetSessions();
  for (const key of Object.keys(env) as (keyof typeof env)[]) env[key] = undefined;
});

function message(user = '200000000000000001', isBot = false) {
  return { raw: {}, author: { userId: user, isBot, isMe: false } } as never;
}
function thread(id = 'discord:300000000000000001:400000000000000001') {
  return { id, post: vi.fn(async () => undefined) };
}
function context() {
  const values = new Map<string, unknown>();
  return { requestContext: { set: (k: string, v: unknown) => values.set(k, v) }, values };
}
const ADA: DiscordPerson = {
  ok: true,
  userId: 'u1',
  name: 'Ada',
  organizationId: 'team_1',
  convexToken: 'jwt-ada',
};

describe('which Discord server a message is from', () => {
  it('reads the server from the thread, and a direct message is @me', () => {
    expect(guildOfThread('discord:300:400')).toBe('300');
    expect(guildOfThread('discord:300:400:500')).toBe('300');
    expect(guildOfThread('discord:@me:400')).toBe('@me');
    expect(guildOfThread('slack:C1:123.4')).toBeNull();
  });
});

describe('who the agent works for in Discord', () => {
  it('acts as the linked teammate who wrote, asking with their server and Discord id', async () => {
    const asked: Record<string, string>[] = [];
    useDashboardForTests(async (body) => {
      asked.push(body);
      return ADA;
    });
    const t = thread();
    const ctx = context();
    const next = vi.fn(async () => undefined);
    await asTheDiscordWriter(t as never, message(), next, ctx as never);
    expect(asked).toEqual([
      { guildId: '300000000000000001', discordUserId: '200000000000000001' },
    ]);
    expect(next).toHaveBeenCalledOnce();
    const resource = `channel:${t.id}`;
    expect(ctx.values.get(TURN_USER_KEY)).toBe(resource);
    expect(sessionOf(resource)).toMatchObject({ convexToken: 'jwt-ada', organizationId: 'team_1' });
  });

  it('tells someone who has not linked their Discord how to, and does nothing else', async () => {
    useDashboardForTests(async () => ({ ok: false, reason: 'not_linked' }));
    const t = thread();
    const next = vi.fn();
    await asTheDiscordWriter(t as never, message(), next, context() as never);
    expect(next).not.toHaveBeenCalled();
    expect(t.post).toHaveBeenCalledWith(expect.stringContaining('Link my Discord'));
  });

  it('ignores bots, and says so plainly when the dashboard cannot be reached', async () => {
    useDashboardForTests(async () => null);
    const t = thread();
    const next = vi.fn();
    await asTheDiscordWriter(t as never, message('9', true), next, context() as never);
    expect(t.post).not.toHaveBeenCalled();
    await asTheDiscordWriter(t as never, message(), next, context() as never);
    expect(t.post).toHaveBeenCalledWith(expect.stringContaining("can't reach the dashboard"));
    expect(next).not.toHaveBeenCalled();
  });

  it('every refusal is in plain words', () => {
    expect(refusalText({ ok: false, reason: 'pick_server' })).toMatch(/more than one team/);
    expect(refusalText({ ok: false, reason: 'not_connected' })).toMatch(/not linked to a team/);
    expect(refusalText(ADA)).toBe('');
  });
});

describe('the chat apps the agent is in', () => {
  it('needs the whole bot and a way to ask the dashboard before joining Discord', () => {
    expect(discordReady()).toBe(false);
    env.DISCORD_BOT_TOKEN = 'bot-token';
    env.DISCORD_APPLICATION_ID = '1300000000000000001';
    env.DISCORD_PUBLIC_KEY = 'ab'.repeat(32);
    expect(discordReady()).toBe(false);
    env.MASTRA_JWT_SECRET = 's'.repeat(32);
    env.CONVEX_SITE_URL = 'https://site.test';
    expect(discordReady()).toBe(true);
    const channels = chatChannels();
    expect(Object.keys(channels?.adapters ?? {}).sort()).toEqual(['discord', 'slack']);
  });

  it('is in no chat app without a way to ask the dashboard', () => {
    expect(chatChannels()).toBeUndefined();
  });

  it('a Discord message finds its writer the Discord way', async () => {
    useDashboardForTests(async () => ADA);
    const next = vi.fn(async () => undefined);
    await byPlatform(thread() as never, message(), next, context() as never);
    expect(next).toHaveBeenCalledOnce();
  });
});
