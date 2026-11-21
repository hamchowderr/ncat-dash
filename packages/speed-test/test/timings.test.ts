import { describe, expect, it } from "vitest";
import { isSettled, type RunView, timeRun } from "../src/timings";

const T = 1_700_000_000_000;

function view(overrides: Partial<RunView> = {}): RunView {
  return {
    status: "done",
    error: null,
    startedAt: T,
    finishedAt: T + 95_000,
    retries: 0,
    nodes: [
      { id: "clips", kind: "clips" },
      { id: "caption_1", kind: "step", stepId: "video-caption" },
    ],
    steps: [
      {
        nodeId: "caption_1",
        status: "done",
        startedAt: T + 40_000,
        finishedAt: T + 95_000,
        retries: 1,
        jobs: [{}, {}, {}],
      },
      {
        nodeId: "clips",
        status: "done",
        startedAt: T + 1_000,
        finishedAt: T + 40_000,
        retries: 0,
        jobs: [{}],
      },
    ],
    ...overrides,
  };
}

describe("timeRun", () => {
  it("times the run and each step in the order they ran, with the canvas's names", () => {
    const time = timeRun(view());
    expect(time.seconds).toBe(95);
    expect(time.firstStepAfter).toBe(1);
    expect(time.steps.map((step) => [step.nodeId, step.seconds, step.jobs, step.retries])).toEqual([
      ["clips", 39, 1, 0],
      ["caption_1", 55, 3, 1],
    ]);
    expect(time.steps[0].name).not.toBe("clips");
    expect(time.steps[1].name).toMatch(/caption/i);
  });

  it("uses a step's own label when it has one", () => {
    const time = timeRun(
      view({
        nodes: [
          { id: "clips", kind: "clips", label: "Cut it up" },
          { id: "caption_1", kind: "step", stepId: "video-caption" },
        ],
      }),
    );
    expect(time.steps[0].name).toBe("Cut it up");
  });

  it("stops the clock at an approval, which is a person's time", () => {
    const time = timeRun(
      view({
        status: "waiting",
        finishedAt: null,
        nodes: [
          { id: "fill_1", kind: "step", stepId: "recipe-blur-fill" },
          { id: "approval", kind: "approval" },
        ],
        steps: [
          {
            nodeId: "fill_1",
            status: "done",
            startedAt: T + 500,
            finishedAt: T + 61_000,
            retries: 0,
            jobs: [{}],
          },
          {
            nodeId: "approval",
            status: "waiting_approval",
            startedAt: T + 61_000,
            finishedAt: null,
            retries: 0,
            jobs: [],
          },
        ],
      }),
    );
    expect(time.seconds).toBe(61);
    expect(time.steps.map((step) => step.nodeId)).toEqual(["fill_1"]);
  });

  it("has no total while the run is going, and leaves out steps that never started", () => {
    const time = timeRun(
      view({
        status: "running",
        finishedAt: null,
        steps: [
          {
            nodeId: "clips",
            status: "running",
            startedAt: T + 1_000,
            finishedAt: null,
            retries: 0,
            jobs: [{}],
          },
          {
            nodeId: "caption_1",
            status: "pending",
            startedAt: null,
            finishedAt: null,
            retries: 0,
            jobs: [],
          },
        ],
      }),
    );
    expect(time.seconds).toBeNull();
    expect(time.steps).toEqual([expect.objectContaining({ nodeId: "clips", seconds: null })]);
  });
});

describe("isSettled", () => {
  it("is settled when ended or at an approval, not while running or at a Wait", () => {
    expect(isSettled(view())).toBe(true);
    expect(isSettled(view({ status: "failed" }))).toBe(true);
    expect(isSettled(view({ status: "running" }))).toBe(false);
    expect(
      isSettled(
        view({
          status: "waiting",
          nodes: [{ id: "wait_1", kind: "wait" }],
          steps: [
            {
              nodeId: "wait_1",
              status: "running",
              startedAt: T,
              finishedAt: null,
              retries: 0,
              jobs: [],
            },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      isSettled(
        view({
          status: "waiting",
          nodes: [{ id: "approval", kind: "approval" }],
          steps: [
            {
              nodeId: "approval",
              status: "waiting_approval",
              startedAt: T,
              finishedAt: null,
              retries: 0,
              jobs: [],
            },
          ],
        }),
      ),
    ).toBe(true);
  });
});
