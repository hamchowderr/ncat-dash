import { RequestContext } from '@mastra/core/request-context';
import { InMemoryStore } from '@mastra/core/storage';
import { getFunctionName } from 'convex/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatAgentController } from '../../src/mastra/lib/agent-controller';
import { TURN_USER_KEY, turnContextSections } from '../../src/mastra/lib/turn-context';
import { type DashClient, useDashClientForTests } from '../../src/mastra/ncat/convex';
import { forgetSessions, rememberSession } from '../../src/mastra/ncat/session-store';
import {
  forgetTeamBriefs,
  teamBriefFor,
  teamModelFor,
  teamSection,
} from '../../src/mastra/ncat/team-brief';
import { createControllerRoutes } from '../../src/mastra/routes/controller';
import type { ChatServerDeps } from '../../src/mastra/routes/types';
import { ctx, deps, find } from '../helpers/route-harness';

/**
 * A team's agent settings (Settings → Agent in the dashboard) reach the agent: read as the
 * person through `teamSettings.agentBrief`, told to the model after its instructions, and
 * the team's model used when the composer did not pick one.
 */

const RULES =
  "The team's house rules. Follow them in everything you build and say, unless the person asks otherwise in this conversation:\nNever all capitals.";

let brief: { model: string | null; text: string | null } = { model: null, text: null };
let asked: { name: string; args: unknown }[] = [];
let failing = false;

const fakeConvex = {
  query: async (ref: never, args: Record<string, unknown>) => {
    asked.push({ name: getFunctionName(ref), args });
    if (failing) throw new Error('offline');
    return brief;
  },
} as unknown as DashClient;

beforeAll(() => {
  useDashClientForTests(() => fakeConvex);
});
afterAll(() => {
  useDashClientForTests();
  forgetSessions();
});
beforeEach(() => {
  brief = { model: null, text: null };
  asked = [];
  failing = false;
  forgetTeamBriefs();
  forgetSessions();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const signedIn = (userId: string, organizationId = 'team_1') =>
  rememberSession(userId, { convexToken: 'a-token', organizationId, automationId: null });

describe("the team's agent settings", () => {
  it('are read as the person, for the team they are working in', async () => {
    signedIn('u-1');
    brief = { model: 'anthropic/claude-opus-5-5', text: RULES };
    expect(await teamBriefFor('u-1')).toEqual(brief);
    expect(asked).toEqual([
      { name: 'teamSettings:agentBrief', args: { organizationId: 'team_1' } },
    ]);
  });

  it('are asked for once in a while, not on every step of a turn', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    signedIn('u-1');
    await teamBriefFor('u-1');
    await teamBriefFor('u-1');
    expect(asked).toHaveLength(1);
    vi.setSystemTime(Date.now() + 31_000);
    await teamBriefFor('u-1');
    expect(asked).toHaveLength(2);
  });

  it('leave the agent as it is when nobody is signed in or they cannot be read', async () => {
    expect(await teamBriefFor(undefined)).toBeNull();
    expect(await teamBriefFor('u-unknown')).toBeNull();
    signedIn('u-1');
    failing = true;
    expect(await teamBriefFor('u-1')).toBeNull();
  });

  it("pick the team's model only when the server allows it", async () => {
    signedIn('u-1');
    brief = { model: 'anthropic/claude-opus-5-5', text: null };
    expect(await teamModelFor('u-1', new Set(['anthropic/claude-opus-5-5']))).toBe(
      'anthropic/claude-opus-5-5',
    );
    forgetTeamBriefs();
    expect(await teamModelFor('u-1', new Set(['anthropic/claude-sonnet-5-5']))).toBeNull();
  });

  it("give the turn the team's rules for the person asking", async () => {
    signedIn('u-1');
    brief = { model: null, text: RULES };
    const requestContext = new RequestContext();
    requestContext.set(TURN_USER_KEY, 'u-1');
    expect(await teamSection({ requestContext, now: new Date() })).toBe(RULES);
    expect(await teamSection({ requestContext: new RequestContext(), now: new Date() })).toBe(
      undefined,
    );
  });
});

/** Capture every request body sent to the model provider (AIMock's /v1/messages). */
function captureProviderRequests() {
  const sent: string[] = [];
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/v1/messages') && typeof init?.body === 'string') sent.push(init.body);
    return realFetch(input, init);
  });
  return sent;
}

/** POST /agent-controller/stream as `resourceId` on a real controller, on AIMock. */
async function postStream(resourceId: string, over: Partial<ChatServerDeps> = {}) {
  const controller = createChatAgentController({
    storage: new InMemoryStore(),
    resourceId,
    browser: null,
  });
  await controller.init();
  const session = await controller.createSession({ resourceId });
  try {
    const route = find(
      createControllerRoutes(
        deps({
          getSession: () => Promise.resolve(session),
          getAgentController: () =>
            Promise.resolve(
              controller as unknown as Awaited<ReturnType<ChatServerDeps['getAgentController']>>,
            ),
          ...over,
        }),
      ),
      '/agent-controller/stream',
      'POST',
    );
    const { c } = ctx({ body: { text: 'When is Friday?', timeZone: 'UTC' }, resourceId });
    const res = await route.handler(c);
    if (res instanceof Response) await res.text();
    return session.model.get();
  } finally {
    await controller.destroy();
  }
}

describe("the team's agent settings in a chat turn (AIMock)", () => {
  beforeAll(() => {
    turnContextSections.push(teamSection);
  });
  afterAll(() => {
    turnContextSections.splice(turnContextSections.indexOf(teamSection), 1);
  });

  it('tell the model the house rules after its instructions, and run on the team model', async () => {
    signedIn('u-turn');
    brief = { model: 'anthropic/claude-opus-5-5', text: RULES };
    const sent = captureProviderRequests();
    const allowed = new Set(['anthropic/claude-opus-5-5']);
    const model = await postStream('u-turn', {
      modelAllowlist: allowed,
      modelFor: (resourceId) => teamModelFor(resourceId, allowed),
    });

    expect(model).toBe('anthropic/claude-opus-5-5');
    const chat = sent
      .map((body) => JSON.parse(body) as { model: string; system?: string | { text: string }[] })
      .find((body) => JSON.stringify(body.system ?? '').includes('Current date and time'));
    expect(chat?.model).toBe('claude-opus-5-5');
    const system =
      typeof chat?.system === 'string'
        ? chat.system
        : (chat?.system ?? []).map((block) => block.text).join('\n');
    expect(system).toContain('Never all capitals.');
    expect(system.indexOf('Never all capitals.')).toBeGreaterThan(
      system.indexOf('Never fabricate tool results'),
    );
  });

  it("run on the server's model when the team has not chosen one", async () => {
    signedIn('u-default');
    const allowed = new Set(['anthropic/claude-opus-5-5']);
    const model = await postStream('u-default', {
      modelAllowlist: allowed,
      modelFor: (resourceId) => teamModelFor(resourceId, allowed),
    });
    expect(model).toBe('anthropic/claude-sonnet-4-6');
  });
});
