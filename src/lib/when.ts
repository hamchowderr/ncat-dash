const ago = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" });
const dayMonthYear = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const full = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** "just now", "5 minutes ago", "yesterday", "2 weeks ago", "3 months ago", "last year". */
export function timeAgo(at: number, now = Date.now()): string {
  const seconds = Math.round((at - now) / 1000);
  if (Math.abs(seconds) < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return ago.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return ago.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return ago.format(days, "day");
  const weeks = Math.round(days / 7);
  if (Math.abs(days) < 30) return ago.format(weeks, "week");
  const months = Math.round(days / 30.44);
  if (Math.abs(months) < 12) return ago.format(months, "month");
  return ago.format(Math.round(days / 365.25), "year");
}

/** "6 November", with the year only when it is not this year. */
export function dayOf(at: number, now = Date.now()): string {
  return new Date(at).getFullYear() === new Date(now).getFullYear()
    ? dayMonth.format(at)
    : dayMonthYear.format(at);
}

/** The exact moment, for a hover title. */
export function exactly(at: number): string {
  return full.format(at);
}
