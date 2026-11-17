import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const flow = { zoomIn: vi.fn(), zoomOut: vi.fn(), fitView: vi.fn() };
vi.mock("@xyflow/react", () => ({ useReactFlow: () => flow }));

import { CanvasBar, CanvasZoom, FitOnResize } from "./canvas-bar";

// The strip above every canvas: the view buttons live here, beside the canvas rather than
// floating over its steps.
describe("the canvas bar", () => {
  beforeEach(() => {
    flow.zoomIn.mockClear();
    flow.zoomOut.mockClear();
    flow.fitView.mockClear();
  });

  test("holds its buttons in the normal flow of the page, not on top of the canvas", () => {
    render(
      <CanvasBar>
        <button type="button">Add step</button>
        <CanvasZoom />
      </CanvasBar>,
    );
    const bar = document.querySelector("[data-canvas-bar]") as HTMLElement;
    expect(bar).toContainElement(screen.getByRole("button", { name: "Add step" }));
    expect(bar.className).not.toMatch(/\b(absolute|fixed)\b/);
    expect(bar.className).not.toMatch(/\bborder\b/);
  });

  test("zooms out, zooms in and fits the steps to the screen", () => {
    render(<CanvasZoom fitViewOptions={{ padding: 0.3 }} />);
    const view = screen.getByRole("group", { name: "View" });
    expect(view).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Fit to screen" }));
    expect(flow.zoomOut).toHaveBeenCalledTimes(1);
    expect(flow.zoomIn).toHaveBeenCalledTimes(1);
    expect(flow.fitView).toHaveBeenCalledWith(expect.objectContaining({ padding: 0.3 }));
  });

  test("keeps room for more view buttons after the zoom", () => {
    render(
      <CanvasZoom>
        <button type="button">Tidy up</button>
      </CanvasZoom>,
    );
    expect(screen.getByRole("group", { name: "View" })).toContainElement(
      screen.getByRole("button", { name: "Tidy up" }),
    );
  });
});

describe("fitting the steps again when the canvas changes size", () => {
  test("refits after a side panel opens, but not when the canvas first appears", () => {
    vi.useFakeTimers();
    let changed: () => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          changed = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    flow.fitView.mockClear();
    const canvasRef = createRef<HTMLDivElement>();
    render(
      <div ref={canvasRef}>
        <FitOnResize canvasRef={canvasRef} fitViewOptions={{ padding: 0.3 }} />
      </div>,
    );
    changed();
    vi.advanceTimersByTime(500);
    expect(flow.fitView).not.toHaveBeenCalled();
    changed();
    changed();
    vi.advanceTimersByTime(500);
    expect(flow.fitView).toHaveBeenCalledTimes(1);
    expect(flow.fitView).toHaveBeenCalledWith(expect.objectContaining({ padding: 0.3 }));
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
