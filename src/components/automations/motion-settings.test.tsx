import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { nodeLook } from "./flow-nodes";
import { NodePanel } from "./node-panel";

type PanelNode = Parameters<typeof NodePanel>[0]["node"];

function panel(node: PanelNode, before: PanelNode[] = []) {
  const onChange = vi.fn();
  renderInApp(
    <NodePanel
      node={node}
      before={before as Parameters<typeof NodePanel>[0]["before"]}
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

describe("the Add Motion Graphics step", () => {
  test("uses the team's style by default and links to Settings > Motion", () => {
    panel({ id: "motion", kind: "motion", input: {} });
    expect(screen.getByRole("combobox", { name: "Style" })).toHaveTextContent("Your team's style");
    expect(screen.getByRole("combobox", { name: "Sounds" })).toHaveTextContent("As the style says");
    expect(screen.getByRole("link", { name: "Settings > Motion" })).toHaveAttribute(
      "href",
      "/settings/motion",
    );
    expect(screen.getByText(/the name of the file that started the run/)).toBeInTheDocument();
  });

  test("saves a typed opening title", async () => {
    const user = userEvent.setup();
    const onChange = panel({ id: "motion", kind: "motion", input: {} });
    await user.type(screen.getByRole("textbox", { name: "Opening title" }), "Big Year");
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith({ input: { title: "Big Year" } });
  });

  test("shows the picked preset on the canvas", () => {
    expect(nodeLook({ kind: "motion", input: { style: "neon" } }).kind).toBe("Neon");
    expect(nodeLook({ kind: "motion", input: {} }).kind).toBe("Your team's style");
  });
});

describe("the Plan Motion Graphics step", () => {
  const PLAN = { id: "plan", kind: "motion-plan", input: {} } as const;

  test("asks only what to bring out, and says the rest comes from Add Motion Graphics", async () => {
    const onChange = panel(PLAN);
    expect(screen.getAllByText("Plan Motion Graphics").length).toBeGreaterThan(0);
    await userEvent.setup().type(screen.getByLabelText("What to bring out"), "N");
    expect(onChange).toHaveBeenLastCalledWith({ input: { lookFor: "N" } });
    expect(screen.getByText(/come from the Add Motion Graphics step after it/)).toBeInTheDocument();
    expect(screen.getByText(/the nearest video before this step, transcribed/)).toBeInTheDocument();
  });

  test("the motion step after it says the plan picks the pieces", () => {
    panel({ id: "motion", kind: "motion", input: {} }, [PLAN]);
    expect(
      screen.getByText(/Plan Motion Graphics before this step picks the pieces/),
    ).toBeInTheDocument();
  });

  test("has its own icon and line on the canvas", () => {
    const plan = nodeLook(PLAN);
    expect(plan.kind).toBe("AI plans the pieces");
    expect(plan.icon).not.toBe(nodeLook({ kind: "motion", input: {} }).icon);
  });
});

describe("the Add Sound Effects step", () => {
  test("follows the team's level unless it picks one", () => {
    panel({ id: "sounds", kind: "sound-effects", input: {} });
    expect(screen.getByRole("combobox", { name: "How many" })).toHaveTextContent(
      "As your team's setting",
    );
    expect(nodeLook({ kind: "sound-effects", input: { level: "heavy" } }).kind).toBe(
      "On every number",
    );
  });
});
