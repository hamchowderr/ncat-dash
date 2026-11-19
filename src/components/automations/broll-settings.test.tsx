import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { nodeLook } from "./flow-nodes";
import { NodePanel } from "./node-panel";

function panel(
  node: Parameters<typeof NodePanel>[0]["node"],
  before: Parameters<typeof NodePanel>[0]["before"] = [],
) {
  const onChange = vi.fn();
  renderInApp(
    <NodePanel
      node={node}
      before={before}
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

const BROLL = { id: "broll", kind: "broll" as const, input: {}, position: { x: 0, y: 0 } };
const PLAN = { id: "plan", kind: "broll-plan" as const, input: {}, position: { x: 0, y: 0 } };

describe("the Add B-Roll step's settings", () => {
  test("shows the usual settings in plain words, with nothing to fill in", () => {
    panel(BROLL);
    expect(screen.getAllByText("Add B-Roll").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("How often")).toHaveTextContent("Regularly");
    expect(screen.getByText("About 7 seconds on you between cutaways.")).toBeInTheDocument();
    expect((screen.getByLabelText("Each lasts") as HTMLInputElement).value).toBe("3");
    expect(screen.getByLabelText("Cutaway")).toHaveTextContent("Fills the frame");
    expect(screen.getByLabelText("Footage from")).toHaveTextContent(
      "Your library, then free stock",
    );
    expect(screen.getByRole("link", { name: "Settings, B-Roll" })).toHaveAttribute(
      "href",
      "/settings/broll",
    );
    // The video is wired in by itself.
    expect(screen.getByText(/the nearest video before this step/)).toBeInTheDocument();
  });

  test("saves a length, and does not save one past the longest", () => {
    const onChange = panel(BROLL);
    const seconds = screen.getByLabelText("Each lasts");
    fireEvent.change(seconds, { target: { value: "4.5" } });
    expect(onChange).toHaveBeenLastCalledWith({ input: { seconds: 4.5 } });
    onChange.mockClear();
    fireEvent.change(seconds, { target: { value: "30" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  test("says when a plan before it decides where the cutaways go", () => {
    panel(BROLL, [PLAN]);
    expect(screen.getByText(/Plan B-Roll before this step decides where they go/)).toBeTruthy();
  });

  test("keeps the opening and the match under More options", () => {
    panel(BROLL);
    fireEvent.click(screen.getByText("More options"));
    expect((screen.getByLabelText("Keep the opening on you for") as HTMLInputElement).value).toBe(
      "3",
    );
    expect(screen.getByLabelText("How close a match")).toHaveTextContent("Normal");
  });

  test("each has its own icon and a short line on the canvas", () => {
    const broll = nodeLook({ ...BROLL, input: { often: "busy", sources: "library" } });
    const plan = nodeLook(PLAN);
    expect(broll.kind).toBe("Often, from your library");
    expect(plan.kind).toBe("AI picks the moments");
    expect(broll.icon).not.toBe(plan.icon);
  });
});

describe("the Plan B-Roll step's settings", () => {
  test("asks only what to show, and says how often comes from Add B-Roll", () => {
    const onChange = panel(PLAN);
    expect(screen.getAllByText("Plan B-Roll").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("What to show"), {
      target: { value: "The products named" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ input: { lookFor: "The products named" } });
    expect(screen.getByText(/How often and how long come from the Add B-Roll step/)).toBeTruthy();
  });
});
