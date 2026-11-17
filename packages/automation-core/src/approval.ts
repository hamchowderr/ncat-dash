/**
 * Who reviews an Approval step, and what happens when nobody decides in time. The
 * settings are plain data on the step, so the canvas, the agent and the runner all read
 * them the same way.
 */
import { MAX_WAIT_MS } from "./logic";

export const TIME_LIMIT_UNITS = ["hours", "days"] as const;
export type TimeLimitUnit = (typeof TIME_LIMIT_UNITS)[number];

export const TIME_UP_CHOICES = ["reject", "approve"] as const;
export type TimeUpChoice = (typeof TIME_UP_CHOICES)[number];

const UNIT_MS: Record<TimeLimitUnit, number> = { hours: 3_600_000, days: 86_400_000 };

/** The roles that can always decide, so a run never sticks when a reviewer leaves. */
export const ALWAYS_DECIDE_ROLES = ["owner", "admin"];

export interface ApprovalSettings {
  /** The user ids of the people asked to review. Empty: anyone on the team. */
  reviewers: string[];
  /** How long to wait for a decision, or null to wait until someone decides. */
  limit: { amount: number; unit: TimeLimitUnit } | null;
  /** What happens when the time is up. */
  whenTimeUp: TimeUpChoice;
}

/** An Approval step's settings, with anything missing or odd read as the default. */
export function approvalSettings(input: Record<string, unknown>): ApprovalSettings {
  const reviewers = Array.isArray(input.reviewers)
    ? [
        ...new Set(
          input.reviewers.filter((id): id is string => typeof id === "string" && id !== ""),
        ),
      ]
    : [];
  const amount = input.timeLimit;
  const unit = TIME_LIMIT_UNITS.includes(input.timeLimitUnit as TimeLimitUnit)
    ? (input.timeLimitUnit as TimeLimitUnit)
    : "hours";
  const limit =
    typeof amount === "number" && Number.isFinite(amount) && amount > 0 ? { amount, unit } : null;
  const whenTimeUp = input.whenTimeUp === "approve" ? "approve" : "reject";
  return { reviewers, limit, whenTimeUp };
}

/** A problem with an Approval step's settings in plain words, or null when they are fine. */
export function approvalProblem(input: Record<string, unknown>): string | null {
  const { limit } = approvalSettings(input);
  if (limit && limit.amount * UNIT_MS[limit.unit] > MAX_WAIT_MS) {
    return "The time limit can be 6 days at most, because links to files stop working after a week.";
  }
  return null;
}

/** How long the step waits before deciding by itself, in milliseconds, or null for no limit. */
export function approvalLimitMs(input: Record<string, unknown>): number | null {
  if (approvalProblem(input)) return null;
  const { limit } = approvalSettings(input);
  return limit ? Math.round(limit.amount * UNIT_MS[limit.unit]) : null;
}

/** "24 hours", "2 days". */
export function limitWords(limit: { amount: number; unit: TimeLimitUnit }): string {
  return `${limit.amount} ${limit.amount === 1 ? limit.unit.replace(/s$/, "") : limit.unit}`;
}

/**
 * The members asked to decide: the named reviewers who are still on the team, or the
 * whole team when none are named or none of them are left.
 */
export function askedToDecide<M extends { userId: string }>(
  reviewers: string[],
  members: M[],
): M[] {
  const named = members.filter((member) => reviewers.includes(member.userId));
  return named.length > 0 ? named : members;
}

/**
 * Whether this member may approve or reject: one of the people asked, or a team owner
 * or admin.
 */
export function mayDecide(
  reviewers: string[],
  members: { userId: string; role: string }[],
  userId: string,
): boolean {
  const member = members.find((candidate) => candidate.userId === userId);
  if (!member) return false;
  if (member.role.split(",").some((role) => ALWAYS_DECIDE_ROLES.includes(role.trim()))) return true;
  return askedToDecide(reviewers, members).some((asked) => asked.userId === userId);
}

/** One line for the canvas: who is asked, and any time limit. */
export function approvalSentence(
  input: Record<string, unknown>,
  nameOf: (userId: string) => string | undefined,
): string {
  const { reviewers, limit, whenTimeUp } = approvalSettings(input);
  const names = reviewers.map(nameOf).filter((name): name is string => Boolean(name));
  const who =
    names.length === 0
      ? "Anyone on the team"
      : names.length <= 2
        ? names.join(" or ")
        : `${names[0]} or ${names.length - 1} others`;
  if (!limit) return who;
  return `${who}, ${whenTimeUp === "approve" ? "approves" : "rejects"} after ${limitWords(limit)}`;
}

/** A few words for the canvas, without names: "Anyone on the team", "2 reviewers · 24 hours". */
export function approvalShort(input: Record<string, unknown>): string {
  const { reviewers, limit } = approvalSettings(input);
  const who =
    reviewers.length === 0
      ? "Anyone on the team"
      : `${reviewers.length} ${reviewers.length === 1 ? "reviewer" : "reviewers"}`;
  return limit ? `${who} · ${limitWords(limit)}` : who;
}
