import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { copiedSteps, holdSteps } from "@/lib/step-clipboard";
import { renderInApp } from "@/test/render";

import { NodePanel } from "./node-panel";

const CAPTION = {
  id: "caption",
  kind: "step" as const,
  stepId: "video-caption",
  input: { font_size: 48 },
  position: { x: 0, y: 0 },
};

describe("copying steps", () => {
  test("the step panel has a button that duplicates the step", () => {
    const onDuplicate = vi.fn();
    renderInApp(
      <NodePanel
        node={CAPTION}
        before={[]}
        startGivesFile
        filled={{}}
        brand={{}}
        music={[]}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        onDuplicate={onDuplicate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Duplicate step" }));
    expect(onDuplicate).toHaveBeenCalledOnce();
  });

  test("copied steps can be pasted on another canvas, and survive blocked storage", () => {
    holdSteps({ nodes: [CAPTION], edges: [] });
    expect(copiedSteps()?.nodes[0].stepId).toBe("video-caption");

    const blocked = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(copiedSteps()?.nodes).toHaveLength(1);
    blocked.mockRestore();
  });
});
