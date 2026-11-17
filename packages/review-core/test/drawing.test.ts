import { describe, expect, it } from "vitest";
import { arrowHead, cleanDrawing, POINT_LIMIT, SHAPE_LIMIT, type Shape } from "../src";

describe("cleanDrawing", () => {
  it("keeps a good drawing, rounding points to four places", () => {
    expect(
      cleanDrawing([
        { tool: "pen", color: "red", points: [0.123456, 0.5, 0.2, 0.6] },
        { tool: "box", color: "blue", points: [0.1, 0.1, 0.4, 0.3] },
      ]),
    ).toEqual([
      { tool: "pen", color: "red", points: [0.1235, 0.5, 0.2, 0.6] },
      { tool: "box", color: "blue", points: [0.1, 0.1, 0.4, 0.3] },
    ]);
  });

  it("pulls points back onto the picture and drops stray numbers", () => {
    expect(
      cleanDrawing([{ tool: "pen", color: "green", points: [-1, 2, Number.NaN, 0.5, 0.5, 0.7] }]),
    ).toEqual([{ tool: "pen", color: "green", points: [0, 1, 0.5, 0.5] }]);
  });

  it("keeps only the ends of an arrow or a box", () => {
    expect(
      cleanDrawing([{ tool: "arrow", color: "white", points: [0.1, 0.1, 0.2, 0.2, 0.9, 0.8] }]),
    ).toEqual([{ tool: "arrow", color: "white", points: [0.1, 0.1, 0.9, 0.8] }]);
  });

  it("turns a dot into a tiny line so it still shows", () => {
    expect(cleanDrawing([{ tool: "pen", color: "red", points: [0.3, 0.3] }])).toEqual([
      { tool: "pen", color: "red", points: [0.3, 0.3, 0.3, 0.3] },
    ]);
  });

  it("drops unknown tools and colours, empty marks and zero-size boxes", () => {
    const bad = [
      { tool: "laser", color: "red", points: [0, 0, 1, 1] },
      { tool: "pen", color: "pink", points: [0, 0, 1, 1] },
      { tool: "pen", color: "red", points: [] },
      { tool: "box", color: "red", points: [0.2, 0.2, 0.2, 0.2] },
      { tool: "arrow", color: "red", points: [0.2, 0.2] },
    ] as unknown as Shape[];
    expect(cleanDrawing(bad)).toBeNull();
    expect(cleanDrawing(null)).toBeNull();
  });

  it("caps how many marks and points a drawing holds", () => {
    const long = Array.from({ length: POINT_LIMIT * 3 }, (_, at) => (at % 100) / 100);
    const many = Array.from({ length: SHAPE_LIMIT + 10 }, () => ({
      tool: "pen" as const,
      color: "red" as const,
      points: long,
    }));
    const kept = cleanDrawing(many)!;
    expect(kept).toHaveLength(SHAPE_LIMIT);
    expect(kept[0].points).toHaveLength(POINT_LIMIT * 2);
  });
});

describe("arrowHead", () => {
  it("draws the head back from the tip, on both sides of the line", () => {
    const [ax, ay, bx, by] = arrowHead(0, 0, 10, 0, 2);
    expect(ax).toBeLessThan(10);
    expect(bx).toBeLessThan(10);
    expect(ay).toBeCloseTo(-by);
  });
});
