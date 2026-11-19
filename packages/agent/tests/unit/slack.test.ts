import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  CONVEX_URL: undefined as string | undefined,
  CONVEX_SITE_URL: undefined as string | undefined,
  MASTRA_JWT_SECRET: undefined as string | undefined,
  SLACK_API_URL: undefined as string | undefined,
}));
vi.mock('../../src/lib/env', () => ({ env }));

import { TURN_USER_KEY } from '../../src/mastra/lib/turn-user';
import { forgetSessions, sessionOf } from '../../src/mastra/ncat/session-store';
import {
  asTheWriter,
  convexSiteUrl,
  refusalText,
  signForDashboard,
  type SlackPerson,
  teamIdOfBody,
  useDashboardForTests,
  verifySlackRequest,
} from '../../src/mastra/ncat/slack';

// The agent in Slack: which workspace a request is from, whether it is really from that
// workspace's own app, and who on the team the agent works for when someone writes to it.

const SECRET = '0123456789abcdef0123456789abcdef';
const installation = {
  organizationId: 'team_1',
  botUserId: 'U0BOT',
  botToken: 'xoxb-1',
  signingSecret: SECRET,
};

afterEach(() => {
  useDashboardForTests();
  forgetSessions();
  env.CONVEX_URL = undefined;
  env.CONVEX_SITE_URL = undefined;
});

function signed(body: string, secret = SECRET, at = Math.floor(Date.now() / 1000)) {
  const signature = `v0=${createHmac('sha256', secret).update(`v0:${at}:${body}`).digest('hex')}`;
  return new Request('http://agent.test/webhook', {
    method: 'POST',
    headers: { 'x-slack-request-timestamp': String(at), 'x-slack-signature': signature },
    body,
  });
}

describe('which workspace a request is from', () => {
  it('reads events, button presses and slash commands', () => {
    expect(teamIdOfBody(JSON.stringify({ type: 'event_callback', team_id: 'T1' }))).toBe('T1');
    const press = new URLSearchParams({ payload: JSON.stringify({ team: { id: 'T2' } }) });
    expect(teamIdOfBody(press.toString())).toBe('T2');
    expect(teamIdOfBody(new URLSearchParams({ team_id: 'T3' }).toString())).toBe('T3');
    expect(teamIdOfBody(JSON.stringify({ user: { team_id: 'T4' } }))).toBe('T4');
    expect(teamIdOfBody('{not json')).toBeNull();
    expect(teamIdOfBody(JSON.stringify({ type: 'event_callback' }))).toBeNull();
  });
});

describe("checking a request with that workspace's own signing secret", () => {
  const body = JSON.stringify({ type: 'event_callback', team_id: 'T1' });

  it("lets a request signed with the workspace's secret through", async () => {
    useDashboardForTests(async () => installation as never);
    await expect(verifySlackRequest(signed(body), body)).resolves.toBe(true);
  });

  it('refuses a wrong signature, an old request and an unknown workspace', async () => {
    useDashboardForTests(
      async (_path, { slackTeamId }) => (slackTeamId === 'T1' ? installation : null) as never,
    );
    await expect(verifySlackRequest(signed(body, 'f'.repeat(32)), body)).rejects.toThrow(
      /Bad Slack signature/,
    );
    const old = Math.floor(Date.now() / 1000) - 10 * 60;
    await expect(verifySlackRequest(signed(body, SECRET, old), body)).rejects.toThrow(/Stale/);
    const other = JSON.stringify({ type: 'event_callback', team_id: 'T9' });
    await expect(verifySlackRequest(signed(other), other)).rejects.toThrow(/not connected/);
  });

  it("lets Slack's one-time address check through before any secret is pasted", async () => {
    const asked = vi.fn(async () => null);
    useDashboardForTests(asked);
    const check = JSON.stringify({ type: 'url_verification', challenge: 'abc' });
    await expect(
      verifySlackRequest(new Request('http://agent.test', { method: 'POST' }), check),
    ).resolves.toBe(true);
    expect(asked).not.toHaveBeenCalled();
  });
});

describe('reaching the dashboard', () => {
  it('finds its HTTP actions from the Convex address', () => {
    env.CONVEX_URL = 'https://happy-otter-123.convex.cloud';
    expect(convexSiteUrl()).toBe('https://happy-otter-123.convex.site');
    env.CONVEX_URL = 'http://127.0.0.1:3210';
    expect(convexSiteUrl()).toBe('http://127.0.0.1:3211');
    env.CONVEX_SITE_URL = 'https://api.example.test/';
    expect(convexSiteUrl()).toBe('https://api.example.test');
  });

  it('signs a five-minute token the dashboard can check', () => {
    const token = signForDashboard('s'.repeat(32), 1_700_000_000_000);
    const [head, claims, signature] = token.split('.');
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      sub: 'agent-server',
      iat: 1_700_000_000,
      exp: 1_700_000_300,
    });
    expect(signature).toBe(
      createHmac('sha256', 's'.repeat(32)).update(`${head}.${claims}`).digest('base64url'),
    );
  });
});

describe('who the agent works for', () => {
  function message(user = 'U0ADA', isBot = false) {
    return {
      raw: { team: 'T1' },
      author: { userId: user, isBot, isMe: false },
    } as never;
  }
  function thread() {
    return { id: 'slack:C1:123.4', post: vi.fn(async () => undefined) };
  }
  function context() {
    const values = new Map<string, unknown>();
    return { requestContext: { set: (k: string, v: unknown) => values.set(k, v) }, values };
  }

  it('acts as the teammate who wrote, with their sign-in', async () => {
    useDashboardForTests(
      async () =>
        ({
          ok: true,
          userId: 'u1',
          name: 'Ada',
          organizationId: 'team_1',
          convexToken: 'jwt-ada',
        }) satisfies SlackPerson as never,
    );
    const t = thread();
    const ctx = context();
    const next = vi.fn(async () => undefined);
    await asTheWriter(t as never, message(), next, ctx as never);
    expect(next).toHaveBeenCalledOnce();
    expect(t.post).not.toHaveBeenCalled();
    const resource = `channel:${t.id}`;
    expect(ctx.values.get(TURN_USER_KEY)).toBe(resource);
    expect(sessionOf(resource)).toMatchObject({ convexToken: 'jwt-ada', organizationId: 'team_1' });
  });

  it('tells someone the team does not have, and does nothing else', async () => {
    useDashboardForTests(
      async () => ({ ok: false, reason: 'not_member', email: 'sam@elsewhere.test' }) as never,
    );
    const t = thread();
    const next = vi.fn();
    await asTheWriter(t as never, message('U0SAM'), next, context() as never);
    expect(next).not.toHaveBeenCalled();
    expect(t.post).toHaveBeenCalledWith(expect.stringContaining('invite sam@elsewhere.test'));
  });

  it('ignores bots, so it never answers itself', async () => {
    const asked = vi.fn();
    useDashboardForTests(asked);
    const t = thread();
    const next = vi.fn();
    await asTheWriter(t as never, message('U0BOT', true), next, context() as never);
    expect(asked).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(t.post).not.toHaveBeenCalled();
  });

  it('says plainly why it cannot help', () => {
    expect(refusalText(null)).toMatch(/can't reach the dashboard/);
    expect(refusalText({ ok: false, reason: 'no_email', email: null })).toMatch(/users:read.email/);
    expect(refusalText({ ok: false, reason: 'not_connected', email: null })).toMatch(
      /not connected/,
    );
  });

  it("passes on the dashboard's own words when it says no (trial over, blocked, too many)", () => {
    const message = 'Your free trial has ended, so nothing new starts.';
    expect(refusalText({ ok: false, reason: 'refused', email: null, message })).toBe(message);
  });
});
