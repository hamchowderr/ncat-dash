import { describe, expect, it } from "vitest";
import type { ToolkitState } from "../src/history";
import type { Backend } from "../src/kontifi";
import { planRuns } from "../src/plan";
import { runSpeedTest } from "../src/run";
import type { RunView } from "../src/timings";

const quiet: ToolkitState = { build: "219", cpus: 6, cpuPercent: 1, jobsRunning: 0 };

/** A stand-in dashboard: each run takes `takes` ms of the fake clock, then is done. */
function standIn(
  options: { takes?: number; toolkit?: (ToolkitState | null)[]; never?: boolean } = {},
) {
  let clock = 1_700_000_000_000;
  const calls: string[] = [];
  const runs = new Map<string, { started: number }>();
  const toolkit = [...(options.toolkit ?? [quiet])];
  const backend: Backend = {
    async automationFor(id, name) {
      calls.push(`automation ${id} "${name}"`);
      return `auto-${id}`;
    },
    async start(automationId, url) {
      const id = `run${runs.size + 1}`;
      runs.set(id, { started: clock });
      calls.push(`start ${automationId} ${url.split("/").pop()}`);
      return id;
    },
    async run(runId): Promise<RunView> {
      const run = runs.get(runId)!;
      const end = run.started + (options.takes ?? 30_000);
      const done = !options.never && clock >= end && !calls.includes(`cancel ${runId}`);
      return {
        status: calls.includes(`cancel ${runId}`) ? "cancelled" : done ? "done" : "running",
        error: null,
        startedAt: run.started,
        finishedAt: done ? end : null,
        retries: 0,
        nodes: [{ id: "caption_1", kind: "step", stepId: "video-caption" }],
        steps: [
          {
            nodeId: "caption_1",
            status: done ? "done" : "running",
            startedAt: run.started + 200,
            finishedAt: done ? end : null,
            retries: 0,
            jobs: [{}],
          },
        ],
      };
    },
    async cancel(runId) {
      calls.push(`cancel ${runId}`);
    },
    async toolkit() {
      return toolkit.length > 1 ? toolkit.shift()! : toolkit[0];
    },
  };
  return {
    backend,
    calls,
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
  };
}

const plan = planRuns({
  onlyClips: ["talking-head-40s-vertical"],
  onlyReadyMades: ["caption-uploads", "social-clips"],
});

describe("runSpeedTest", () => {
  it("runs one at a time, makes each automation once, and times every run", async () => {
    const fake = standIn({ takes: 95_000 });
    const saved: string[] = [];
    const results = await runSpeedTest({
      ...fake,
      plan: [...plan, plan[0]],
      dashboard: "https://kontifi.example",
      batch: "b1",
      onResult: (result) => {
        saved.push(result.runId);
      },
    });
    expect(fake.calls.filter((call) => call.startsWith("automation"))).toEqual([
      'automation caption-uploads "Speed Test: Caption every new upload"',
      'automation social-clips "Speed Test: Clips for social"',
    ]);
    // Each run starts only after the one before it has ended.
    expect(fake.calls.filter((call) => call.startsWith("start"))).toHaveLength(3);
    expect(saved).toEqual(["run1", "run2", "run3"]);
    expect(results[0]).toMatchObject({
      batch: "b1",
      status: "done",
      seconds: 95,
      clipSeconds: 40,
      readyMadeName: "Caption every new upload",
      toolkit: quiet,
      dashboard: "https://kontifi.example",
    });
    expect(results[0].note).toBeUndefined();
  });

  it("waits for a busy toolkit to go quiet before starting", async () => {
    const busy = { ...quiet, cpuPercent: 90, jobsRunning: 2 };
    const fake = standIn({ toolkit: [busy, busy, quiet] });
    const lines: string[] = [];
    const [result] = await runSpeedTest({
      ...fake,
      plan: [plan[0]],
      dashboard: "d",
      log: (l) => lines.push(l),
    });
    expect(lines.filter((line) => line.includes("busy"))).toHaveLength(2);
    expect(result.toolkit).toEqual(quiet);
    expect(result.note).toBeUndefined();
  });

  it("runs anyway after waiting long enough, and says the time is not fair", async () => {
    const busy = { ...quiet, jobsRunning: 1 };
    const fake = standIn({ toolkit: [busy] });
    const [result] = await runSpeedTest({
      ...fake,
      plan: [plan[0]],
      dashboard: "d",
      quietWaitMs: 60_000,
      note: "after #160",
    });
    expect(result.status).toBe("done");
    expect(result.note).toBe(
      "after #160 The toolkit was still busy when this run started, so it is slower than it should be.",
    );
  });

  it("runs without a toolkit reading", async () => {
    const fake = standIn({ toolkit: [null] });
    const [result] = await runSpeedTest({ ...fake, plan: [plan[0]], dashboard: "d" });
    expect(result).toMatchObject({ status: "done", toolkit: null });
  });

  it("stops a run at its time limit and records it as too slow", async () => {
    const fake = standIn({ never: true });
    const [result] = await runSpeedTest({
      ...fake,
      plan: [plan[0]],
      dashboard: "d",
      pollMs: 60_000,
    });
    expect(fake.calls).toContain("cancel run1");
    expect(result.status).toBe("too-slow");
    expect(result.error).toBe("stopped at the time limit");
    expect(result.seconds).toBeGreaterThanOrEqual(15 * 60 + 40 * 8);
  });
});

describe("runSpeedTest when a run can't start", () => {
  it("records it as failed and goes on with the rest", async () => {
    const fake = standIn();
    const realFor = fake.backend.automationFor;
    fake.backend.automationFor = async (id, name) => {
      if (id === "caption-uploads") {
        throw new Error(
          '[Request ID: x] Server Error\nUncaught ConvexError: {"code":"not_found","message":"Unknown starter."}',
        );
      }
      return realFor(id, name);
    };
    const realStart = fake.backend.start;
    let starts = 0;
    fake.backend.start = async (id, url) => {
      starts += 1;
      if (starts === 1) throw new Error("trial over");
      return realStart(id, url);
    };
    const results = await runSpeedTest({
      ...fake,
      plan: [plan[0], plan[1], plan[1]],
      dashboard: "d",
    });
    expect(results.map((r) => [r.status, r.error])).toEqual([
      ["failed", "couldn't start: Unknown starter."],
      ["failed", "couldn't start: trial over"],
      ["done", null],
    ]);
  });
});
