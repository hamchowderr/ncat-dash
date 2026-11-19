import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { limiter, waitLabel } from "./limits";
import { TRIAL_ENDED_MESSAGE, trialOf } from "./trial";

/**
 * Whether a team, or one person on it, may start something new: a run, an agent reply in
 * the dashboard, Slack or Discord, or an MCP call. Refused when the team's free trial is
 * over, or when the operator has blocked the team or the person (see blocks.ts). What
 * already exists is always kept and can still be seen.
 */
export type Refusal = {
  reason: "trial_ended" | "team_blocked" | "user_blocked" | "rate_limited";
  message: string;
};

export const TEAM_BLOCKED_MESSAGE =
  "This team has been paused by the people who run this dashboard, so nothing new starts. Everything you made is kept.";

export const USER_BLOCKED_MESSAGE =
  "Your account has been paused by the people who run this dashboard, so nothing new starts for you.";

export function rateLimitedMessage(retryAfter: number | undefined): string {
  return `That's a lot of requests in a short time, so this one waits. Try again ${waitLabel(retryAfter ?? 60_000)}.`;
}

type Reader = Pick<QueryCtx, "db">;

export async function blockOf(ctx: Reader, kind: "team" | "user", targetId: string) {
  return await ctx.db
    .query("blocks")
    .withIndex("by_kind_and_target", (q) => q.eq("kind", kind).eq("targetId", targetId))
    .unique();
}

/** Why the team (or this person on it) can't start anything new, or null when they can. */
export async function refusalFor(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  userId?: string | null,
): Promise<Refusal | null> {
  if (userId && (await blockOf(ctx, "user", userId))) {
    return { reason: "user_blocked", message: USER_BLOCKED_MESSAGE };
  }
  if (await blockOf(ctx, "team", organizationId)) {
    return { reason: "team_blocked", message: TEAM_BLOCKED_MESSAGE };
  }
  if ((await trialOf(ctx, organizationId)).kind === "ended") {
    return { reason: "trial_ended", message: TRIAL_ENDED_MESSAGE };
  }
  return null;
}

/**
 * Takes one agent reply from the person's and the team's allowance. Refused, with when
 * to try again, once either is used up. Nothing is taken from the team when the person
 * is the one over.
 */
export async function takeAgentTurn(
  ctx: MutationCtx | ActionCtx,
  organizationId: string,
  userId: string,
): Promise<Refusal | null> {
  const person = await limiter.limit(ctx, "agentTurnPerson", { key: `${organizationId}:${userId}` });
  if (!person.ok) return { reason: "rate_limited", message: rateLimitedMessage(person.retryAfter) };
  const team = await limiter.limit(ctx, "agentTurnTeam", { key: organizationId });
  if (!team.ok) return { reason: "rate_limited", message: rateLimitedMessage(team.retryAfter) };
  return null;
}
