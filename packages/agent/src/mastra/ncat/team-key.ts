import type { RequestContext } from "@mastra/core/request-context";
import { env } from "../../lib/env";
import { TURN_USER_KEY } from "../lib/turn-user";
import { sessionOf } from "./session-store";
import { convexSiteUrl, signForDashboard } from "./dashboard-site";

/**
 * A team's own Anthropic API key (Settings → Agent in the dashboard). When the team has
 * one, its chats and its Best moments and Chapters steps run on it, so Anthropic bills the
 * team, not the dashboard. Read from the dashboard's /agent/team-key with the shared
 * secret, and kept a minute so a turn of many steps asks once. Anything that goes wrong
 * reading it leaves the server's own key in use.
 */

/** Request-context key: the team's own Anthropic key for this call, already looked up. */
export const TEAM_KEY = "teamAnthropicKey";

const FRESH_MS = 60_000;
const kept = new Map<string, { at: number; key: string | null }>();

type Read = (organizationId: string) => Promise<string | null | undefined>;

/** The key from the dashboard: null when the team has none, undefined when unknown. */
const readFromDashboard: Read = async (organizationId) => {
  const site = convexSiteUrl();
  const secret = env.MASTRA_JWT_SECRET;
  // A mock model run never needs a real key.
  if (!site || !secret || env.USE_AIMOCK) return undefined;
  try {
    const response = await fetch(`${site}/agent/team-key`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${signForDashboard(secret)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ organizationId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) return undefined;
    const body = (await response.json()) as { key?: unknown };
    return typeof body.key === "string" && body.key ? body.key : null;
  } catch {
    return undefined;
  }
};

let read: Read = readFromDashboard;

/** For tests: answer for the dashboard. Pass nothing to undo. */
export function useTeamKeysForTests(stand?: Read): void {
  read = stand ?? readFromDashboard;
  kept.clear();
}

/** The team's own Anthropic key, or null to use the server's. */
export async function teamKey(organizationId: string | undefined): Promise<string | null> {
  if (!organizationId) return null;
  const found = kept.get(organizationId);
  if (found && Date.now() - found.at < FRESH_MS) return found.key;
  const key = await read(organizationId);
  if (key === undefined) return found?.key ?? null;
  kept.set(organizationId, { at: Date.now(), key });
  return key;
}

/** The key of the team the turn's person is working in, from their dashboard session. */
export async function teamKeyForTurn(
  requestContext: Pick<RequestContext, "get"> | undefined,
): Promise<string | null> {
  const userId = requestContext?.get(TURN_USER_KEY);
  const session = sessionOf(typeof userId === "string" ? userId : undefined);
  return await teamKey(session?.organizationId ?? undefined);
}

/** `modelId` on the team's key when it is an Anthropic model and there is one. */
export function onTeamKey(
  modelId: string,
  key: string | null,
): `${string}/${string}` | { id: `${string}/${string}`; apiKey: string } {
  const id = modelId as `${string}/${string}`;
  return key && modelId.startsWith("anthropic/") ? { id, apiKey: key } : id;
}
