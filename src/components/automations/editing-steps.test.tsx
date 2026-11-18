import { editingRecipes } from "@ncat-dash/step-catalog";
import { STARTERS } from "@ncat-dash/automation-core";
import { screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { NodePanel } from "./node-panel";
import { STEP_ICONS } from "./step-icons";

function panel(stepId: string, input: Record<string, unknown> = {}, brand = {}) {
  renderInApp(
    <NodePanel
      node={{ id: "step_1", kind: "step", stepId, input }}
      before={[]}
      startGivesFile
      filled={{}}
      brand={brand}
      music={[]}
      onChange={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
}

describe("the layout and editing steps", () => {
  test("each has its own icon", () => {
    const icons = editingRecipes.map((step) => STEP_ICONS[step.id]);
    expect(icons.every(Boolean)).toBe(true);
    const all = Object.values(STEP_ICONS);
    for (const icon of icons) expect(all.filter((other) => other === icon)).toHaveLength(1);
  });

  test("each is a ready-made automation too", () => {
    for (const step of editingRecipes) {
      expect(STARTERS.some((starter) => starter.id === step.id)).toBe(true);
    }
    expect(STARTERS.find((starter) => starter.id === "podcast-package")?.nodes).toHaveLength(4);
  });

  test("a title on a picture takes the file's name without asking for it", () => {
    panel("recipe-title-on-picture", {}, { color: "#1E2A78" });
    expect(screen.getByText("Handled for you")).toBeTruthy();
    expect(screen.getAllByText(/the name of the file that started the run/).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText("File name")).toBeNull();
  });

  test("a quote card takes the card template from Settings", () => {
    panel("recipe-quote-card", {}, { card: "https://files.example/brand/card.png" });
    expect(screen.getByText("Handled for you")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /The card picture/ })).toBeNull();
  });
});
