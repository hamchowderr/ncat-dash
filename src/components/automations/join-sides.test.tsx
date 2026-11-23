import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { NodePanel } from "./node-panel";
import { type RunDetails, RunSteps } from "./run-steps";

const JOIN = { id: "join", kind: "step" as const, stepId: "video-concatenate", input: {} };

function panel(waitsFor: string[], node: Record<string, unknown> = JOIN, onChange = vi.fn()) {
  renderInApp(
    <NodePanel
      node={node as typeof JOIN}
      before={[]}
      startGivesFile
      filled={{}}
      brand={{}}
      music={[]}
      onChange={onChange}
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

  test("its files can be paired by upload, in order, or taken from the first side done", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    panel(["Trim video", "Caption video"], JOIN, onChange);
    await user.click(screen.getByRole("combobox", { name: "When files meet" }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Wait for all, then use every file",
      "Pair files from the same upload",
      "Pair files in order",
      "Use whichever line finishes first",
    ]);
    await user.click(screen.getByRole("option", { name: "Pair files from the same upload" }));
    expect(onChange).toHaveBeenCalledWith({ join: "source" });
  });

  test("says what the picked way does, and goes back to the default with nothing saved", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    panel(["Trim video", "Caption video"], { ...JOIN, join: "first" }, onChange);
    expect(
      screen.getByText(
        "Starts as soon as one of Trim video and Caption video finishes, with only its files. Files from the slower ones are not used.",
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole("combobox", { name: "When files meet" }));
    await user.click(screen.getByRole("option", { name: "Wait for all, then use every file" }));
    expect(onChange).toHaveBeenCalledWith({ join: undefined });
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
