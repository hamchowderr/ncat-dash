/**
 * Dates for creator usage rights, kept as plain "YYYY-MM-DD" days so they read the same
 * wherever the team is. The alert goes out `WARN_DAYS` before the last day.
 */

export const WARN_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether this is a real calendar day written as "YYYY-MM-DD". */
export function isDay(value: string): boolean {
  const match = DAY.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The day a moment falls on, in UTC. */
export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** A day so many days after another. */
export function addDays(day: string, days: number): string {
  return dayOf(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS);
}

/** Whole days from one day to another (negative when `to` came first). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** A day said in words, such as "Friday, November 27". */
export function sayDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** How far off a day is, in words: "today", "tomorrow", "in 5 days". */
export function sayHowSoon(daysLeft: number): string {
  if (daysLeft <= 0) return "today";
  if (daysLeft === 1) return "tomorrow";
  return `in ${daysLeft} days`;
}

export type RightsUsage = "organic" | "paid" | "both";

/** What a deal covers, in words. */
export function sayUsage(usage: RightsUsage): string {
  return usage === "organic" ? "Organic posts" : usage === "paid" ? "Paid ads" : "Organic and paid";
}

/** What the alert says, for a deal whose rights end on `endsOn`, seen on `today`. */
export function rightsMessage(endsOn: string, today: string, usage: RightsUsage = "both"): string {
  const left = daysBetween(today, endsOn);
  const what = usage === "organic" ? "posts" : "ads and posts";
  const covers = `${sayUsage(usage)}.`;
  if (left <= 0)
    return `The last day you may use their footage is today. Take down ${what} with their clips, or agree new dates with them. ${covers}`;
  return `The last day you may use their footage is ${sayHowSoon(left)}, on ${sayDay(endsOn)}. Take down ${what} with their clips by then, or agree new dates with them. ${covers}`;
}

/** A creator's name as it is kept: trimmed, single spaces. */
export function cleanCreator(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}
