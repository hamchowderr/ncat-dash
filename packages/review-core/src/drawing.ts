/**
 * A drawing on a paused frame, kept with the comment it explains. Every point is a share
 * of the picture's width and height, from 0 to 1, so the drawing lands in the same place
 * whatever size the clip is shown at.
 */

export const DRAW_TOOLS = ["pen", "arrow", "box"] as const;
export type DrawTool = (typeof DRAW_TOOLS)[number];

/** The colours on offer: easy to see on most footage, and few enough to pick at a glance. */
export const DRAW_COLORS = {
  red: "#ef4444",
  yellow: "#facc15",
  green: "#22c55e",
  blue: "#3b82f6",
  white: "#ffffff",
} as const;
export type DrawColor = keyof typeof DRAW_COLORS;

/** One mark: a pen line through its points, or an arrow or box from its first point to its last. */
export type Shape = { tool: DrawTool; color: DrawColor; points: number[] };

/** The most marks one drawing holds, and the most points one pen line keeps. */
export const SHAPE_LIMIT = 60;
export const POINT_LIMIT = 600;

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number) => Math.round(clamp(value) * 10_000) / 10_000;

/**
 * Tidies a drawing sent by a browser: unknown tools or colours, points off the picture,
 * stray numbers and empty marks are fixed or dropped. Returns null when nothing is left.
 */
export function cleanDrawing(shapes: readonly Shape[] | null | undefined): Shape[] | null {
  if (!shapes) return null;
  const kept: Shape[] = [];
  for (const shape of shapes.slice(0, SHAPE_LIMIT)) {
    if (!DRAW_TOOLS.includes(shape.tool) || !(shape.color in DRAW_COLORS)) continue;
    const numbers = shape.points.filter((value) => Number.isFinite(value)).map(round);
    const even = numbers.slice(0, numbers.length - (numbers.length % 2));
    let points: number[];
    if (shape.tool === "pen") {
      points = even.slice(0, POINT_LIMIT * 2);
      if (points.length < 2) continue;
      // A single dot is drawn as a tiny line so it still shows.
      if (points.length === 2) points = [...points, ...points];
    } else {
      if (even.length < 4) continue;
      points = [even[0], even[1], even[even.length - 2], even[even.length - 1]];
      if (points[0] === points[2] && points[1] === points[3]) continue;
    }
    kept.push({ tool: shape.tool, color: shape.color, points });
  }
  return kept.length > 0 ? kept : null;
}

/** The two small strokes of an arrow's head, in the same units as its points. */
export function arrowHead(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  size: number,
): [number, number, number, number] {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 7;
  return [
    x2 - size * Math.cos(angle - spread),
    y2 - size * Math.sin(angle - spread),
    x2 - size * Math.cos(angle + spread),
    y2 - size * Math.sin(angle + spread),
  ];
}
