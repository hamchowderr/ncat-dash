import { InMemoryStore } from '@mastra/core/storage';
import { getFunctionName } from 'convex/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatAgentController } from '../../src/mastra/lib/agent-controller';
import { type DashClient, useDashClientForTests } from '../../src/mastra/ncat/convex';
import { screenKey, screenSignal } from '../../src/mastra/ncat/screen';
import {
  type DashScreen,
  forgetSessions,
  rememberSession,
} from '../../src/mastra/ncat/session-store';
import { createControllerRoutes } from '../../src/mastra/routes/controller';
import type { ChatServerDeps } from '../../src/mastra/routes/types';
import { ctx, deps, find } from '../helpers/route-harness';

/**
 * What the person has open in the dashboard reaches the agent as a `screen` state signal
 * (ncat/screen.ts): described as the person through `agentScreen.describe`, sent again
 * only when the screen changes.
 */

const DESCRIPTION =
  'What the person has open in the dashboard right now:\nThe automation "Clips for Northwind" (id a1). It is off, starts when a file is uploaded, and has 3 steps.';

let asked: { name: string; args: unknown }[] = [];
let answer: string | null = DESCRIPTION;
let failing = false;

const fakeConvex = {
  query: async (ref: never, args: Record<string, unknown>) => {
    asked.push({ name: getFunctionName(ref), args });
    if (failing) throw new Error('offline');
    return answer;
  },
} as unknown as DashClient;

beforeAll(() => useDashClientForTests(() => fakeConvex));
afterAll(() => {
  useDashClientForTests();
  forgetSessions();
});
beforeEach(() => {
  asked = [];
  answer = DESCRIPTION;
  failing = false;
  forgetSessions();
});
afterEach(() => vi.restoreAllMocks());

const onScreen = (resourceId: string, screen: DashScreen | null, organizationId = 'team_1') =>
  rememberSession(resourceId, { convexToken: 'a-token', organizationId, automationId: null, screen });

const fresh = { hasSnapshot: false };
const kept = { hasSnapshot: true };

describe('what is on screen, as a state signal', () => {
  it('describes the thing on screen, read as the person for their team', async () => {
    onScreen('u-1~team_1', { kind: 'automation', id: 'a1' });
    const signal = await screenSignal({ resourceId: 'u-1~team_1', contextWindow: fresh });
    expect(signal).toMatchObject({
      mode: 'snapshot',
      cacheKey: 'team_1/automation/a1',
      contents: DESCRIPTION,
      value: { kind: 'automation', id: 'a1' },
    });
    expect(asked).toEqual([
      {
        name: 'agentScreen:describe',
        args: { organizationId: 'team_1', kind: 'automation', id: 'a1' },
      },
    ]);
  });

  it('says nothing more while the screen is the same and the model still has it', async () => {
    onScreen('u-1~team_1', { kind: 'automation', id: 'a1' });
    const tracking = { currentCacheKey: 'team_1/automation/a1' };
    expect(
      await screenSignal({ resourceId: 'u-1~team_1', contextWindow: kept, tracking }),
    ).toBeUndefined();
    expect(asked).toEqual([]);
    // Once the last snapshot has left the model's context, it is sent again.
    expect(
      await screenSignal({ resourceId: 'u-1~team_1', contextWindow: fresh, tracking }),
    ).toMatchObject({ contents: DESCRIPTION });
  });

  it('sends a new snapshot when the person opens something else', async () => {
    onScreen('u-1~team_1', { kind: 'library', id: 'item7' });
    answer = 'What the person has open in the dashboard right now:\nThe video "Episode 12".';
    const signal = await screenSignal({
      resourceId: 'u-1~team_1',
      contextWindow: kept,
      tracking: { currentCacheKey: 'team_1/automation/a1' },
    });
    expect(signal).toMatchObject({ cacheKey: 'team_1/library/item7' });
    expect(signal?.contents).toContain('Episode 12');
  });

  it('says once that nothing is open any more, and nothing when nothing ever was', async () => {
    onScreen('u-1~team_1', null);
    expect(
      await screenSignal({
        resourceId: 'u-1~team_1',
        contextWindow: kept,
        tracking: { currentCacheKey: 'team_1/automation/a1' },
      }),
    ).toMatchObject({ cacheKey: 'none', contents: expect.stringContaining('no longer') });
    expect(await screenSignal({ resourceId: 'u-1~team_1', contextWindow: fresh })).toBeUndefined();
    expect(
      await screenSignal({
        resourceId: 'u-1~team_1',
        contextWindow: kept,
        tracking: { currentCacheKey: 'none' },
      }),
    ).toBeUndefined();
  });

  it('keeps the bare fact of what is open when the dashboard cannot describe it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    onScreen('u-1~team_1', { kind: 'run', id: 'r9' });
    failing = true;
    expect(
      (await screenSignal({ resourceId: 'u-1~team_1', contextWindow: fresh }))?.contents,
    ).toBe('What the person has open in the dashboard right now: a run (id r9).');
  });

  it('has nothing for a chat in Slack or Discord, which has no screen', async () => {
    rememberSession('channel:slack:C1:1.2', {
      convexToken: 'a-token',
      organizationId: 'team_1',
      automationId: null,
    });
    expect(
      await screenSignal({ resourceId: 'channel:slack:C1:1.2', contextWindow: fresh }),
    ).toBeUndefined();
    expect(await screenSignal({ resourceId: 'nobody', contextWindow: fresh })).toBeUndefined();
  });

  it('keys the cache to the team and the thing on screen', () => {
    expect(screenKey({ organizationId: 'team_1', screen: { kind: 'run', id: 'r9' } })).toBe(
      'team_1/run/r9',
    );
    expect(screenKey({ organizationId: null, screen: { kind: 'run', id: 'r9' } })).toBe('none');
    expect(screenKey({ organizationId: 'team_1', screen: null })).toBe('none');
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

describe('what is on screen reaches the model (AIMock)', () => {
  it('goes along with the question, through the real stream route', async () => {
    const resourceId = 'u-screen~team_1';
    onScreen(resourceId, { kind: 'automation', id: 'a1' });
    const sent = captureProviderRequests();
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
          }),
        ),
        '/agent-controller/stream',
        'POST',
      );
      const { c } = ctx({ body: { text: 'Screen test: what do I have open?' } });
      const res = await route.handler(c);
      expect(res).toBeInstanceOf(Response);
      const text = await (res as Response).text();
      expect(text).toContain('You have the automation Clips for Northwind open.');
    } finally {
      await controller.destroy();
    }
    const chat = sent.find((body) => body.includes('Screen test: what do I have open?'));
    expect(chat).toBeDefined();
    expect(chat).toContain('Clips for Northwind');
    expect(chat).toContain('type=\\"screen\\"');
  });
});
