import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { NodePanel } from "./node-panel";
import { type RunDetails, RunSteps } from "./run-steps";

const CAPTION = {
  id: "caption",
  kind: "step" as const,
  stepId: "video-caption",
  input: { font_size: 48 },
};

function panel(node: Parameters<typeof NodePanel>[0]["node"], onChange = vi.fn()) {
  renderInApp(
    <NodePanel
      node={node}
      before={[]}
      startGivesFile
      filled={{}}
      brand={{}}
      music={[]}
      onChange={onChange}
      onRemove={vi.fn()}
    />,
  );
  return onChange;
}

describe("turning a step off from its panel", () => {
  test("the switch turns it off, keeping its settings", () => {
    const onChange = panel(CAPTION);
    fireEvent.click(screen.getByRole("switch", { name: "Turn this step off" }));
    expect(onChange).toHaveBeenCalledWith({ off: true });
  });

  test("once off, the panel says what that means and can turn it back on", () => {
    const onChange = panel({ ...CAPTION, off: true });
    expect(screen.getByText(/Runs skip this step's work/)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Turn this step on" }));
    expect(onChange).toHaveBeenCalledWith({ off: undefined });
  });

  test("an If has no switch", () => {
    panel({ id: "if", kind: "if", input: {} });
    expect(screen.queryByRole("switch")).toBeNull();
  });
});

test("a run says a step was turned off and its files went straight on", () => {
  const run = {
    _id: "run_1",
    automationId: "a_1",
    automationName: "Weekly clips",
    status: "done",
    triggerKind: "manual",
    startedAt: 1000,
    finishedAt: 2000,
    retries: 0,
    hasCuts: false,
    trigger: {},
    retryLimit: 2,
    nodes: [{ ...CAPTION, off: true, position: { x: 0, y: 0 } }],
    edges: [],
    steps: [
      {
        _id: "s1",
        nodeId: "caption",
        status: "done",
        outputs: ["https://files.example/uploads/short-teaser.mp4"],
        startedAt: 1000,
        finishedAt: 1000,
        jobs: [],
        retries: 0,
        retryAt: null,
        retryError: null,
        facts: [],
      },
    ],
  } as unknown as RunDetails;
  renderInApp(<RunSteps run={run} highlighted={null} busy={false} onDecide={vi.fn()} />);
  const row = screen.getByRole("heading", { name: "Caption video" }).closest("li")!;
  expect(row.textContent).toContain("Turned off, so its files went straight on.");
  // The file it handed on is not shown as one it made.
  expect(screen.queryByRole("list", { name: "Files from Caption video" })).toBeNull();
});
