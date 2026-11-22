/**
 * # Takewon's Knowledge instance
 *
 * lib/knowledge.ts (from the chat kit) holds the env-free pieces; this file binds them to
 * env and to the dashboard: the shared libSQL store and vector index (the same database
 * as memory and threads), the local fastembed embedder, the folder synced at boot, and
 * which pages a run may see.
 *
 * ## Scopes
 *
 * - `docs:takewon`: the Takewon guide, synced from KNOWLEDGE_DIR. Every run reads it; no
 *   run writes it (only the boot sync does).
 * - `team:<team>`: the team's own pages (house style, what a client wants, how they
 *   like things done). Held by every run whose dashboard session has that team open.
 * - `client:<team>:<client>`: one client's pages, with a `brief` page pinned into
 *   context. Held only while the thing on the person's screen is for that client
 *   (convex agentScreen.clientOf), so one client's notes never colour another's work.
 * - `resource:<person>~<team>`: the person's own notes in that team, from Memory.
 *
 * The scopes come from the server's own session store, keyed by the turn's resource id
 * (set server-side), never from the request: `chatKnowledgeScopes` replaces whatever
 * scopes a run arrives with, keeping only Memory's own resource and thread.
 */
import { knowledgeMemoryScopes } from '@mastra/core/knowledge';
import { fastembed } from '@mastra/fastembed';
import { env } from '../../lib/env';
import { dash, dashFor, NotConnected } from '../ncat/convex';
import { screenKey } from '../ncat/screen';
import { type DashSession, sessionOf } from '../ncat/session-store';
import { createChatKnowledge, folderSource, syncNotes } from './knowledge';
import { getSharedStore, getSharedVector } from './memory';
import { TURN_USER_KEY } from './turn-user';

/** The Takewon guide every run reads, where the synced pages live. */
export const GUIDE_SCOPE = 'docs:takewon';

export const teamScope = (teamId: string) => `team:${teamId}`;
export const clientScope = (teamId: string, clientId: string) => `client:${teamId}:${clientId}`;

/** What Takewon's Knowledge knows: Memory's scopes under the team, the guide, and clients. */
export const CHAT_KNOWLEDGE_SCOPES = {
  ...knowledgeMemoryScopes({ org: 'team:$teamId' }),
  'docs:$guide': {
    description: 'The Takewon guide: how the dashboard, automations and the toolkit work.',
    displayLabel: 'Takewon guide',
    access: [{ principal: 'self', role: 'viewer' as const }],
  },
  'client:$teamId:$clientId': {
    description:
      'One client of the team: their brief, what they like and do not like, and notes from past work for them.',
    displayLabel: 'Client',
    belongsTo: 'team:$teamId',
    access: [{ principal: 'self', role: 'editor' as const }],
    pages: [
      {
        key: 'brief',
        name: 'Client brief',
        description: 'Who the client is, what they want from their videos, and what to avoid.',
      },
    ],
    pinnedContext: ['client:$teamId:$clientId#brief'],
  },
};

export const chatKnowledge = createChatKnowledge({
  storage: getSharedStore(),
  vector: getSharedVector(),
  embedder: fastembed,
  scopes: CHAT_KNOWLEDGE_SCOPES,
  description:
    "Takewon's knowledge: the Takewon guide, the team's own pages, the pages for the client whose work is on screen, and the person's own notes.",
});

/** Mirror KNOWLEDGE_DIR into the guide scope. index.ts runs it at boot. */
export function syncChatKnowledge() {
  return syncNotes(chatKnowledge, GUIDE_SCOPE, folderSource(env.KNOWLEDGE_DIR));
}

type ClientLookup = (resourceId: string, session: DashSession) => Promise<string | null>;

const clientFromDashboard: ClientLookup = async (resourceId, session) => {
  if (!session.screen || !session.organizationId) return null;
  const { client } = dashFor(resourceId);
  const found = (await client.query(dash.agentScreen.clientOf, {
    organizationId: session.organizationId,
    kind: session.screen.kind,
    id: session.screen.id,
  })) as { id: string } | null;
  return found?.id ?? null;
};

let lookUpClient: ClientLookup = clientFromDashboard;

/** For tests: answer which client is on screen without a dashboard. Pass nothing to undo. */
export function useClientLookupForTests(lookup?: ClientLookup): void {
  lookUpClient = lookup ?? clientFromDashboard;
  known.clear();
}

/** The client last found for each screen (`team/kind/id`), so one turn's steps ask once. */
const known = new Map<string, { clientId: string | null; at: number }>();
const KNOWN_MS = 60_000;

async function clientOnScreen(resourceId: string, session: DashSession): Promise<string | null> {
  const key = screenKey(session);
  if (key === 'none') return null;
  const kept = known.get(key);
  if (kept && Date.now() - kept.at < KNOWN_MS) return kept.clientId;
  try {
    const clientId = await lookUpClient(resourceId, session);
    known.set(key, { clientId, at: Date.now() });
    return clientId;
  } catch (caught) {
    // No client pages this turn rather than no turn at all.
    if (!(caught instanceof NotConnected)) console.warn('[knowledge] client lookup failed', caught);
    return null;
  }
}

/** Memory's own scopes (`resource:` / `thread:`), which every run keeps. */
const isIdentityScope = (scope: string) =>
  scope.startsWith('resource:') || scope.startsWith('thread:');

/** A team or client id usable inside a scope address: no `:` (the address separator). */
const plainId = (id: string) => id.length > 0 && !id.includes(':');

/**
 * The scopes a chat run holds (the chat agent's `scopes`): Memory's own resource and
 * thread, the guide, and, from the person's dashboard session, their team and the client
 * whose work is on screen. Scopes the run arrived with are otherwise dropped, so nothing a
 * caller passes can reach another team's or client's pages.
 */
export async function chatKnowledgeScopes({
  scopes,
  requestContext,
}: {
  scopes: string[];
  requestContext: { get(key: string): unknown };
}): Promise<string[]> {
  const held = [...scopes.filter(isIdentityScope), GUIDE_SCOPE];
  const resourceId = requestContext.get(TURN_USER_KEY);
  const session = typeof resourceId === 'string' ? sessionOf(resourceId) : undefined;
  const teamId = session?.organizationId;
  if (!session || !teamId || !plainId(teamId)) return held;
  held.push(teamScope(teamId));
  const clientId = await clientOnScreen(resourceId as string, session);
  if (clientId && plainId(clientId)) held.push(clientScope(teamId, clientId));
  return held;
}
