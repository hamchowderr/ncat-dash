import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { NodePanel } from "./node-panel";

function logoPanel(input: Record<string, unknown> = {}) {
  renderInApp(
    <NodePanel
      node={{ id: "step_1", kind: "step", stepId: "recipe-logo", input }}
      before={[]}
      startGivesFile
      filled={{}}
      brand={{ logo: "https://files.example/brand/logo.png" }}
      music={[]}
      onChange={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("More options"));
}

describe("the Add a logo step", () => {
  test("puts the logo top right unless the team picks another corner", () => {
    logoPanel();
    expect(screen.getByText("Corner")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Corner/ }).textContent).toContain(
      "Default (top right)",
    );
    expect(screen.getByText(/Top right unless you pick another corner/)).toBeTruthy();
  });

  test("shows the corner a team picked", () => {
    logoPanel({ corner: "bottom left" });
    expect(screen.getByRole("combobox", { name: /Corner/ }).textContent).toContain("bottom left");
  });
});
