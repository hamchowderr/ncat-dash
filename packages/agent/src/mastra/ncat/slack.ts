import { createHmac, timingSafeEqual } from 'node:crypto';
import { createSlackAdapter } from '@chat-adapter/slack';
import type { AgentControllerChannelsConfig, ChannelHandler } from '@mastra/core/channels';
import type { Message } from 'chat';
import { env } from '../../lib/env';
import { TURN_USER_KEY } from '../lib/turn-user';
import { rememberSession } from './session-store';

/**
 * The agent in Slack, on each team's own Slack app: a regular self-managed Mastra
 * channel, with no Mastra Connect and nothing to pay for.
 *
 * Every team that connects Slack in the dashboard's Settings brings its own app, so one
 * Slack adapter serves them all. A request is matched to its workspace by the team id in
 * its body, checked with that workspace's own signing secret, and answered with that
 * workspace's own bot token. The dashboard keeps both (encrypted) and hands them over
 * only to a caller holding MASTRA_JWT_SECRET.
 *
 * Whoever writes to the agent is found on the team by their Slack email address, and the
 * agent acts in the dashboard as them, with their rights and nothing more. Someone the
 * team does not have gets a short answer saying so, and the agent does nothing.
 */

/** Slack refuses events older than this, and so do we. */
const TOLERANCE_S = 5 * 60;
/** How long a workspace's token and secret are kept before asking the dashboard again. */
const INSTALLATION_TTL_MS = 60_000;

export type Installation = {
  organizationId: string;
  botUserId: string;
  botToken: string;
  signingSecret: string;
};

export type SlackPerson =
  | { ok: true; userId: string; name: string; organizationId: string; convexToken: string }
  | { ok: false; reason: 'not_connected' | 'no_email' | 'not_member'; email: string | null };

/** Where the dashboard's HTTP actions answer. */
export function convexSiteUrl(): string | null {
  if (env.CONVEX_SITE_URL) return env.CONVEX_SITE_URL.replace(/\/$/, '');
  if (!env.CONVEX_URL) return null;
  const url = new URL(env.CONVEX_URL);
  if (url.hostname.endsWith('.convex.cloud')) {
    url.hostname = url.hostname.replace(/\.convex\.cloud$/, '.convex.site');
  } else if (url.port) {
    url.port = String(Number(url.port) + 1);
  }
  return url.origin;
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

/** A five-minute HS256 token, as the dashboard signs its own calls to us. */
export function signForDashboard(secret: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const body = `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(
    JSON.stringify({ sub: 'agent-server', iat, exp: iat + 300 }),
  )}`;
  return `${body}.${base64url(createHmac('sha256', secret).update(body).digest())}`;
}

type Ask = <T>(path: string, body: Record<string, string>) => Promise<T | null>;

const askDashboard: Ask = async (path, body) => {
  const site = convexSiteUrl();
  const secret = env.MASTRA_JWT_SECRET;
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
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`The dashboard answered ${response.status} for ${path}`);
    return (await response.json()) as never;
  } catch (error) {
    console.error('[slack] could not reach the dashboard', error);
    return null;
  }
};

let ask: Ask = askDashboard;

/** For tests: answer the dashboard's side without a deployment. Pass nothing to undo. */
export function useDashboardForTests(answer?: Ask): void {
  ask = answer ?? askDashboard;
  installations.clear();
}

const installations = new Map<string, { at: number; value: Installation | null }>();

export async function installationFor(slackTeamId: string): Promise<Installation | null> {
  const cached = installations.get(slackTeamId);
  if (cached && Date.now() - cached.at < INSTALLATION_TTL_MS) return cached.value;
  const value = await ask<Installation>('/slack/installation', { slackTeamId });
  installations.set(slackTeamId, { at: Date.now(), value });
  return value;
}

export async function personFor(slackTeamId: string, slackUserId: string) {
  return await ask<SlackPerson>('/slack/person', { slackTeamId, slackUserId });
}

/** The Slack workspace a request body comes from: events, buttons and slash commands. */
export function teamIdOfBody(body: string): string | null {
  const fromObject = (value: Record<string, unknown> | null | undefined): string | null => {
    if (!value) return null;
    if (typeof value.team_id === 'string') return value.team_id;
    const team = value.team as Record<string, unknown> | string | undefined;
    if (typeof team === 'string') return team;
    if (team && typeof team.id === 'string') return team.id;
    const user = value.user as Record<string, unknown> | undefined;
    if (user && typeof user.team_id === 'string') return user.team_id;
    return null;
  };
  const text = body.trim();
  if (text.startsWith('{')) {
    try {
      return fromObject(JSON.parse(text));
    } catch {
      return null;
    }
  }
  const form = new URLSearchParams(text);
  const payload = form.get('payload');
  if (payload) {
    try {
      return fromObject(JSON.parse(payload));
    } catch {
      return null;
    }
  }
  return form.get('team_id');
}

function isUrlCheck(body: string): boolean {
  try {
    return (JSON.parse(body) as { type?: unknown }).type === 'url_verification';
  } catch {
    return false;
  }
}

/**
 * Slack's own signature check, with the signing secret of the workspace the request
 * says it is from. Throws when the request is not from that workspace's app.
 *
 * Slack's one-time address check, sent while the app is created and before anyone has
 * pasted its secret into the dashboard, is let through: it carries no data, and the
 * answer is the challenge Slack sent.
 */
export async function verifySlackRequest(request: Request, body: string, now = Date.now()) {
  if (isUrlCheck(body)) return true;
  const teamId = teamIdOfBody(body);
  if (!teamId) throw new Error('No Slack workspace in the request');
  const installation = await installationFor(teamId);
  if (!installation) throw new Error(`Slack workspace ${teamId} is not connected`);
  const timestamp = request.headers.get('x-slack-request-timestamp') ?? '';
  const signature = request.headers.get('x-slack-signature') ?? '';
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > TOLERANCE_S) {
    throw new Error('Stale or missing Slack timestamp');
  }
  const expected = `v0=${createHmac('sha256', installation.signingSecret)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex')}`;
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    throw new Error('Bad Slack signature');
  }
  return true;
}

/** The workspace a Slack message came from. */
export function teamIdOfMessage(message: Message): string | null {
  const raw = message.raw as Record<string, unknown> | undefined;
  if (!raw) return null;
  if (typeof raw.team === 'string') return raw.team;
  if (typeof raw.team_id === 'string') return raw.team_id;
  const team = raw.team as Record<string, unknown> | undefined;
  return team && typeof team.id === 'string' ? team.id : null;
}

/** What someone the agent cannot help is told, in the thread they wrote in. */
export function refusalText(person: SlackPerson | null): string {
  if (!person) return "I can't reach the dashboard right now. Try again in a minute.";
  if (person.ok) return '';
  switch (person.reason) {
    case 'not_member':
      return `I only work for people on the team. Ask a team owner to invite ${person.email} in the dashboard, then write to me again.`;
    case 'no_email':
      return "I couldn't read your Slack email address, so I can't tell who you are on the team. Ask a team owner to check that the Slack app has the users:read.email permission.";
    default:
      return 'This Slack workspace is not connected to a team in the dashboard any more.';
  }
}

/**
 * Before the agent answers a message: find who wrote it on the team, and let the run act
 * as them. The Mastra thread for a Slack thread belongs to `channel:<thread id>`, so that
 * is where their sign-in goes; the next message, from whoever writes it, replaces it.
 */
export const asTheWriter: ChannelHandler = async (thread, message, next, ctx) => {
  if (message.author.isBot || message.author.isMe) return;
  const teamId = teamIdOfMessage(message);
  const person = teamId ? await personFor(teamId, message.author.userId) : null;
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
  await next(thread, message);
};

/** The Slack channel config for the agent controller, or none when the server cannot ask the dashboard. */
export function slackChannels(): AgentControllerChannelsConfig | undefined {
  if (!env.MASTRA_JWT_SECRET || !convexSiteUrl()) return undefined;
  const adapter = createSlackAdapter({
    webhookVerifier: verifySlackRequest,
    installationProvider: {
      getInstallation: async (installationId) => {
        const found = await installationFor(installationId);
        return found ? { botToken: found.botToken, botUserId: found.botUserId } : null;
      },
    },
    ...(env.SLACK_API_URL ? { apiUrl: env.SLACK_API_URL } : {}),
  });
  return {
    adapters: {
      slack: {
        adapter,
        toolDisplay: 'hidden',
        formatError: () => ({
          markdown: 'Something went wrong on my side and I stopped. Try asking again.',
        }),
      },
    },
    handlers: {
      onMention: asTheWriter,
      onDirectMessage: asTheWriter,
      onSubscribedMessage: asTheWriter,
    },
  };
}
