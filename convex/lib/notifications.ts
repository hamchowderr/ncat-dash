import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * Everything the dashboard tells people about, and how each member wants to hear it:
 * under the bell, by email, both or neither. Each member sets this for themselves, once
 * per team, in Settings > Notifications.
 */
export const NOTIFICATION_KINDS = [
  {
    kind: "run_failed",
    title: "A run fails",
    description:
      "A run stopped because a step still failed after all its tries. Goes to everyone on the team.",
    bell: true,
    email: true,
  },
  {
    kind: "approval_waiting",
    title: "An approval is waiting for me",
    description: "A run reached an Approval step that asks you, or the whole team, to decide.",
    bell: true,
    email: true,
  },
  {
    kind: "approval_timed_out",
    title: "An approval ran out of time",
    description:
      "Nobody decided an Approval step you were asked about in time, so it approved or rejected by itself.",
    bell: true,
    email: true,
  },
  {
    kind: "mention",
    title: "Someone mentions me in a review",
    description: "A teammate wrote @ and your name in a review comment.",
    bell: true,
    email: true,
  },
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]["kind"];
export type Channel = "bell" | "email";
export type EmailTiming = "now" | "daily";

/** Approvals have a deadline, so their emails go at once even for a daily summary. */
export const ALWAYS_RIGHT_AWAY: readonly NotificationKind[] = ["approval_waiting"];

/** The hour, in the member's own time, that a daily summary goes out unless they pick another. */
export const DEFAULT_DIGEST_HOUR = 8;

type Preference = Pick<Doc<"notificationPreferences">, "kinds"> | null | undefined;

/** Whether this member wants this kind of news on this channel. */
export function wants(preference: Preference, kind: NotificationKind, channel: Channel): boolean {
  const chosen = preference?.kinds?.[kind]?.[channel];
  if (chosen !== undefined) return chosen;
  return NOTIFICATION_KINDS.find((entry) => entry.kind === kind)?.[channel] ?? true;
}

/** Whether an email of this kind goes straight away, rather than in the daily summary. */
export function emailsRightAway(
  preference: Pick<Doc<"notificationPreferences">, "emailTiming"> | null | undefined,
  kind: NotificationKind,
): boolean {
  return (preference?.emailTiming ?? "now") === "now" || ALWAYS_RIGHT_AWAY.includes(kind);
}

/** The hour of the day it is now in a time zone, 0 to 23. An unknown zone counts as UTC. */
export function hourIn(timeZone: string | undefined, at: number): number {
  try {
    const hour = new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: timeZone || "UTC",
    }).format(new Date(at));
    return Number(hour) % 24;
  } catch {
    return new Date(at).getUTCHours();
  }
}

/**
 * Whether a member's daily summary is due: it is their chosen hour where they are, and
 * the last one went out more than 90 minutes ago (so the hour repeated when clocks go
 * back never sends two).
 */
export function digestDue(
  preference: Pick<
    Doc<"notificationPreferences">,
    "emailTiming" | "digestHour" | "timeZone" | "lastDigestAt"
  >,
  now: number,
): boolean {
  if (preference.emailTiming !== "daily") return false;
  if (hourIn(preference.timeZone, now) !== (preference.digestHour ?? DEFAULT_DIGEST_HOUR)) {
    return false;
  }
  return preference.lastDigestAt === undefined || now - preference.lastDigestAt > 90 * 60_000;
}

/** A member's choices on a team, or null when they have kept every default. */
export async function preferenceOf(
  ctx: QueryCtx,
  organizationId: string,
  userId: string,
): Promise<Doc<"notificationPreferences"> | null> {
  return await ctx.db
    .query("notificationPreferences")
    .withIndex("by_organization_and_user", (q) =>
      q.eq("organizationId", organizationId).eq("userId", userId),
    )
    .first();
}

/** Where an alert takes the person who opens it. */
export function alertHref(
  alert: Pick<
    Doc<"alerts">,
    "kind" | "runId" | "automationId" | "reviewId" | "clipId" | "commentId"
  >,
): string {
  if (alert.kind === "mention" && alert.reviewId) {
    const query = new URLSearchParams();
    if (alert.clipId) query.set("clip", alert.clipId);
    if (alert.commentId) query.set("comment", alert.commentId);
    const tail = query.toString();
    return `/review/${alert.reviewId}${tail ? `?${tail}` : ""}`;
  }
  if (alert.automationId && alert.runId)
    return `/automations/${alert.automationId}/runs/${alert.runId}`;
  return "/";
}
