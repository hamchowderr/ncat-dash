import { fireEvent, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { DrawingLayer } from "./frame-drawing";

/** A 200 by 100 picture at the page's top left corner. */
function sized(svg: SVGSVGElement) {
  svg.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 }) as DOMRect;
}

function drag(svg: Element, points: [number, number][]) {
  const fire = (type: string, [clientX, clientY]: [number, number]) =>
    fireEvent(svg, new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY }));
  fire("pointerdown", points[0]);
  for (const point of points.slice(1)) fire("pointermove", point);
  fire("pointerup", points[points.length - 1]);
}

describe("drawing on the frame", () => {
  test("a pen line keeps its points as shares of the picture", () => {
    const onAdd = vi.fn();
    const { container } = render(
      <DrawingLayer shapes={[]} tool="pen" color="yellow" onAdd={onAdd} />,
    );
    const svg = container.querySelector("svg")!;
    sized(svg);
    drag(svg, [
      [20, 10],
      [100, 50],
      [180, 90],
    ]);
    expect(onAdd).toHaveBeenCalledWith({
      tool: "pen",
      color: "yellow",
      points: [0.1, 0.1, 0.5, 0.5, 0.9, 0.9],
    });
  });

  test("an arrow or a box keeps where it started and where it ended", () => {
    const onAdd = vi.fn();
    const { container } = render(
      <DrawingLayer shapes={[]} tool="box" color="blue" onAdd={onAdd} />,
    );
    const svg = container.querySelector("svg")!;
    sized(svg);
    drag(svg, [
      [20, 10],
      [60, 30],
      [100, 50],
    ]);
    expect(onAdd).toHaveBeenCalledWith({
      tool: "box",
      color: "blue",
      points: [0.1, 0.1, 0.5, 0.5],
    });
  });

  test("a pointer off the picture lands on its edge", () => {
    const onAdd = vi.fn();
    const { container } = render(<DrawingLayer shapes={[]} tool="arrow" onAdd={onAdd} />);
    const svg = container.querySelector("svg")!;
    sized(svg);
    drag(svg, [
      [100, 50],
      [400, -40],
    ]);
    expect(onAdd).toHaveBeenCalledWith({ tool: "arrow", color: "red", points: [0.5, 0.5, 1, 0] });
  });

  test("a saved drawing is only shown, and clicks go through to the clip", () => {
    const { container } = render(
      <DrawingLayer
        shapes={[
          { tool: "pen", color: "red", points: [0.1, 0.1, 0.2, 0.2] },
          { tool: "arrow", color: "green", points: [0.1, 0.1, 0.5, 0.5] },
          { tool: "box", color: "white", points: [0.6, 0.6, 0.2, 0.2] },
        ]}
      />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("data-drawing", "showing");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveClass("pointer-events-none");
    expect(
      [...svg.querySelectorAll("[data-shape]")].map((mark) => mark.getAttribute("data-shape")),
    ).toEqual(["pen", "arrow", "box"]);
    // A box drawn from bottom right to top left still has a positive size.
    const box = svg.querySelector("rect")!;
    expect(Number(box.getAttribute("width"))).toBeGreaterThan(0);
    expect(box).toHaveAttribute("stroke", "#ffffff");
  });
});
