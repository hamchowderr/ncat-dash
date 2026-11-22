/** How many runs of one automation can go at once, as offered. No limit when none is set. */
export const RUNS_AT_ONCE = [1, 2, 3, 5, 10] as const;

/** The limit in words, for the run page: "one at a time", "3 at a time". */
export function atATime(limit: number): string {
  return limit === 1 ? "one at a time" : `${limit} at a time`;
}
