import type { AgentController, Session } from '@mastra/core/agent-controller';
import { Mastra } from '@mastra/core/mastra';
import { InMemoryStore } from '@mastra/core/storage';
import { getFunctionName } from 'convex/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type DashClient, useDashClientForTests } from '../../src/mastra/ncat/convex';
import { forgetSessions, rememberSession } from '../../src/mastra/ncat/session-store';

/**
 * The dashboard's own tools, driven end to end through the stand-in model (AIMock):
 * the model's scripted tool calls go through the real AgentController, its approval
 * gates and the real tools. Only Convex is stood in for, by a client that writes down
 * what it was asked.
 *
 * As in demo-fixtures.test.ts, AIMock's journal proves each hop was answered by its own
 * fixture and never by the catch-all, which answers anything.
 */

const AIMOCK = 'http://127.0.0.1:4010';
const CATCH_ALL = 'reference assistant';
const USER = 'u-ncat';

type Entry = {
  path: string;
  response: {
    status: number;
    fixture: { match: Record<string, unknown>; response: unknown } | null;
  };
};
type Call = { kind: 'query' | 'mutation'; name: string; args: Record<string, unknown> };

let controller: AgentController;
let mastra: Mastra;
let autoAllowed: readonly string[] = [];
let calls: Call[] = [];

const described = { outline: 'Automation', problems: [], enabled: false, music: [] };

function answer(name: string): unknown {
  switch (name) {
    case 'automations:list':
      return [
        {
          _id: 'auto_1',
          name: 'Clips for social',
          enabled: true,
          stepCount: 2,
          trigger: { kind: 'upload' },
          lastRun: { status: 'done' },
        },
      ];
    case 'automations:create':
      return 'auto_new';
    case 'automations:describe':
    case 'automations:change':
      return described;
    default:
      throw new Error(`The stand-in for Convex has no answer for ${name}`);
  }
}

const fakeConvex = {
  query: async (ref: never, args: Record<string, unknown>) => {
    const name = getFunctionName(ref);
    calls.push({ kind: 'query', name, args });
    return answer(name);
  },
  mutation: async (ref: never, args: Record<string, unknown>) => {
    const name = getFunctionName(ref);
    calls.push({ kind: 'mutation', name, args });
    return answer(name);
  },
} as unknown as DashClient;

beforeAll(async () => {
  useDashClientForTests(() => fakeConvex);
  const { chatAgent } = await import('../../src/mastra/agents/chat');
  const ac = await import('../../src/mastra/lib/agent-controller');
  autoAllowed = ac.AUTO_ALLOWED_TOOLS;
  controller = ac.createChatAgentController({ storage: new InMemoryStore(), resourceId: USER });
  mastra = new Mastra({
    agents: { chat: chatAgent },
    agentControllers: { chat: controller },
    storage: new InMemoryStore(),
  });
  await controller.init();
}, 60_000);

afterAll(async () => {
  await controller?.destroy();
  await mastra?.shutdown();
  useDashClientForTests();
  forgetSessions();
});

beforeEach(() => {
  calls = [];
  forgetSessions();
  // What the dashboard hands over with each chat request: who, which team, what is open.
  rememberSession(USER, { convexToken: 'a-token', organizationId: 'team_1', automationId: null });
});

async function until(done: () => boolean, ms = 20_000) {
  const start = Date.now();
  while (!done()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Send one message on a fresh thread and answer every approval the same way. */
async function runFlow(prompt: string, decision: 'approve' | 'decline' = 'approve') {
  await fetch(`${AIMOCK}/__aimock/reset/journal`, { method: 'POST' });
  const session: Session = await controller.createSession({ resourceId: USER });
  for (const tool of autoAllowed) session.grantTool(tool);
  const asked: string[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: AgentControllerEvent union is wide
  const events: any[] = [];
  const unsubscribe = session.subscribe((event) => {
    events.push(event);
    if (event.type === 'tool_approval_required') {
      asked.push(event.toolName);
      session.respondToToolApproval({ decision, toolCallId: event.toolCallId });
    }
  });
  await session.thread.create();
  await session.sendMessage({ content: prompt }).catch(() => {});
  await until(() => !session.run.isRunning());
  await new Promise((r) => setTimeout(r, 300));
  unsubscribe();
  const journal = (await (await fetch(`${AIMOCK}/__aimock/journal`)).json()) as Entry[];
  return { events, journal, asked };
}

function expectOwnFixtures(journal: Entry[], hops: string[]) {
  expect(journal.length).toBeGreaterThan(0);
  for (const entry of journal) {
    expect(entry.response.status, `${entry.path} was not served`).toBe(200);
    expect(entry.response.fixture, `${entry.path} matched no fixture`).not.toBeNull();
    expect(JSON.stringify(entry.response.fixture?.response)).not.toContain(CATCH_ALL);
  }
  const hit = new Set(journal.map((entry) => entry.response.fixture?.match.toolCallId));
  for (const hop of hops) expect(hit, `the hop after ${hop} never ran`).toContain(hop);
}

const BUILD =
  'Build an automation that makes short clips with captions from each new recording I upload.';

describe("the dashboard's tools through the stand-in model", () => {
  it('looks at the automations without asking', async () => {
    const { journal, asked, events } = await runFlow(
      'List my automations and say which are switched on.',
    );
    expectOwnFixtures(journal, ['toolu_ncat_overview']);
    expect(asked).toEqual([]);
    expect(calls).toEqual([
      { kind: 'query', name: 'automations:list', args: { organizationId: 'team_1' } },
    ]);
    expect(JSON.stringify(events)).toContain('Clips for social');
  });

  it('asks before making an automation and before building it, then builds the new one', async () => {
    const { journal, asked } = await runFlow(BUILD);
    expectOwnFixtures(journal, ['toolu_ncat_create', 'toolu_ncat_build']);
    expect(asked).toEqual(['create_automation', 'change_automation']);
    expect(calls.map((call) => call.name)).toEqual(['automations:create', 'automations:change']);
    expect(calls[0]?.args).toEqual({ organizationId: 'team_1', name: 'Clips from new recordings' });
    // No automation was on screen, so the change lands on the one just made.
    expect(calls[1]?.args.automationId).toBe('auto_new');
    expect((calls[1]?.args.operations as { op: string }[]).map((o) => o.op)).toEqual([
      'trigger',
      'add',
      'add',
      'tidy',
    ]);
  });

  it('changes the automation on screen', async () => {
    rememberSession(USER, {
      convexToken: 'a-token',
      organizationId: 'team_1',
      automationId: 'auto_open',
    });
    const { journal, asked } = await runFlow(
      'Add captions to the clips before they go for approval.',
    );
    expectOwnFixtures(journal, ['toolu_ncat_add_captions']);
    expect(asked).toEqual(['change_automation']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args.automationId).toBe('auto_open');
  });

  it('makes nothing when the person declines', async () => {
    const { journal, asked, events } = await runFlow(BUILD, 'decline');
    expectOwnFixtures(journal, ['toolu_ncat_create']);
    expect(asked).toEqual(['create_automation']);
    expect(calls).toEqual([]);
    expect(JSON.stringify(events)).toContain('I did not make it, since you declined.');
  });

  it('says so plainly when the dashboard has not handed anything over', async () => {
    forgetSessions();
    const { events } = await runFlow('List my automations and say which are switched on.');
    expect(calls).toEqual([]);
    expect(JSON.stringify(events)).toContain('The dashboard has not said who is asking yet');
  });
});
