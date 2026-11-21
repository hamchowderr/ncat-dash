import { screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { NodePanel } from "./node-panel";

function panel(stepId: string, input: Record<string, unknown> = {}) {
  renderInApp(
    <NodePanel
      node={{ id: "step_1", kind: "step", stepId, input }}
      before={[]}
      startGivesFile
      filled={{}}
      brand={{}}
      music={[]}
      onChange={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
}

describe("the Hook And Ending Variants step", () => {
  test("asks for the other takes and the creator up front, though each is optional", () => {
    panel("recipe-hook-variants");
    for (const name of ["Hook take 2", "Hook take 3", "Ending take 2", "Creator"]) {
      expect(screen.getAllByText(name, { exact: true }).length).toBeGreaterThan(0);
    }
    // It is not a step that works with nothing set.
    expect(screen.queryByText("Nothing to set. This step works as it is.")).toBeNull();
    // The rarer takes stay under More options.
    expect(screen.queryByText("Hook take 5", { exact: true })).toBeNull();
    expect(screen.getByRole("button", { name: "More options" })).toBeTruthy();
  });

  test("Length Cuts shows its lengths up front and folds the rest away", () => {
    panel("recipe-length-cuts");
    expect(screen.getByPlaceholderText(/15, 30, 60/)).toBeTruthy();
    expect(screen.queryByText("Creator", { exact: true })).toBeNull();
  });
});

describe("keeping the paid-ad disclosure", () => {
  const handled = () => screen.queryByText(/found in what the creator says, and kept in every cut/);

  test("Hook And Ending Variants keeps it unless it is turned off", () => {
    panel("recipe-hook-variants");
    expect(handled()).toBeTruthy();
  });

  test("Hook And Ending Variants with it off says nothing about it", () => {
    panel("recipe-hook-variants", { disclosure: "Off" });
    expect(handled()).toBeNull();
  });

  test("Length Cuts keeps it once it is switched on, as the ad ready-mades do", () => {
    panel("recipe-length-cuts");
    expect(handled()).toBeNull();
  });

  test("Length Cuts switched on says the disclosure is handled", () => {
    panel("recipe-length-cuts", { disclosure: "Keep it in every cut" });
    expect(handled()).toBeTruthy();
  });
});
