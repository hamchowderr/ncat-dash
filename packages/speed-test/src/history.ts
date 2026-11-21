import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { StepTime } from "./timings";

/** How busy the toolkit was just before a run started. */
export interface ToolkitState {
  build: string | null;
  cpus: number;
  cpuPercent: number;
  jobsRunning: number;
}

/** One run of the test, as kept in the history file (one JSON object per line). */
export interface SpeedResult {
  /** When the run started, as an ISO date. */
  at: string;
  /** Every result from the same `pnpm speed-test` shares this. */
  batch: string;
  clipId: string;
  clipName: string;
  clipSeconds: number;
  readyMadeId: string;
  readyMadeName: string;
  /** "too-slow": the test stopped it at its time limit. */
  status: "done" | "waiting" | "failed" | "cancelled" | "too-slow";
  seconds: number | null;
  firstStepAfter: number | null;
  steps: StepTime[];
  retries: number;
  error: string | null;
  toolkit: ToolkitState | null;
  runId: string;
  /** Where the dashboard runs, so results from different copies are told apart. */
  dashboard: string;
  note?: string;
}

/** Every result kept so far, oldest first. Lines that can't be read are left out. */
export async function readHistory(path: string): Promise<SpeedResult[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return parseHistory(text);
}

export function parseHistory(text: string): SpeedResult[] {
  const results: SpeedResult[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as SpeedResult;
      if (value && typeof value.at === "string" && typeof value.readyMadeId === "string") {
        results.push(value);
      }
    } catch {
      // A line cut short by a run that was stopped: skip it.
    }
  }
  return results.sort((a, b) => a.at.localeCompare(b.at));
}

export async function appendResult(path: string, result: SpeedResult): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(result)}\n`, "utf8");
}

export type Verdict = "first" | "slower" | "faster" | "same" | "no-time";

export interface Comparison {
  verdict: Verdict;
  /** The middle time of up to five earlier finished runs of the same ready-made on the same video. */
  before: number | null;
  /** How much longer (positive) or shorter (negative) than before, as a fraction. */
  change: number | null;
  earlierRuns: number;
}

/** A run counts as slower or faster only past both of these, so ordinary wobble doesn't. */
export const CHANGE_FRACTION = 0.25;
export const CHANGE_SECONDS = 15;

const finished = (result: SpeedResult) =>
  (result.status === "done" || result.status === "waiting") && result.seconds !== null;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** How a result compares with earlier runs of the same ready-made on the same video. */
export function compare(result: SpeedResult, history: SpeedResult[]): Comparison {
  const earlier = history
    .filter(
      (other) =>
        other.at < result.at &&
        other.clipId === result.clipId &&
        other.readyMadeId === result.readyMadeId &&
        other.dashboard === result.dashboard &&
        finished(other),
    )
    .slice(-5);
  if (result.seconds === null || !finished(result)) {
    return { verdict: "no-time", before: null, change: null, earlierRuns: earlier.length };
  }
  if (earlier.length === 0) {
    return { verdict: "first", before: null, change: null, earlierRuns: 0 };
  }
  const before = median(earlier.map((other) => other.seconds!));
  const change = (result.seconds - before) / before;
  const difference = result.seconds - before;
  const verdict: Verdict =
    change >= CHANGE_FRACTION && difference >= CHANGE_SECONDS
      ? "slower"
      : change <= -CHANGE_FRACTION && -difference >= CHANGE_SECONDS
        ? "faster"
        : "same";
  return { verdict, before, change, earlierRuns: earlier.length };
}
