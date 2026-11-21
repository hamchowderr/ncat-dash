import type { SpeedResult } from "../src/history";

let n = 0;
export function result(overrides: Partial<SpeedResult> = {}): SpeedResult {
  n += 1;
  return {
    at: `2026-11-2${Math.min(9, n)}T10:00:00.000Z`,
    batch: "b1",
    clipId: "talking-head-40s-vertical",
    clipName: "40 s vertical talking head",
    clipSeconds: 40,
    readyMadeId: "caption-uploads",
    readyMadeName: "Caption every new upload",
    status: "done",
    seconds: 100,
    firstStepAfter: 0.4,
    steps: [
      {
        nodeId: "caption_1",
        name: "Add captions",
        status: "done",
        seconds: 99,
        jobs: 2,
        retries: 0,
      },
    ],
    retries: 0,
    error: null,
    toolkit: { build: "219", cpus: 6, cpuPercent: 2, jobsRunning: 0 },
    runId: `run${n}`,
    dashboard: "https://kontifi.example",
    ...overrides,
  };
}
