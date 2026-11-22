export type JobWait = { reason: "own" | "turn" | "held"; limit: number } | null;

/** Says why a job that has not started yet is still waiting. */
export function waitingWords(wait: JobWait): string | null {
  if (!wait) return null;
  if (wait.reason === "own") {
    return wait.limit === 1
      ? "Waiting its turn. Your team runs one job at a time, so this starts when the current one ends."
      : `Waiting its turn. Your team runs ${wait.limit} jobs at a time, so this starts when one of them ends.`;
  }
  if (wait.reason === "held") {
    return "Waiting its turn. Processing is busy right now, so jobs go through a few at a time until it catches up.";
  }
  return "Waiting its turn. Other teams' jobs are being processed, and this one is next in line for your team.";
}
