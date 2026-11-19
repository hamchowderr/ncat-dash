// Calendar arithmetic in the viewer's own time zone. Days are keyed "2026-11-19" so
// entries and cells match without caring about the hour.

export type View = "month" | "week";

const pad = (value: number) => String(value).padStart(2, "0");

/** The local day an instant falls on, as "YYYY-MM-DD". */
export function dayKey(at: number | Date): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight of the given day. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** The Sunday that starts the week holding `date`. */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  return addDays(day, -day.getDay());
}

/**
 * The days a view shows, Sunday first: whole weeks covering the month for "month", or the
 * seven days of the week for "week". `to` is the day after the last one.
 */
export function visibleDays(view: View, anchor: Date): { days: Date[]; from: Date; to: Date } {
  if (view === "week") {
    const from = startOfWeek(anchor);
    const days = Array.from({ length: 7 }, (_, index) => addDays(from, index));
    return { days, from, to: addDays(from, 7) };
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const from = startOfWeek(first);
  const to = addDays(startOfWeek(last), 7);
  const days: Date[] = [];
  for (let day = from; day < to; day = addDays(day, 1)) days.push(day);
  return { days, from, to };
}

/** The anchor one step back or forward: a month in month view, a week in week view. */
export function step(view: View, anchor: Date, by: 1 | -1): Date {
  if (view === "week") return addDays(anchor, 7 * by);
  return new Date(anchor.getFullYear(), anchor.getMonth() + by, 1);
}

/** The heading for a view: "November 2026", or "Nov 15 – 21, 2026" for a week. */
export function viewTitle(view: View, anchor: Date): string {
  if (view === "month") {
    return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(anchor);
  }
  const { from, to } = visibleDays("week", anchor);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).formatRange(from, addDays(to, -1));
}

/** The hour a post without a time gets when it is dropped on a day. */
export const DEFAULT_HOUR = 10;
/** When a project slot is due on the day it is dropped on: end of the working day. */
export const DUE_HOUR = 17;

/**
 * Where a dragged item lands on `day`. In month view it keeps its own time of day (or
 * takes `hour` when it had none); in week view the hour cell it is dropped on decides.
 */
export function landing(
  day: Date,
  previous: number | null,
  hour: number | null,
  fallbackHour: number,
) {
  const target = startOfDay(day);
  if (hour !== null) {
    const minutes = previous === null ? 0 : new Date(previous).getMinutes();
    return new Date(
      target.getFullYear(),
      target.getMonth(),
      target.getDate(),
      hour,
      minutes,
    ).getTime();
  }
  if (previous === null) {
    return new Date(
      target.getFullYear(),
      target.getMonth(),
      target.getDate(),
      fallbackHour,
    ).getTime();
  }
  const before = new Date(previous);
  return new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
    before.getHours(),
    before.getMinutes(),
  ).getTime();
}

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const onTheHour = new Intl.DateTimeFormat(undefined, { hour: "numeric" });

/** "10 AM" or "10:30 AM", short as Google Calendar writes them, in the viewer's own way. */
export function timeLabel(at: number): string {
  return new Date(at).getMinutes() === 0 ? onTheHour.format(at) : clock.format(at);
}

/** A local date and time as a datetime-local input writes it. */
export function toInputValue(at: number): string {
  const date = new Date(at);
  return `${dayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The instant a datetime-local input's value stands for, or null when it is empty. */
export function fromInputValue(value: string): number | null {
  if (!value) return null;
  const at = new Date(value).getTime();
  return Number.isNaN(at) ? null : at;
}

/** "Every 15 minutes", "Every 2 hours". */
export function everyLabel(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "Every hour" : `Every ${hours} hours`;
  }
  return `Every ${minutes} minutes`;
}

/** "Mon", for column heads. */
export const WEEKDAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: "short" });
