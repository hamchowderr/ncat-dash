import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { NodePanel } from "./node-panel";

// The settings panel never grows wider than its column. The browser test
// (e2e/panel-no-sideways.spec.ts) measures every step; this keeps the rule that makes it so.

test("a long step name is cut short instead of widening the panel", () => {
  renderInApp(
    <NodePanel
      node={{
        id: "loud",
        kind: "step",
        stepId: "video-caption",
        label: "Even out loudness for every platform we post to, every single week",
        input: {},
      }}
      before={[]}
      startGivesFile
      filled={{}}
      brand={{}}
      music={[]}
      onChange={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
  const title = screen.getByRole("heading", { level: 2 });
  expect(title.className).toMatch(/\btruncate\b/);
  expect(title.className).toMatch(/\bmin-w-0\b/);
  // The header's grid has one column that may shrink to the panel, not one sized to the
  // full name, which pushed the buttons and the description past the edge.
  const grid = title.parentElement!.parentElement!;
  expect(grid.className).toContain("grid-cols-[minmax(0,1fr)]");
});
