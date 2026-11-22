import { type NodeProps, ReactFlowProvider } from "@xyflow/react";
import { screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Brand } from "@ncat-dash/automation-core";
import { renderInApp } from "@/test/render";

import { BrandContext, nodeTypes, type StepFlowNode } from "./flow-nodes";
import { type RunDetails, RunSteps } from "./run-steps";

const AT = 1_700_000_000_000;

function showMusicStep(brand: Brand) {
  const Step = nodeTypes.step;
  const props = {
    id: "music_1",
    type: "step",
    data: { node: { id: "music_1", kind: "step", stepId: "recipe-variant-music", input: {} } },
    selected: false,
    dragging: false,
    draggable: true,
    selectable: true,
    deletable: true,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  } as unknown as NodeProps<StepFlowNode>;
  return renderInApp(
    <BrandContext.Provider value={brand}>
      <ReactFlowProvider>
        <Step {...props} />
      </ReactFlowProvider>
    </BrandContext.Provider>,
  );
}

describe("Music Under Each Variant on the canvas", () => {
  test("says it is passed over until the team adds music, without asking for settings", () => {
    const { container } = showMusicStep({});
    expect(screen.getByText("Passed over until you add background music")).toBeTruthy();
    expect(screen.queryByText("Needs settings")).toBeNull();
    expect(screen.queryByText(/Needs your/)).toBeNull();
    expect(container.querySelector("svg.lucide-triangle-alert")).toBeNull();
  });

  test("with music in Settings it reads like any other step", () => {
    showMusicStep({ music: "upload:song" });
    expect(screen.queryByText(/Passed over/)).toBeNull();
    expect(screen.getByText("Music Under Each Variant")).toBeTruthy();
  });
});

function step(nodeId: string, over: Partial<RunDetails["steps"][number]> = {}) {
  return {
    _id: `s_${nodeId}`,
    nodeId,
    status: "done",
    outputs: [],
    error: undefined,
    startedAt: AT,
    finishedAt: AT + 1000,
    jobs: [],
    stage: undefined,
    plan: undefined,
    branches: undefined,
    resumeAt: undefined,
    retries: 0,
    retryAt: null,
    retryError: null,
    facts: [],
    ...over,
  } as RunDetails["steps"][number];
}

function run(steps: RunDetails["steps"]): RunDetails {
  return {
    _id: "run_1",
    automationId: "a_1",
    automationName: "UGC Ad Variants",
    status: "done",
    triggerKind: "manual",
    error: undefined,
    startedAt: AT,
    finishedAt: AT + 5000,
    retries: 0,
    hasCuts: false,
    trigger: {},
    startedWith: "boots.mp4",
    retryLimit: 2,
    startedByRun: null,
    startedRuns: [],
    nodes: [
      {
        id: "shape_1",
        kind: "step",
        stepId: "recipe-blur-fill",
        input: {},
        position: { x: 0, y: 0 },
      },
      {
        id: "music_1",
        kind: "step",
        stepId: "recipe-variant-music",
        input: {},
        position: { x: 300, y: 0 },
      },
    ],
    edges: [{ id: "e", source: "shape_1", target: "music_1" }],
    steps,
  } as unknown as RunDetails;
}

describe("Music Under Each Variant on the run page", () => {
  test("a step passed over for want of music says how to get copies with music", () => {
    renderInApp(
      <RunSteps
        run={run([step("shape_1"), step("music_1", { status: "skipped" })])}
        highlighted={null}
        busy={false}
        onDecide={vi.fn()}
      />,
    );
    const row = screen.getByRole("heading", { name: "Music Under Each Variant" }).closest("li")!;
    expect(row.textContent).toContain(
      "Passed over until your team adds its background music in Settings, under Brand.",
    );
  });

  test("one never reached still says no files came", () => {
    renderInApp(
      <RunSteps
        run={run([
          step("shape_1", { status: "failed" }),
          step("music_1", { status: "skipped", startedAt: undefined }),
        ])}
        highlighted={null}
        busy={false}
        onDecide={vi.fn()}
      />,
    );
    const row = screen.getByRole("heading", { name: "Music Under Each Variant" }).closest("li")!;
    expect(row.textContent).toContain("No files came this way.");
  });
});
