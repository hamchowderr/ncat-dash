import { env } from '../../lib/env';
import { personOf, sessionOf } from './session-store';
import { convexSiteUrl, signForDashboard } from './slack';

/**
 * The agent's own schedules ("every morning, check my uploads") fire with nobody
 * watching, and each fire spends AI tokens. So before each fire the dashboard is asked
 * whether the team may still start something: not once its free trial is over, not when
 * the team or person is blocked, and not past the team's allowance. A schedule is made
 * knowing its team (and person, in the dashboard), kept in its metadata.
 */

export type ScheduleOwner = { organizationId: string; userId?: string };

/** Who a new schedule belongs to, from the sign-in the turn that made it is using. */
export function ownerOf(resourceId: string): ScheduleOwner | null {
  const organizationId = sessionOf(resourceId)?.organizationId;
  if (!organizationId) return null;
  // In the dashboard the resource is the person within the team; in Slack or Discord it
  // is the thread, which is not one person.
  const userId = personOf(resourceId);
  return userId ? { organizationId, userId } : { organizationId };
}

export type Answer = { ok: true } | { ok: false; message: string };
type Ask = (owner: ScheduleOwner) => Promise<Answer | null>;

const askDashboard: Ask = async (owner) => {
  const site = convexSiteUrl();
  const secret = env.MASTRA_JWT_SECRET;
  if (!site || !secret) return null;
  try {
    const response = await fetch(`${site}/agent/scheduled-turn`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${signForDashboard(secret)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(owner),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`The dashboard answered ${response.status}`);
    return (await response.json()) as Answer;
  } catch (error) {
    console.error('[schedules] could not reach the dashboard', error);
    return null;
  }
};

let ask: Ask = askDashboard;

/** For tests: answer the dashboard's side without a deployment. Pass nothing to undo. */
export function useDashboardForTests(answer?: Ask): void {
  ask = answer ?? askDashboard;
}

function ownerFromMetadata(metadata: unknown): ScheduleOwner | null {
  const data = (metadata ?? {}) as Record<string, unknown>;
  if (typeof data.organizationId !== 'string' || !data.organizationId) return null;
  return {
    organizationId: data.organizationId,
    ...(typeof data.userId === 'string' && data.userId ? { userId: data.userId } : {}),
  };
}

/**
 * Whether a schedule may fire now. A schedule with no team on it (made before this
 * check, or with no team open) fires as before. When the dashboard can't be reached the
 * fire is skipped: the next one asks again.
 */
export async function mayFire(schedule: { [key: string]: unknown }): Promise<boolean> {
  const owner = ownerFromMetadata(schedule.metadata);
  if (!owner) return true;
  const answer = await ask(owner);
  if (!answer) return false;
  if (!answer.ok) console.info(`[schedules] skipped for ${owner.organizationId}: ${answer.message}`);
  return answer.ok;
}

/** The Mastra-wide schedule hooks: a fire the dashboard refuses is skipped. */
export const scheduleHooks = {
  prepare: async ({ schedule }: { schedule: { [key: string]: unknown } }) =>
    (await mayFire(schedule)) ? undefined : null,
};
