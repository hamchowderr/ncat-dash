import { screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { NodePanel } from "./node-panel";
import { type RunDetails, RunSteps } from "./run-steps";

const JOIN = { id: "join", kind: "step" as const, stepId: "video-concatenate", input: {} };

function panel(waitsFor: string[]) {
  renderInApp(
    <NodePanel
      node={JOIN}
      before={[]}
      startGivesFile
      filled={{}}
      brand={{}}
      music={[]}
      onChange={vi.fn()}
      onRemove={vi.fn()}
      waitsFor={waitsFor}
    />,
  );
}

describe("a step that joins two sides", () => {
  test("its panel says it waits for both and runs once", () => {
    panel(["Caption video", "Trim video"]);
    expect(
      screen.getByText(/Waits for Caption video and Trim video to finish, then runs once/),
    ).toBeTruthy();
  });

  test("a step with one step before it says nothing about waiting", () => {
    panel(["Caption video"]);
    expect(screen.queryByText(/Waits for/)).toBeNull();
  });

  test("in a run, it names the side it is still waiting for", () => {
    const step = (nodeId: string, status: string) => ({
      _id: `s_${nodeId}`,
      nodeId,
      status,
      outputs: [],
      startedAt: status === "pending" ? null : 1000,
      finishedAt: status === "done" ? 2000 : null,
      jobs: [],
      retries: 0,
      retryAt: null,
      retryError: null,
      facts: [],
    });
    const run = {
      _id: "run_1",
      automationId: "a_1",
      automationName: "Intro and talk",
      status: "running",
      triggerKind: "manual",
      startedAt: 1000,
      finishedAt: null,
      retries: 0,
      hasCuts: false,
      trigger: {},
      retryLimit: 2,
      startedByRun: null,
      startedRuns: [],
      nodes: [
        { id: "intro", kind: "step", stepId: "video-trim", input: {}, position: { x: 0, y: 0 } },
        {
          id: "talk",
          kind: "step",
          stepId: "video-caption",
          input: {},
          position: { x: 0, y: 150 },
        },
        { ...JOIN, position: { x: 220, y: 75 } },
      ],
      edges: [
        { id: "e1", source: "intro", target: "join" },
        { id: "e2", source: "talk", target: "join" },
      ],
      steps: [step("intro", "done"), step("talk", "running"), step("join", "pending")],
    } as unknown as RunDetails;
    renderInApp(<RunSteps run={run} highlighted={null} busy={false} onDecide={vi.fn()} />);
    const row = screen.getByRole("heading", { name: "Join videos" }).closest("li")!;
    expect(row.textContent).toContain("Waiting for Caption video to finish.");
  });
});
