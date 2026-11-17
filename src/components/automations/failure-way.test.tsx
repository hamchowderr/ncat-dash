import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { NodePanel } from "./node-panel";
import { passedAlong, type RunDetails, RunSteps } from "./run-steps";

const FILE = "https://files.example/uploads/short-teaser.mp4";
const TRIM = { id: "trim", kind: "step" as const, stepId: "video-trim", input: {} };

function panel(failSteps: string[], onAddOnFailure = vi.fn()) {
  renderInApp(
    <NodePanel
      node={TRIM}
      before={[]}
      startGivesFile
      filled={{}}
      brand={{}}
      music={[]}
      onChange={vi.fn()}
      onRemove={vi.fn()}
      failSteps={failSteps}
      onAddOnFailure={onAddOnFailure}
    />,
  );
  return within(screen.getByRole("region", { name: "If it fails" }));
}

describe("a step's way for when it fails, in its panel", () => {
  test("with nothing there, it says the run stops and offers to add a step", () => {
    const onAdd = vi.fn();
    const section = panel([], onAdd);
    expect(section.getByText(/The run stops here/)).toBeTruthy();
    fireEvent.click(section.getByRole("button", { name: "Add a step" }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  test("with steps there, it names them", () => {
    const section = panel(["Caption video"]);
    expect(section.getByText(/Its files go to Caption video instead/)).toBeTruthy();
    expect(section.getByRole("button", { name: "Add another" })).toBeTruthy();
  });
});

function run(): RunDetails {
  const step = (nodeId: string, over: Record<string, unknown>) => ({
    _id: `s_${nodeId}`,
    nodeId,
    outputs: [],
    startedAt: 1000,
    finishedAt: 2000,
    jobs: [],
    retries: 0,
    retryAt: null,
    retryError: null,
    facts: [],
    ...over,
  });
  return {
    _id: "run_1",
    automationId: "a_1",
    automationName: "Weekly clips",
    status: "done",
    triggerKind: "upload",
    startedAt: 1000,
    finishedAt: 3000,
    retries: 0,
    hasCuts: false,
    trigger: { file_url: FILE },
    startedWith: "short-teaser.mp4",
    retryLimit: 2,
    nodes: [
      { ...TRIM, position: { x: 0, y: 0 } },
      {
        id: "thumb",
        kind: "step",
        stepId: "video-thumbnail",
        input: {},
        position: { x: 220, y: 0 },
      },
      {
        id: "caption",
        kind: "step",
        stepId: "video-caption",
        input: {},
        position: { x: 220, y: 150 },
      },
    ],
    edges: [
      { id: "e1", source: "trim", target: "thumb" },
      { id: "e2", source: "trim", target: "caption", branch: "failed" },
    ],
    steps: [
      step("trim", { status: "failed", error: "FFmpeg gave up.", outputs: [FILE] }),
      step("thumb", { status: "skipped" }),
      step("caption", { status: "done", outputs: ["https://files.example/out/c.mp4"] }),
    ],
  } as unknown as RunDetails;
}

describe("a run where a step failed and its way for failing was taken", () => {
  test("its files go along that way only", () => {
    const passed = passedAlong(run() as Parameters<typeof passedAlong>[0]);
    expect(passed.get("trim>caption")).toEqual([FILE]);
    expect(passed.has("trim>thumb")).toBe(false);
  });

  test("the list says where they went, and shows them only as the next step's", () => {
    renderInApp(<RunSteps run={run()} highlighted={null} busy={false} onDecide={vi.fn()} />);
    const trim = screen.getByRole("heading", { name: "Trim video" }).closest("li")!;
    expect(trim.textContent).toContain("Failed, so its files went the way for when it fails.");
    expect(trim.textContent).toContain("FFmpeg gave up.");
    expect(screen.queryByRole("list", { name: "Files from Trim video" })).toBeNull();
    const caption = screen.getByRole("heading", { name: "Caption video" }).closest("li")!;
    expect(caption.textContent).toContain("Got short-teaser.mp4");
  });
});
