import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { nodeLook } from "./flow-nodes";
import { NodePanel } from "./node-panel";

function panel(node: Parameters<typeof NodePanel>[0]["node"]) {
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

const at = { x: 0, y: 0 };

describe("the Add Motion Graphics step", () => {
  test("uses the team's style by default and links to Settings > Motion", () => {
    panel({ id: "motion", kind: "motion", input: {}, position: at });
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
    const onChange = panel({ id: "motion", kind: "motion", input: {}, position: at });
    await user.type(screen.getByRole("textbox", { name: "Opening title" }), "Big Year");
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith({ input: { title: "Big Year" } });
  });

  test("shows the picked preset on the canvas", () => {
    expect(nodeLook({ kind: "motion", input: { style: "neon" } }).kind).toBe("Neon");
    expect(nodeLook({ kind: "motion", input: {} }).kind).toBe("Your team's style");
  });
});

describe("the Add Sound Effects step", () => {
  test("follows the team's level unless it picks one", () => {
    panel({ id: "sounds", kind: "sound-effects", input: {}, position: at });
    expect(screen.getByRole("combobox", { name: "How many" })).toHaveTextContent(
      "As your team's setting",
    );
    expect(nodeLook({ kind: "sound-effects", input: { level: "heavy" } }).kind).toBe(
      "On every number",
    );
  });
});
