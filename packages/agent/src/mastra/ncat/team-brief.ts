import { stableSection, TURN_USER_KEY, type TurnContextSection } from '../lib/turn-context';
import { dash, dashFor, NotConnected } from './convex';

/**
 * The team's agent settings (Settings → Agent in the dashboard): the model the agent runs
 * on, and what it is told on every turn (house rules, default platforms). Read as the
 * person, through the dashboard's own `teamSettings.agentBrief`, and kept for a short
 * while so a turn of many steps asks once.
 */
export type TeamBrief = { model: string | null; text: string | null };

const FRESH_MS = 30_000;
const briefs = new Map<string, { at: number; brief: TeamBrief }>();

export async function teamBriefFor(userId: string | undefined): Promise<TeamBrief | null> {
  if (!userId) return null;
  let found: ReturnType<typeof dashFor>;
  try {
    found = dashFor(userId);
  } catch (caught) {
    if (caught instanceof NotConnected) return null;
    throw caught;
  }
  const { client, session } = found;
  if (!session.organizationId) return null;
  const key = `${userId}:${session.organizationId}`;
  const kept = briefs.get(key);
  if (kept && Date.now() - kept.at < FRESH_MS) return kept.brief;
  try {
    const brief = (await client.query(dash.teamSettings.agentBrief, {
      organizationId: session.organizationId,
    })) as TeamBrief;
    briefs.set(key, { at: Date.now(), brief });
    return brief;
  } catch {
    // Settings that cannot be read leave the agent as it is set up on the server.
    return kept?.brief ?? null;
  }
}

/** The model a turn should run on: the team's pick when the server allows it, else none. */
export async function teamModelFor(
  userId: string | undefined,
  allowed: ReadonlySet<string>,
): Promise<string | null> {
  const brief = await teamBriefFor(userId);
  return brief?.model && allowed.has(brief.model) ? brief.model : null;
}

/** The team's house rules and default platforms, on every turn, cached apart from the date. */
export const teamSection: TurnContextSection = stableSection(async ({ requestContext }) => {
  const userId = requestContext?.get(TURN_USER_KEY);
  const brief = await teamBriefFor(typeof userId === 'string' ? userId : undefined);
  return brief?.text ?? undefined;
});

/** For tests. */
export function forgetTeamBriefs(): void {
  briefs.clear();
}
