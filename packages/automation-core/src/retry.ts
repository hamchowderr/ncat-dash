/** How many times a failed step tries again when the team has not chosen a number. */
export const DEFAULT_STEP_RETRIES = 2;
/** The most times a team may ask a failed step to try again. */
export const MAX_STEP_RETRIES = 5;

// How long to wait before each new try. A toolkit that is restarting or busy needs a
// moment, so every wait is longer than the one before.
const WAITS_SECONDS = [30, 120, 300, 600, 900];

/** The wait before try-again number `retry` (the first is 1), in milliseconds. */
export function retryDelayMs(retry: number): number {
  const index = Math.min(Math.max(retry, 1), WAITS_SECONDS.length) - 1;
  return WAITS_SECONDS[index] * 1000;
}

/** A team's setting as a usable number: a whole number from 0 to the most allowed. */
export function retryLimit(setting: unknown): number {
  if (typeof setting !== "number" || !Number.isInteger(setting)) return DEFAULT_STEP_RETRIES;
  return Math.min(Math.max(setting, 0), MAX_STEP_RETRIES);
}

/**
 * Whether a step whose jobs failed should try again. It does while it has tries left
 * and no failure is one another try cannot fix, such as a setting the toolkit refuses.
 */
export function shouldRetry(
  retriesUsed: number,
  limit: number,
  failures: { permanent?: boolean }[],
): boolean {
  if (failures.length === 0 || retriesUsed >= limit) return false;
  return !failures.some((failure) => failure.permanent === true);
}

/** Whether an HTTP status from the toolkit is worth another try. */
export function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}
