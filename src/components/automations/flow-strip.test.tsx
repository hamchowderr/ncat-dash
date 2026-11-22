import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { FlowStrip } from "./flow-strip";

const chain = (length: number) => ({
  nodes: Array.from({ length }, (_, n) => ({
    id: `s${n}`,
    kind: "step" as const,
    stepId: "video-thumbnail",
    input: {},
    position: { x: n * 320, y: 0 },
  })),
  edges: Array.from({ length: length - 1 }, (_, n) => ({
    id: `s${n}>s${n + 1}`,
    source: `s${n}`,
    target: `s${n + 1}`,
  })),
});

describe("the flow strip", () => {
  test("draws every step when there is no limit", () => {
    render(<FlowStrip trigger={{ kind: "webhook" }} {...chain(8)} size="sm" />);
    expect(screen.queryByTestId("flow-strip-more")).toBeNull();
  });

  test("counts the steps past the limit in one last tile", () => {
    render(<FlowStrip trigger={{ kind: "webhook" }} {...chain(8)} size="sm" maxColumns={5} />);
    const more = screen.getByTestId("flow-strip-more");
    expect(more.textContent).toBe("+3");
    expect(more.getAttribute("title")).toBe("3 more steps");
    // The picture still names every step for screen readers.
    expect(screen.getByRole("img").getAttribute("aria-label")?.split(", then ")).toHaveLength(9);
  });

  test("leaves short chains as they are", () => {
    render(<FlowStrip trigger={{ kind: "webhook" }} {...chain(3)} size="sm" maxColumns={5} />);
    expect(screen.queryByTestId("flow-strip-more")).toBeNull();
  });
});
