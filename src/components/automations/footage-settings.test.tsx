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

const CHECK = { id: "check_1", kind: "footage-check", input: {} } as const;

describe("the Check Footage step", () => {
  test("works as it is dropped in, with its usual values shown", () => {
    panel(CHECK);
    expect(screen.getAllByText("Check Footage").length).toBeGreaterThan(0);
    expect(screen.getByRole("combobox", { name: "Filmed in" })).toHaveTextContent(
      "Vertical (9:16)",
    );
    expect(screen.getByRole("textbox", { name: "Short side at least" })).toHaveValue("720");
    expect(screen.getByRole("textbox", { name: "Videos at least" })).toHaveValue("5");
    expect(screen.getByRole("textbox", { name: "Hook and ending takes at least" })).toHaveValue(
      "1",
    );
    expect(screen.getByRole("textbox", { name: "Sound at least" })).toHaveValue("-35");
    expect(screen.getByRole("combobox", { name: "When something is wrong" })).toHaveTextContent(
      "Stop before editing",
    );
    expect(screen.getByText(/Nothing is edited until better footage lands/)).toBeInTheDocument();
    // What the step finds for itself.
    expect(screen.getByText(/each hook and ending take, measured by FFmpeg/)).toBeInTheDocument();
  });

  test("saves a shape, a size and telling instead of stopping", async () => {
    const user = userEvent.setup();
    const onChange = panel(CHECK);
    const pixels = screen.getByRole("textbox", { name: "Short side at least" });
    await user.clear(pixels);
    await user.type(pixels, "1080");
    expect(onChange).toHaveBeenLastCalledWith({ input: { minShortSide: 1080 } });
    await user.click(screen.getByRole("combobox", { name: "Filmed in" }));
    await user.click(screen.getByRole("option", { name: "Any shape" }));
    expect(onChange).toHaveBeenLastCalledWith({ input: { shape: "any" } });
    await user.click(screen.getByRole("combobox", { name: "When something is wrong" }));
    await user.click(screen.getByRole("option", { name: "Tell the team and keep going" }));
    expect(onChange).toHaveBeenLastCalledWith({ input: { whenFound: "tell" } });
  });

  test("says on the canvas what it wants and what it does", () => {
    expect(nodeLook({ kind: "footage-check", input: {} }).kind).toBe(
      "Vertical, stops on a problem",
    );
    expect(
      nodeLook({ kind: "footage-check", input: { shape: "any", whenFound: "tell" } }).kind,
    ).toBe("Any shape, tells, then edits");
  });
});

describe("a footage check on the run page", () => {
  test("lists each take with what is wrong, and where the creator's note is", () => {
    const run = {
      _id: "run_1",
      status: "failed",
      testOf: undefined,
      edges: [],
      nodes: [{ id: "check_1", kind: "footage-check", input: {}, position: { x: 0, y: 0 } }],
      steps: [
        {
          _id: "s1",
          nodeId: "check_1",
          status: "failed",
          outputs: [],
          jobs: [],
          footage: {
            stopped: true,
            creator: "Maya",
            note: "ugc/Maya/Footage check.txt",
            files: [
              {
                url: "https://files.example/body.mp4",
                name: "body.mp4",
                role: "body",
                problems: [],
                width: 1080,
                height: 1920,
                duration: 24,
                loudness: -18.4,
              },
              {
                url: "https://files.example/take2.mp4",
                name: "take2.mp4",
                role: "hook",
                problems: [
                  {
                    kind: "shape",
                    says: "It is landscape (16:9) (1920×1080); vertical (9:16) is needed.",
                  },
                  { kind: "frozen", says: "The picture freezes for 3 s at 0:01." },
                ],
                width: 1920,
                height: 1080,
                duration: 3,
              },
            ],
          },
        },
      ],
    } as unknown as RunDetails;
    renderInApp(<PicksPanel run={run} busy={false} onFindMore={vi.fn()} />);
    const section = screen.getByRole("region", { name: "Check Footage" });
    expect(
      within(section).getByText(
        /1 of 2 files need another look before editing\. Editing did not start\./,
      ),
    ).toHaveTextContent("A note for the creator is in ugc/Maya/Footage check.txt.");
    expect(within(section).getByText("body.mp4")).toHaveTextContent(
      "body.mp4 · 1080×1920 · 24 s · -18 LUFS",
    );
    expect(within(section).getByText("Fine to edit.")).toBeInTheDocument();
    expect(within(section).getByText(/take2\.mp4 \(hook\)/)).toBeInTheDocument();
    expect(within(section).getByText("The picture freezes for 3 s at 0:01.")).toBeInTheDocument();
    expect(within(section).getByLabelText("Needs a look")).toBeInTheDocument();
  });
});
