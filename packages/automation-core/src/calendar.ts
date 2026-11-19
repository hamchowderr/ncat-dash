import { POSTING_APPS } from "./content-goals";
import { instantOf, partsIn, type Schedule, scheduleProblem } from "./schedule";

// The content calendar's rules, kept apart from Convex so the screen, the backend and the
// tests share them: when a repeating slot falls, when a scheduled automation runs, and
// which slot each post waiting in the queue goes to.

const DAY = 24 * 60 * 60_000;

/** Weekdays as the calendar names them, Sunday first like Date.getDay(). */
export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** The places a post can be planned for: the posting apps, by id. */
export const CALENDAR_PLATFORMS = POSTING_APPS.map(({ id, label }) => ({ id, label }));
export type CalendarPlatform = (typeof POSTING_APPS)[number]["id"];

export function isCalendarPlatform(value: string): value is CalendarPlatform {
  return CALENDAR_PLATFORMS.some((platform) => platform.id === value);
}

export function platformLabel(id: string): string {
  return CALENDAR_PLATFORMS.find((platform) => platform.id === id)?.label ?? id;
}

/** A repeating slot, such as "Mondays at 10:00 for Instagram". */
export type RepeatingSlot = {
  weekday: number;
  time: string;
  timeZone: string;
  platform: string;
  clientId?: string;
};

/** A plain-language problem with a slot, or null when it can be saved. */
export function slotProblem(slot: RepeatingSlot): string | null {
  if (!Number.isInteger(slot.weekday) || slot.weekday < 0 || slot.weekday > 6) {
    return "Pick a day of the week.";
  }
  if (!isCalendarPlatform(slot.platform)) return "Pick where it is posted.";
  return scheduleProblem({ mode: "daily", time: slot.time, timeZone: slot.timeZone });
}

/** The weekday (0 is Sunday) that the zone's calendar shows for the given date. */
function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Each instant in [from, to) at which the zone's clock reads `time` on a day that passes
 * `keep`. Walks one calendar day at a time in the zone, so clock changes are handled.
 */
function dailyIn(
  time: string,
  timeZone: string,
  from: number,
  to: number,
  keep: (weekday: number) => boolean,
  limit: number,
): number[] {
  const [hh, mm] = time.split(":").map(Number);
  // Start a day early: the zone's date at `from` may be behind UTC's.
  const start = partsIn(timeZone, from - DAY);
  const found: number[] = [];
  for (let add = 0; found.length < limit; add++) {
    const day = new Date(Date.UTC(start.year, start.month - 1, start.day + add));
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const at = instantOf(timeZone, y, m, d, hh, mm);
    if (at >= to) break;
    if (at >= from && keep(weekdayOf(y, m, d))) found.push(at);
  }
  return found;
}

/** When a repeating slot falls between `from` (included) and `to` (left out). */
export function slotTimes(slot: RepeatingSlot, from: number, to: number, limit = 200): number[] {
  if (slotProblem(slot)) return [];
  return dailyIn(slot.time, slot.timeZone, from, to, (day) => day === slot.weekday, limit);
}

/**
 * When a schedule trigger fires between `from` and `to`. A schedule that runs more than
 * once a day is shown once a day instead, by `perDay`, so the calendar stays readable.
 */
export function scheduleTimes(
  schedule: Schedule,
  from: number,
  to: number,
  nextRunAt: number | null,
  limit = 200,
): { times: number[]; perDay: boolean } {
  if (scheduleProblem(schedule)) return { times: [], perDay: false };
  if (schedule.mode === "daily") {
    return {
      times: dailyIn(schedule.time, schedule.timeZone, from, to, () => true, limit),
      perDay: false,
    };
  }
  const gap = schedule.minutes * 60_000;
  if (gap < DAY) return { times: [], perDay: true };
  if (nextRunAt === null) return { times: [], perDay: false };
  const times: number[] = [];
  // Step forward from the next run; runs before it are already history.
  let at = nextRunAt;
  if (at < from) at += Math.ceil((from - at) / gap) * gap;
  for (; at < to && times.length < limit; at += gap) times.push(at);
  return { times, perDay: false };
}

/** How far ahead the queue looks for free slots. */
export const QUEUE_WEEKS = 12;

export type QueuedPost = { id: string; platform: string; clientId?: string };
export type SlotWithId = RepeatingSlot & { id: string };
/** A slot time already holding a post: that slot, at that instant. */
export type TakenSlot = { slotId: string; at: number };

/**
 * Where each queued post goes: the earliest free time of a slot for its platform after
 * `now`, first come first served. A slot kept for a client only takes that client's posts;
 * a slot for no client takes anyone's. Posts no slot fits stay in the queue.
 */
export function fillQueue(
  queued: readonly QueuedPost[],
  slots: readonly SlotWithId[],
  taken: readonly TakenSlot[],
  now: number,
): { id: string; slotId: string; at: number }[] {
  const horizon = now + QUEUE_WEEKS * 7 * DAY;
  const busy = new Set(taken.map((entry) => `${entry.slotId}@${entry.at}`));
  const timesOf = new Map(slots.map((slot) => [slot.id, slotTimes(slot, now + 1, horizon)]));
  const placed: { id: string; slotId: string; at: number }[] = [];
  for (const post of queued) {
    let best: { slotId: string; at: number } | null = null;
    for (const slot of slots) {
      if (slot.platform !== post.platform) continue;
      if (slot.clientId && slot.clientId !== post.clientId) continue;
      const free = timesOf.get(slot.id)?.find((at) => !busy.has(`${slot.id}@${at}`));
      if (free !== undefined && (best === null || free < best.at))
        best = { slotId: slot.id, at: free };
    }
    if (!best) continue;
    busy.add(`${best.slotId}@${best.at}`);
    placed.push({ id: post.id, ...best });
  }
  return placed;
}
