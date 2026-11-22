import { z } from 'zod';
import { CONNECTORS_OFF_KEY } from './connectors-off';
import { LONG_CACHE_KEY, MODEL_PICKED_KEY, ROUTE_KEY } from './cost';
import { TIME_ZONE_KEY } from './time-zone';
import { TURN_USER_KEY } from './turn-user';

/**
 * Every value a chat turn carries on its request context, with its type, checked by the
 * chat agent before it calls the model (its `requestContextSchema`).
 *
 * All of them are set by this server, never read from a request body: the stream route
 * builds the context from its own checked fields (routes/controller.ts), the person is
 * the signed token's subject, and the chat apps set theirs when a message comes in. The
 * web app forwards only the chat routes, so nothing from a browser reaches the agent's
 * own endpoints. The team and the screen are kept per person by POST /ncat/session,
 * which is signed the same way (ncat/session-store.ts).
 *
 * Mastra and the AgentController add keys of their own (the controller, the browser,
 * mastra__ ones), so others are allowed through untouched.
 */
export const turnRequestContextSchema = z.looseObject({
  /** The composer's Search toggle. */
  webSearch: z.boolean().optional(),
  /** The browser's IANA time zone (lib/time-zone.ts). */
  [TIME_ZONE_KEY]: z.string().max(100).optional(),
  /** Connectors the person turned off for this chat (lib/connectors-off.ts). */
  [CONNECTORS_OFF_KEY]: z.array(z.string()).optional(),
  /** Whose turn it is: the resource id (lib/turn-user.ts). */
  [TURN_USER_KEY]: z.string().min(1).optional(),
  /** The session's model was picked for this turn (lib/cost.ts). */
  [MODEL_PICKED_KEY]: z.boolean().optional(),
  /** A chat-app turn, cached for an hour (lib/cost.ts). */
  [LONG_CACHE_KEY]: z.boolean().optional(),
  /** Which way the cost router sent this turn, set while it runs (lib/cost.ts). */
  [ROUTE_KEY]: z.unknown().optional(),
  /** The simple single-agent path opts out of the workspace (agents/chat.ts). */
  noWorkspace: z.boolean().optional(),
});
