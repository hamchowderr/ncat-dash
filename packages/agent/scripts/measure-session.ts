/**
 * pnpm measure:session — what one agent chat session really costs, on a REAL model.
 *
 * Runs scripted conversations through the real AgentController, tools, approvals and
 * memory (titles, observational memory), the way the dashboard does. Only Convex is
 * stood in for, by a dashboard in memory built on the real step catalog and automation
 * logic (@ncat-dash/automation-core), so the tool answers are the size they are in
 * production. Every call to Anthropic is read off the wire, and its cost worked out
 * from the usage Anthropic reports and the published prices (PRICES below).
 *
 * It spends real tokens (a few cents a session), so it is NOT part of CI:
 *
 *   infisical run --path=/shared -- pnpm --filter @ncat-dash/agent measure:session
 *
 * SESSIONS=build,question picks the conversations (default both). CHAT_MODEL picks the
 * building model, as on the server.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(tmpdir(), 'ncat-session-cost-'));
process.env.NODE_ENV ??= 'development';
process.env.USE_AIMOCK = 'false';
process.env.CHAT_MODEL ??= 'anthropic/claude-sonnet-5-5';
process.env.TURSO_DATABASE_URL = `file:${path.join(scratch, 'session.db').replace(/\\/g, '/')}`;
process.env.WORKSPACE_ROOT = path.join(scratch, 'workspace');
process.env.APP_SECRET ??= randomBytes(32).toString('hex');
process.env.CONVEX_URL ??= 'https://stand-in.convex.cloud';
process.env.WORKSPACE_BROWSER ??= 'false';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is missing. Run this through `infisical run` (see header).');
  process.exit(1);
}

// ---------------------------------------------------------------------------------------
// Every Anthropic call, read off the wire.

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
};
type Call = { session: string; model: string; what: string; usage: Usage };

const calls: Call[] = [];
let current = '';

/** What a call was for, from its system prompt. */
function purposeOf(body: { system?: unknown }): string {
  const system = JSON.stringify(body.system ?? '');
  if (system.includes('builder inside a dashboard')) return 'agent';
  if (/observ|reflect/i.test(system)) return 'memory notes';
  if (system.includes('title')) return 'title';
  return 'other';
}

function mergeUsage(into: Usage, from: Usage | undefined) {
  if (!from) return;
  for (const [k, v] of Object.entries(from)) {
    if (typeof v === 'number') (into as Record<string, number>)[k] = v;
    else if (v && typeof v === 'object')
      (into as Record<string, unknown>)[k] = { ...((into as Record<string, object>)[k] ?? {}), ...v };
  }
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const response = await realFetch(input, init);
  if (!url.startsWith('https://api.anthropic.com/v1/messages') || url.includes('count_tokens'))
    return response;
  let body: { model?: string; system?: unknown } = {};
  try {
    body = JSON.parse(String(init?.body ?? '{}'));
  } catch {}
  if (process.env.DUMP_DIR) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path.join(process.env.DUMP_DIR, `${String(calls.length + 1).padStart(3, '0')}.json`), String(init?.body ?? ''));
  }
  const call: Call = {
    session: current,
    model: body.model ?? '?',
    what: purposeOf(body),
    usage: {},
  };
  calls.push(call);
  const copy = response.clone();
  void (async () => {
    const text = await copy.text().catch(() => '');
    if ((response.headers.get('content-type') ?? '').includes('event-stream')) {
      for (const line of text.split('\n')) {
        if (!line.startsWith('data:')) continue;
        try {
          const event = JSON.parse(line.slice(5));
          mergeUsage(call.usage, event.message?.usage ?? event.usage);
        } catch {}
      }
    } else {
      try {
        mergeUsage(call.usage, JSON.parse(text).usage);
      } catch {}
    }
  })();
  return response;
};

// ---------------------------------------------------------------------------------------
// Prices, US dollars per million tokens (Anthropic's published rates, November 2026).

const PRICES: Record<string, { input: number; output: number; read: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10, read: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, read: 0.01 },
  'claude-haiku-4-5': { input: 1, output: 5, read: 0.1 },
  'claude-opus-5-5': { input: 4, output: 20, read: 0.2 },
};

export function costOf(model: string, u: Usage): number {
  const price = PRICES[model];
  if (!price) return Number.NaN;
  const oneHour = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const fiveMinutes = (u.cache_creation_input_tokens ?? 0) - oneHour;
  return (
    ((u.input_tokens ?? 0) * price.input +
      fiveMinutes * price.input * 1.25 +
      oneHour * price.input * 2 +
      (u.cache_read_input_tokens ?? 0) * price.read +
      (u.output_tokens ?? 0) * price.output) /
    1_000_000
  );
}

// ---------------------------------------------------------------------------------------
// A dashboard in memory, built on the real automation logic.

// By a path held in a variable, so the agent's typecheck does not take in the package
// (it is the dashboard's, outside this one); tsx loads it all the same.
const corePath = '../../automation-core/src/index.ts';
// biome-ignore lint/suspicious/noExplicitAny: loaded untyped, see above
const core: any = await import(corePath);
const { getFunctionName } = await import('convex/server');
const { useDashClientForTests } = await import('../src/mastra/ncat/convex');

type Draft = {
  name: string;
  trigger: unknown;
  nodes: { id: string }[];
  edges: unknown[];
};
const automations = new Map<string, { draft: Draft; enabled: boolean }>();
let runs = 0;

function described(id: string) {
  const a = automations.get(id);
  if (!a) throw new Error('There is no such automation.');
  return {
    outline: core.outline(a.draft),
    problems: core.draftProblems(a.draft),
    enabled: a.enabled,
    music: [],
  };
}

function answer(name: string, args: Record<string, any>): unknown {
  switch (name) {
    case 'teamSettings:agentBrief':
      return { model: null, text: '' };
    case 'automations:list':
      return [...automations.entries()].map(([id, a]) => ({
        _id: id,
        name: a.draft.name,
        enabled: a.enabled,
        stepCount: a.draft.nodes.length,
        trigger: a.draft.trigger,
        lastRun: null,
      }));
    case 'automations:nodeTypes': {
      if (!args.type) return { index: core.nodeTypeIndex() };
      const found = core.getNodeType(args.type);
      if (!found) throw new Error(`There is no step type called ${args.type}.`);
      return { type: found };
    }
    case 'automations:platformGuide':
      return core.platformGuideText(args.platforms);
    case 'automations:create': {
      const id = `auto_${automations.size + 1}`;
      automations.set(id, {
        draft: { name: args.name, trigger: { kind: 'manual' }, nodes: [], edges: [] } as Draft,
        enabled: false,
      });
      return id;
    }
    case 'automations:describe':
      return described(args.automationId);
    case 'automations:change': {
      const a = automations.get(args.automationId);
      if (!a) throw new Error('There is no such automation.');
      a.draft = core.applyOperations(a.draft, args.operations);
      return described(args.automationId);
    }
    case 'automations:setEnabled': {
      const a = automations.get(args.automationId);
      if (a) a.enabled = args.enabled;
      return null;
    }
    case 'storage:listUploads':
      return [
        {
          _id: 'up_1',
          name: 'Episode 42 - Building in public.mp4',
          size: 1_800_000_000,
          contentType: 'video/mp4',
          uploadedAt: Date.now() - 3_600_000,
        },
        {
          _id: 'up_2',
          name: 'Episode 41 - Pricing your work.mp4',
          size: 1_600_000_000,
          contentType: 'video/mp4',
          uploadedAt: Date.now() - 86_400_000 * 7,
        },
      ];
    case 'automations:tryOnUpload':
      runs += 1;
      return { runId: `run_${runs}`, fileName: 'Episode 42 - Building in public.mp4' };
    case 'runs:get': {
      const id = [...automations.keys()].at(-1) ?? 'auto_1';
      const a = automations.get(id);
      return {
        _id: args.runId,
        automationId: id,
        status: 'done',
        error: null,
        nodes: (a?.draft.nodes ?? []).map((n) => ({ ...n })),
        steps: (a?.draft.nodes ?? []).map((n, i) => ({
          nodeId: n.id,
          status: 'done',
          error: null,
          outputs: [`https://files.example/run/${i}/clip-${i + 1}.mp4`],
          retries: 0,
        })),
      };
    }
    case 'library:search':
      return [];
    default:
      throw new Error(`The stand-in dashboard has no answer for ${name}`);
  }
}

const standIn = {
  query: async (ref: never, args: Record<string, unknown>) => answer(getFunctionName(ref), args),
  mutation: async (ref: never, args: Record<string, unknown>) => answer(getFunctionName(ref), args),
  action: async (ref: never, args: Record<string, unknown>) => answer(getFunctionName(ref), args),
};
useDashClientForTests(() => standIn as never);

// ---------------------------------------------------------------------------------------
// The conversations.

const { InMemoryStore } = await import('@mastra/core/storage');
const ac = await import('../src/mastra/lib/agent-controller');
const { rememberSession } = await import('../src/mastra/ncat/session-store');

const SESSIONS: Record<string, { turns: string[]; answer: string }> = {
  // Someone builds an automation with the agent, tries it and switches it on.
  build: {
    turns: [
      'Every time I upload a podcast episode, cut it into short clips with captions for TikTok and YouTube Shorts. I want to approve the clips before anything goes out.',
      'Try it on my latest upload.',
      'Make the captions bigger, and put our logo in the corner.',
      'Looks good. Switch it on.',
    ],
    answer: 'TikTok and YouTube Shorts',
  },
  // Someone asks the agent things and builds nothing.
  question: {
    turns: [
      'How long can a YouTube Short be?',
      'What does the Remove silence step do?',
      'Thanks!',
    ],
    answer: 'Either is fine',
  },
};

const USER = 'u-measure';
const until = async (done: () => boolean, ms: number) => {
  const start = Date.now();
  while (!done()) {
    if (Date.now() - start > ms) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
};

const picked = (process.env.SESSIONS ?? 'build,question').split(',');
const controller = ac.createChatAgentController({
  storage: new InMemoryStore(),
  resourceId: USER,
  browser: null,
});
await controller.init();

for (const name of picked) {
  const script = SESSIONS[name];
  if (!script) continue;
  current = name;
  rememberSession(USER, { convexToken: 'stand-in', organizationId: 'team_1', automationId: null });
  const session = await controller.createSession({ resourceId: USER });
  for (const tool of ac.AUTO_ALLOWED_TOOLS) session.grantTool(tool);
  session.grantTool('ask_user');
  let suspended = false;
  session.subscribe((event: { type: string; toolCallId?: string; toolName?: string }) => {
    if (event.type === 'tool_approval_required' && event.toolCallId)
      session.respondToToolApproval({ decision: 'approve', toolCallId: event.toolCallId });
    if (event.type === 'tool_suspended') suspended = true;
  });
  await session.thread.create();
  for (const turn of script.turns) {
    const sent = session.sendMessage({ content: turn }).catch(() => {});
    for (;;) {
      await until(() => suspended || !session.run.isRunning(), 180_000);
      if (!suspended) break;
      suspended = false;
      await session.respondToToolSuspension({ resumeData: script.answer }).catch(() => {});
    }
    await sent;
  }
}

// Observational memory works after the turns; give it time to finish.
await new Promise((r) => setTimeout(r, 20_000));
await controller.destroy();

// ---------------------------------------------------------------------------------------
// The bill.

const model = (m: string) => m.replace(/^anthropic\//, '');
for (const name of picked) {
  const mine = calls.filter((c) => c.session === name);
  if (mine.length === 0) continue;
  const rows = mine.map((c, i) => ({
    call: i + 1,
    for: c.what,
    model: model(c.model),
    input: c.usage.input_tokens ?? 0,
    cacheWrite: c.usage.cache_creation_input_tokens ?? 0,
    write1h: c.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    cacheRead: c.usage.cache_read_input_tokens ?? 0,
    output: c.usage.output_tokens ?? 0,
    cost: Number(costOf(model(c.model), c.usage).toFixed(5)),
  }));
  const total = rows.reduce((n, r) => n + r.cost, 0);
  console.log(`\nSession "${name}" on ${process.env.CHAT_MODEL}: ${rows.length} model calls`);
  console.table(rows);
  const byPurpose = new Map<string, number>();
  for (const r of rows) byPurpose.set(r.for, (byPurpose.get(r.for) ?? 0) + r.cost);
  console.log(
    `Total $${total.toFixed(4)} (${[...byPurpose].map(([k, v]) => `${k} $${v.toFixed(4)}`).join(', ')})`,
  );
}
process.exit(0);
