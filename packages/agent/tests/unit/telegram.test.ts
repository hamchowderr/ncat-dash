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
  TELEGRAM_BOT_TOKEN: undefined as string | undefined,
  TELEGRAM_BOT_USERNAME: undefined as string | undefined,
  TELEGRAM_API_URL: undefined as string | undefined,
}));
vi.mock('../../src/lib/env', () => ({ env }));

import { TURN_USER_KEY } from '../../src/mastra/lib/turn-user';
import { actionByPlatform, byPlatform, chatChannels, commandByPlatform } from '../../src/mastra/ncat/channels';
import { forgetSessions, sessionOf } from '../../src/mastra/ncat/session-store';
import {
  asTheTelegramWriter,
  chatOfThread,
  linkText,
  readDecision,
  refusalText,
  type TelegramPerson,
  telegramReady,
  useDashboardForTests,
} from '../../src/mastra/ncat/telegram';

// The agent in Telegram, on the dashboard's one bot: which chat a message is from, who
// on the team wrote it, linking from Settings with /start, and alert buttons.

afterEach(() => {
  useDashboardForTests();
  forgetSessions();
  for (const key of Object.keys(env) as (keyof typeof env)[]) env[key] = undefined;
});

const ADA: TelegramPerson = {
  ok: true,
  userId: 'u1',
  name: 'Ada',
  organizationId: 'team_1',
  convexToken: 'jwt-ada',
};

function message(user = '5550001', isBot = false) {
  return {
    raw: {},
    text: 'hi',
    attachments: [],
    author: { userId: user, isBot, isMe: false },
  } as never;
}
function thread(id = 'telegram:5550001') {
  return { id, post: vi.fn(async () => undefined) };
}
function context() {
  const values = new Map<string, unknown>();
  return { requestContext: { set: (k: string, v: unknown) => values.set(k, v) }, values };
}
function asking(answer: unknown) {
  const asked: { path: string; body: Record<string, string> }[] = [];
  useDashboardForTests((async (path: string, body: Record<string, string>) => {
    asked.push({ path, body });
    return answer;
  }) as never);
  return asked;
}

describe('which Telegram chat a message is from', () => {
  it('reads the chat from the thread; groups start with a minus', () => {
    expect(chatOfThread('telegram:5550001')).toEqual({ chatId: '5550001', isGroup: false });
    expect(chatOfThread('telegram:-1001234:7')).toEqual({ chatId: '-1001234', isGroup: true });
    expect(chatOfThread('discord:1:2')).toBeNull();
  });
});

describe('who the agent works for in Telegram', () => {
  it('acts as the linked teammate who wrote, asking with their chat and Telegram id', async () => {
    const asked = asking(ADA);
    const t = thread();
    const ctx = context();
    const next = vi.fn(async () => undefined);
    await asTheTelegramWriter(t as never, message(), next, ctx as never);
    expect(asked).toEqual([
      {
        path: '/telegram/person',
        body: { chatId: '5550001', telegramUserId: '5550001', isGroup: 'false' },
      },
    ]);
    expect(next).toHaveBeenCalledOnce();
    const resource = `channel:${t.id}`;
    expect(ctx.values.get(TURN_USER_KEY)).toBe(resource);
    expect(sessionOf(resource)).toMatchObject({ convexToken: 'jwt-ada', organizationId: 'team_1' });
  });

  it('in a group, says it is a group when asking', async () => {
    const asked = asking(ADA);
    await asTheTelegramWriter(thread('telegram:-100777') as never, message(), vi.fn(), context() as never);
    expect(asked[0].body).toMatchObject({ chatId: '-100777', isGroup: 'true' });
  });

  it('tells someone who has not linked their Telegram how to, and does nothing else', async () => {
    asking({ ok: false, reason: 'not_linked' });
    const t = thread();
    const next = vi.fn();
    await asTheTelegramWriter(t as never, message(), next, context() as never);
    expect(next).not.toHaveBeenCalled();
    expect(t.post).toHaveBeenCalledWith(expect.stringContaining('Link my Telegram'));
  });

  it('ignores bots, and says so plainly when the dashboard cannot be reached', async () => {
    asking(null);
    const t = thread();
    const next = vi.fn();
    await asTheTelegramWriter(t as never, message('9', true), next, context() as never);
    expect(t.post).not.toHaveBeenCalled();
    await asTheTelegramWriter(t as never, message(), next, context() as never);
    expect(t.post).toHaveBeenCalledWith(expect.stringContaining("can't reach the dashboard"));
    expect(next).not.toHaveBeenCalled();
  });

  it('every refusal is in plain words', () => {
    expect(refusalText({ ok: false, reason: 'not_connected' })).toMatch(/not linked to a team/);
    expect(refusalText({ ok: false, reason: 'refused', message: 'Trial over.' })).toBe('Trial over.');
    expect(refusalText(ADA)).toBe('');
  });
});

describe('replies to review posts in a group', () => {
  function reply(text = 'Trim the intro') {
    return {
      raw: { message_id: 42, reply_to_message: { message_id: 7 } },
      text,
      attachments: [],
      author: { userId: '5550001', isBot: false, isMe: false },
    } as never;
  }
  function answering(answers: Record<string, unknown>) {
    const asked: { path: string; body: Record<string, string> }[] = [];
    useDashboardForTests((async (path: string, body: Record<string, string>) => {
      asked.push({ path, body });
      return answers[path] ?? null;
    }) as never);
    return asked;
  }

  it('a reply to a review post goes into the review, and the agent stays out of it', async () => {
    const asked = answering({ '/telegram/review-reply': { handled: true, message: null } });
    const t = thread('telegram:-100777');
    const next = vi.fn();
    await asTheTelegramWriter(t as never, reply(), next, context() as never);
    expect(asked).toEqual([
      {
        path: '/telegram/review-reply',
        body: { chatId: '-100777', replyTo: '7', messageId: '42', telegramUserId: '5550001', text: 'Trim the intro' },
      },
    ]);
    expect(next).not.toHaveBeenCalled();
    expect(t.post).not.toHaveBeenCalled();
  });

  it('says why when a reply cannot go into the review', async () => {
    answering({ '/telegram/review-reply': { handled: true, message: 'Your reply stays in Telegram: link it.' } });
    const t = thread('telegram:-100777');
    await asTheTelegramWriter(t as never, reply(), vi.fn(), context() as never);
    expect(t.post).toHaveBeenCalledWith('Your reply stays in Telegram: link it.');
  });

  it('a reply to anything else is for the agent, as usual', async () => {
    const asked = answering({ '/telegram/review-reply': { handled: false, message: null }, '/telegram/person': ADA });
    const next = vi.fn(async () => undefined);
    await asTheTelegramWriter(thread('telegram:-100777') as never, reply(), next, context() as never);
    expect(asked.map((one) => one.path)).toEqual(['/telegram/review-reply', '/telegram/person']);
    expect(next).toHaveBeenCalledOnce();
  });

  it('direct chats never ask about reviews', async () => {
    const asked = answering({ '/telegram/person': ADA });
    await asTheTelegramWriter(
      thread() as never,
      reply(),
      vi.fn(async () => undefined),
      context() as never,
    );
    expect(asked.map((one) => one.path)).toEqual(['/telegram/person']);
  });
});

describe('linking from Settings with /start', () => {
  function command(text: string, chat: { id: number; type: string; title?: string }) {
    const channel = { id: `telegram:${chat.id}`, post: vi.fn(async () => undefined) };
    return {
      event: {
        command: '/start',
        text,
        channel,
        raw: {
          from: { id: 5550001, first_name: 'Ada', last_name: 'Lovelace', username: 'ada' },
          chat,
        },
      },
      channel,
    };
  }

  it('sends the code with who sent it, and says it worked', async () => {
    const asked = asking({ result: 'linked', teamName: 'Salt House' });
    const { event, channel } = command('abc123', { id: 5550001, type: 'private' });
    await commandByPlatform(event as never, vi.fn(), context() as never);
    expect(asked).toEqual([
      {
        path: '/telegram/link',
        body: {
          code: 'abc123',
          chatId: '5550001',
          telegramUserId: '5550001',
          isGroup: 'false',
          telegramName: 'Ada Lovelace',
          username: 'ada',
        },
      },
    ]);
    expect(channel.post).toHaveBeenCalledWith(expect.stringContaining("You're linked on Salt House"));
  });

  it('in a group, sends the group and its name', async () => {
    const asked = asking({ result: 'added', teamName: 'Salt House' });
    const { event, channel } = command('g0', {
      id: -100777,
      type: 'supergroup',
      title: 'Edit team',
    });
    await commandByPlatform(event as never, vi.fn(), context() as never);
    expect(asked[0].body).toMatchObject({
      chatId: '-100777',
      isGroup: 'true',
      chatTitle: 'Edit team',
    });
    expect(channel.post).toHaveBeenCalledWith(expect.stringContaining("I'm in this group now"));
  });

  it('with no code, says how to link, and never asks the agent', async () => {
    const asked = asking(null);
    const next = vi.fn();
    const { event, channel } = command('', { id: 5550001, type: 'private' });
    await commandByPlatform(event as never, next, context() as never);
    expect(asked).toEqual([]);
    expect(next).not.toHaveBeenCalled();
    expect(channel.post).toHaveBeenCalledWith(expect.stringContaining('Link my Telegram'));
  });

  it('commands from other apps go on as usual', async () => {
    const next = vi.fn(async () => undefined);
    await commandByPlatform(
      { command: '/x', text: '', channel: { id: 'slack:C1' } } as never,
      next,
      context() as never,
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('every answer is in plain words', () => {
    expect(linkText({ result: 'expired', teamName: null })).toMatch(/expired/);
    expect(linkText({ result: 'taken', teamName: null })).toMatch(/another team/);
    expect(linkText({ result: 'not_manager', teamName: null })).toMatch(/owner or admin/);
    expect(linkText(null)).toMatch(/can't reach/);
  });
});

describe('Approve and Send back on an alert', () => {
  function press(actionId: string) {
    const t = thread();
    return {
      event: { actionId, threadId: t.id, thread: t, user: { userId: '5550001' } },
      t,
    };
  }

  it('reads which button and which step', () => {
    expect(readDecision('ncat_approve:k57abc')).toEqual({
      decision: 'approve',
      runStepId: 'k57abc',
    });
    expect(readDecision('ncat_send_back:k57abc')).toEqual({
      decision: 'send_back',
      runStepId: 'k57abc',
    });
    expect(readDecision('tool_approve:1')).toBeNull();
  });

  it('asks the dashboard to decide as the person who pressed it', async () => {
    const asked = asking({ ok: true, message: 'Approved.' });
    const { event, t } = press('ncat_approve:k57abc');
    await actionByPlatform(event as never, vi.fn(), context() as never);
    expect(asked).toEqual([
      {
        path: '/telegram/decide',
        body: { runStepId: 'k57abc', telegramUserId: '5550001', decision: 'approve' },
      },
    ]);
    // The dashboard changes the alert itself; nothing more is posted.
    expect(t.post).not.toHaveBeenCalled();
  });

  it("says why when it can't be decided", async () => {
    asking({ ok: false, message: 'Someone has already decided this.' });
    const { event, t } = press('ncat_send_back:k57abc');
    await actionByPlatform(event as never, vi.fn(), context() as never);
    expect(t.post).toHaveBeenCalledWith('Someone has already decided this.');
  });

  it("leaves other buttons, like the agent's own approval cards, to the usual handling", async () => {
    const asked = asking(null);
    const next = vi.fn(async () => undefined);
    const { event } = press('tool_approve:call_1');
    await actionByPlatform(event as never, next, context() as never);
    expect(next).toHaveBeenCalledOnce();
    expect(asked).toEqual([]);
  });
});

describe('the Telegram bot on this server', () => {
  it('needs the token and a way to ask the dashboard', () => {
    expect(telegramReady()).toBe(false);
    env.TELEGRAM_BOT_TOKEN = '123:abc';
    expect(telegramReady()).toBe(false);
    env.MASTRA_JWT_SECRET = 's'.repeat(32);
    env.CONVEX_SITE_URL = 'https://site.test';
    expect(telegramReady()).toBe(true);
    const channels = chatChannels();
    expect(Object.keys(channels?.adapters ?? {}).sort()).toEqual(['slack', 'telegram']);
  });

  it('a Telegram message finds its writer the Telegram way', async () => {
    const asked = asking(ADA);
    const next = vi.fn(async () => undefined);
    await byPlatform(thread() as never, message(), next, context() as never);
    expect(asked[0].path).toBe('/telegram/person');
    expect(next).toHaveBeenCalledOnce();
  });
});
