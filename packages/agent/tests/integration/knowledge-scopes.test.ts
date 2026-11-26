import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encodeKnowledgeScopeId } from '@mastra/core/knowledge';
import { LibSQLStore } from '@mastra/libsql';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CHAT_KNOWLEDGE_SCOPES,
  chatKnowledgeScopes,
  clientScope,
  GUIDE_SCOPE,
  teamScope,
  useClientLookupForTests,
} from '../../src/mastra/lib/chat-knowledge';
import { createChatKnowledge } from '../../src/mastra/lib/knowledge';
import { TURN_USER_KEY } from '../../src/mastra/lib/turn-user';
import { forgetSessions, rememberSession } from '../../src/mastra/ncat/session-store';

/**
 * Which Knowledge pages a chat run may see (lib/chat-knowledge.ts): the Takewon guide,
 * the team open on the person's dashboard, and a client's pages only while that client's
 * work is on screen. The scopes come from the server's session store, never the caller.
 */

const turn = (resourceId?: string) => ({
  get: (key: string) => (key === TURN_USER_KEY ? resourceId : undefined),
});

const MEMORY = ['resource:u-1~team_a', 'thread:t-1'];

let lookups: string[] = [];
beforeEach(() => {
  lookups = [];
  forgetSessions();
  useClientLookupForTests(async (_resourceId, session) => {
    lookups.push(`${session.screen?.kind}/${session.screen?.id}`);
    return session.screen?.id === 'auto_for_northwind' ? 'client_northwind' : null;
  });
});
afterEach(() => {
  useClientLookupForTests();
  forgetSessions();
});

const onScreen = (resourceId: string, organizationId: string, screenId: string | null) =>
  rememberSession(resourceId, {
    convexToken: 't',
    organizationId,
    automationId: null,
    screen: screenId ? { kind: 'automation', id: screenId } : null,
  });

describe('the scopes a chat run holds', () => {
  it('the guide, the open team, and the client whose work is on screen', async () => {
    onScreen('u-1~team_a', 'team_a', 'auto_for_northwind');
    const scopes = await chatKnowledgeScopes({ scopes: MEMORY, requestContext: turn('u-1~team_a') });
    expect(scopes).toEqual([
      ...MEMORY,
      GUIDE_SCOPE,
      'team:team_a',
      'client:team_a:client_northwind',
    ]);
  });

  it("no client's pages for the team's own work, or with nothing open", async () => {
    onScreen('u-1~team_a', 'team_a', 'auto_own');
    expect(await chatKnowledgeScopes({ scopes: MEMORY, requestContext: turn('u-1~team_a') })).toEqual(
      [...MEMORY, GUIDE_SCOPE, 'team:team_a'],
    );
    onScreen('u-1~team_a', 'team_a', null);
    expect(await chatKnowledgeScopes({ scopes: MEMORY, requestContext: turn('u-1~team_a') })).toEqual(
      [...MEMORY, GUIDE_SCOPE, 'team:team_a'],
    );
  });

  it('drops any other scope a run arrives with, so a caller cannot reach another team', async () => {
    onScreen('u-1~team_a', 'team_a', null);
    const scopes = await chatKnowledgeScopes({
      scopes: [...MEMORY, 'team:team_b', 'client:team_b:client_x'],
      requestContext: turn('u-1~team_a'),
    });
    expect(scopes).not.toContain('team:team_b');
    expect(scopes).not.toContain('client:team_b:client_x');
  });

  it('only the guide with no dashboard session, and asks about a screen once a minute', async () => {
    expect(await chatKnowledgeScopes({ scopes: MEMORY, requestContext: turn() })).toEqual([
      ...MEMORY,
      GUIDE_SCOPE,
    ]);
    onScreen('u-1~team_a', 'team_a', 'auto_for_northwind');
    await chatKnowledgeScopes({ scopes: MEMORY, requestContext: turn('u-1~team_a') });
    await chatKnowledgeScopes({ scopes: MEMORY, requestContext: turn('u-1~team_a') });
    expect(lookups).toEqual(['automation/auto_for_northwind']);
  });

  it('a chat-app thread gets its team, and no client pages when the lookup fails', async () => {
    rememberSession('channel:slack:C1:1.2', {
      convexToken: 't',
      organizationId: 'team_a',
      automationId: null,
    });
    expect(
      await chatKnowledgeScopes({ scopes: [], requestContext: turn('channel:slack:C1:1.2') }),
    ).toEqual([GUIDE_SCOPE, 'team:team_a']);

    useClientLookupForTests(async () => {
      throw new Error('offline');
    });
    const warn = console.warn;
    console.warn = () => {};
    try {
      onScreen('u-1~team_a', 'team_a', 'auto_for_northwind');
      expect(
        await chatKnowledgeScopes({ scopes: MEMORY, requestContext: turn('u-1~team_a') }),
      ).toEqual([...MEMORY, GUIDE_SCOPE, 'team:team_a']);
    } finally {
      console.warn = warn;
    }
  });
});

describe('who reaches which pages (Mastra Knowledge access rules)', () => {
  let dir: string;
  let knowledge: ReturnType<typeof createChatKnowledge>;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'takewon-knowledge-'));
    knowledge = createChatKnowledge({
      storage: new LibSQLStore({ id: 'k-scopes', url: `file:${path.join(dir, 'k.db')}` }),
      scopes: CHAT_KNOWLEDGE_SCOPES,
    });
    await knowledge.upsertPage({ scope: GUIDE_SCOPE, path: 'captions', name: 'Captions', body: 'x' });
    await knowledge.upsertPage({ scope: teamScope('team_a'), path: 'style', name: 'Style', body: 'x' });
    await knowledge.upsertPage({ scope: teamScope('team_b'), path: 'style', name: 'Style', body: 'x' });
    await knowledge.upsertPage({
      scope: clientScope('team_a', 'client_northwind'),
      path: 'likes',
      name: 'Likes',
      body: 'x',
    });
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const role = async (runScopes: string[], page: string) =>
    (await knowledge.explainAccess(runScopes, { page })).role ?? null;

  it("a team's run edits its own pages, reads the guide, and never sees another team's", async () => {
    const run = [...MEMORY, GUIDE_SCOPE, teamScope('team_a')];
    expect(await role(run, 'team:team_a#style')).toBe('editor');
    expect(await role(run, `${GUIDE_SCOPE}#captions`)).toBe('viewer');
    expect(await role(run, 'team:team_b#style')).toBeNull();
  });

  it("a client's pages only while that client is held", async () => {
    const team = [...MEMORY, GUIDE_SCOPE, teamScope('team_a')];
    expect(await role(team, 'client:team_a:client_northwind#likes')).toBeNull();
    expect(
      await role(
        [...team, clientScope('team_a', 'client_northwind')],
        'client:team_a:client_northwind#likes',
      ),
    ).toBe('editor');
  });

  it("a chat-app thread's resource (with colons in it) is a scope Knowledge accepts", async () => {
    // Since Mastra 1.86 Knowledge builds a run's Memory scopes itself, with the id encoded
    // (encodeKnowledgeScopeId), and drops the raw ones a run arrives with.
    const run = [
      `resource:${encodeKnowledgeScopeId('channel:slack:C1:1.2')}`,
      GUIDE_SCOPE,
      teamScope('team_a'),
    ];
    expect(await role(run, 'team:team_a#style')).toBe('editor');
  });
});
