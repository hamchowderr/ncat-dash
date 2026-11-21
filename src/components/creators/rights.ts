/** How usage rights read on screen. Dates are plain "YYYY-MM-DD" days. */

const DAY_MS = 24 * 60 * 60 * 1000;

export type Usage = "organic" | "paid" | "both";

export const USAGES: { value: Usage; label: string }[] = [
  { value: "organic", label: "Organic" },
  { value: "paid", label: "Paid ads" },
  { value: "both", label: "Both" },
];

export function sayUsage(usage: Usage): string {
  return usage === "organic" ? "Organic posts" : usage === "paid" ? "Paid ads" : "Organic and paid";
}

/** Today on the viewer's own calendar, as "YYYY-MM-DD". */
export function localToday(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export type Tone = "ended" | "soon" | "later";

/** When a deal ends, in words, and whether that is within a week. */
export function rightsStatus(endsOn: string, today: string): { label: string; tone: Tone } {
  const left = Math.round(
    (Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS,
  );
  const day = new Date(`${endsOn}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  if (left < 0) return { label: `Ended ${day}`, tone: "ended" };
  if (left === 0) return { label: `Last day today, ${day}`, tone: "soon" };
  if (left === 1) return { label: `Last day tomorrow, ${day}`, tone: "soon" };
  return { label: `Last day ${day}, in ${left} days`, tone: left <= 7 ? "soon" : "later" };
}

export const TONE_CLASS: Record<Tone, string> = {
  soon: "text-amber-700",
  ended: "text-muted-foreground",
  later: "text-muted-foreground",
};
