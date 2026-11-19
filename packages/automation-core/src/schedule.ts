export type Schedule =
  { mode: "interval"; minutes: number } | { mode: "daily"; time: string; timeZone: string };

export const MIN_INTERVAL_MINUTES = 5;

/** A plain-language problem with a schedule, or null when it is usable. */
export function scheduleProblem(schedule: Schedule): string | null {
  if (schedule.mode === "interval") {
    if (!Number.isInteger(schedule.minutes) || schedule.minutes < MIN_INTERVAL_MINUTES) {
      return `Run at most once every ${MIN_INTERVAL_MINUTES} minutes.`;
    }
    if (schedule.minutes > 60 * 24 * 31) return "The longest gap between runs is 31 days.";
    return null;
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)) return "Use a time like 09:30.";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: schedule.timeZone });
  } catch {
    return "Unknown time zone.";
  }
  return null;
}

export function partsIn(timeZone: string, instant: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(instant));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** How far the zone's wall clock is ahead of UTC at `instant`, in milliseconds. */
function offsetAt(timeZone: string, instant: number): number {
  const p = partsIn(timeZone, instant);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(instant / 1000) * 1000;
}

/** The instant at which the zone's wall clock reads the given date and time. */
export function instantOf(timeZone: string, y: number, m: number, d: number, hh: number, mm: number) {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes settle the offset on days when the clocks change.
  const guess = wall - offsetAt(timeZone, wall);
  return wall - offsetAt(timeZone, guess);
}

/** The first time the schedule fires strictly after `after` (both in epoch milliseconds). */
export function nextRunAt(schedule: Schedule, after: number): number {
  if (schedule.mode === "interval") return after + schedule.minutes * 60_000;

  const [hh, mm] = schedule.time.split(":").map(Number);
  const today = partsIn(schedule.timeZone, after);
  for (let add = 0; add <= 2; add++) {
    // Date.UTC rolls a day past the end of the month into the next month.
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + add));
    const candidate = instantOf(
      schedule.timeZone,
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      hh,
      mm,
    );
    if (candidate > after) return candidate;
  }
  return after + 24 * 60 * 60_000;
}
