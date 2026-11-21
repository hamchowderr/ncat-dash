import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { nodeLook } from "./flow-nodes";
import { NodePanel } from "./node-panel";
import { PicksPanel } from "./picks-panel";
import type { RunDetails } from "./run-steps";

type PanelNode = Parameters<typeof NodePanel>[0]["node"];

function panel(node: PanelNode) {
  const onChange = vi.fn();
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

const CLEANUP = { id: "cleanup", kind: "cleanup", input: {} } as const;

describe("the Clean Up Pauses And Retakes step", () => {
  test("works as it is dropped in, with its usual values shown", () => {
    panel(CLEANUP);
    expect(screen.getAllByText("Clean Up Pauses And Retakes").length).toBeGreaterThan(0);
    expect(screen.getByRole("textbox", { name: "Take down pauses over" })).toHaveValue("0.6");
    expect(screen.getByRole("textbox", { name: "Leave a breath of" })).toHaveValue("0.25");
    expect(
      screen.getByRole("switch", { name: "Keep only the last take of a line said again" }),
    ).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Hook takes" })).toHaveTextContent(
      "When the creator says them",
    );
    expect(screen.getByText(/Say “hook one”, “hook two”/)).toBeInTheDocument();
    // What the step finds for itself.
    expect(screen.getByText(/where the toolkit hears silence in the video/)).toBeInTheDocument();
  });

  test("saves a creator, a pause length and retakes turned off", async () => {
    const user = userEvent.setup();
    const onChange = panel(CLEANUP);
    await user.type(screen.getByRole("textbox", { name: "Creator" }), "Jane");
    expect(onChange).toHaveBeenLastCalledWith({ input: { creator: "Jane" } });
    const over = screen.getByRole("textbox", { name: "Take down pauses over" });
    await user.clear(over);
    await user.type(over, "1.2");
    expect(onChange).toHaveBeenLastCalledWith({ input: { cutPausesOver: 1.2 } });
    await user.click(
      screen.getByRole("switch", { name: "Keep only the last take of a line said again" }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ input: { retakes: false } });
  });

  test("asks how many hooks only when the first takes are hooks", () => {
    panel({ ...CLEANUP, input: { hooks: "count", hookCount: 4 } });
    expect(screen.getByRole("textbox", { name: "How many hooks" })).toHaveValue("4");
  });

  test("says on the canvas how hook takes are found", () => {
    expect(nodeLook({ kind: "cleanup", input: {} }).kind).toBe("Splits hook takes you name");
    expect(nodeLook({ kind: "cleanup", input: { hooks: "none" } }).kind).toBe("One cleaned video");
  });
});

describe("a finished cleanup on the run page", () => {
  test("says what was taken out and links each hook take and the body", () => {
    const run = {
      _id: "run_1",
      status: "done",
      testOf: undefined,
      edges: [],
      nodes: [{ id: "cleanup", kind: "cleanup", input: {}, position: { x: 0, y: 0 } }],
      steps: [
        {
          _id: "s1",
          nodeId: "cleanup",
          status: "done",
          outputs: [],
          jobs: [
            { status: "done", outputs: ["https://files.example/h1.mp4"] },
            { status: "done", outputs: ["https://files.example/h2.mp4"] },
            { status: "done", outputs: ["https://files.example/body.mp4"] },
          ],
          cleaned: [
            {
              source: "https://files.example/raw.mp4",
              before: 192,
              after: 125,
              pauses: 14,
              pauseSeconds: 31.4,
              retakes: 3,
              retakeSeconds: 22,
              hooks: 2,
              labels: ["hook01", "hook02", "body"],
            },
          ],
        },
      ],
    } as unknown as RunDetails;
    renderInApp(<PicksPanel run={run} busy={false} onFindMore={vi.fn()} />);
    const section = screen.getByRole("region", { name: "Clean Up Pauses And Retakes" });
    expect(
      within(section).getByText(
        "Took out 14 long pauses (31 s) and 3 retakes (22 s). Split out 2 hook takes and the body.",
      ),
    ).toBeInTheDocument();
    expect(within(section).getByText("3 min 12 s down to 2 min 5 s")).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "Hook 2" })).toHaveAttribute(
      "href",
      "https://files.example/h2.mp4",
    );
    expect(within(section).getByRole("link", { name: "Body" })).toHaveAttribute(
      "href",
      "https://files.example/body.mp4",
    );
  });
});
