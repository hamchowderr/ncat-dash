import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getEdition } from "./edition";

/** How long a new team on the hosted edition can use everything for free, unless TRIAL_DAYS says otherwise. */
export const DEFAULT_TRIAL_DAYS = 3;
const DAY = 24 * 60 * 60 * 1000;

/**
 * The length of a new team's free trial in days, or null when new teams get none: always
 * null on a self-hosted copy (the owner bought it), and on the hosted edition when
 * TRIAL_DAYS is 0. No card is asked for at any point.
 */
export function trialDays(env: Record<string, string | undefined> = process.env): number | null {
  if (getEdition() !== "hosted") return null;
  const raw = env.TRIAL_DAYS?.trim();
  if (!raw) return DEFAULT_TRIAL_DAYS;
  const days = Number(raw);
  return Number.isFinite(days) && days > 0 ? days : null;
}

export type TrialState =
  | { kind: "none" }
  | { kind: "paid" }
  | { kind: "trial"; endsAt: number }
  | { kind: "ended"; endsAt: number };

/** Where a team whose trial is ending goes to buy, from BUY_URL. Null when it is not set. */
export function buyUrl(env: Record<string, string | undefined> = process.env): string | null {
  const url = env.BUY_URL?.trim();
  return url && /^https?:\/\//.test(url) ? url : null;
}

export async function trialOf(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  now = Date.now(),
): Promise<TrialState> {
  const trial = await ctx.db
    .query("teamTrials")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .unique();
  if (!trial) return { kind: "none" };
  if (trial.paidAt !== undefined) return { kind: "paid" };
  return trial.endsAt > now
    ? { kind: "trial", endsAt: trial.endsAt }
    : { kind: "ended", endsAt: trial.endsAt };
}

/** Said wherever something would have started for a team whose trial is over. */
export const TRIAL_ENDED_MESSAGE =
  "Your free trial has ended, so nothing new starts. Everything you made is kept and starts again once you have the dashboard.";

/** The end of a trial that starts at `startedAt` and lasts `days` days. */
export function trialEnd(startedAt: number, days: number): number {
  return startedAt + days * DAY;
}

/** Whole days left, rounded up, so the last few hours still read as "1 day left". */
export function daysLeft(endsAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((endsAt - now) / DAY));
}
