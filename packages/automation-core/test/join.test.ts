import { describe, expect, test } from "vitest";

import {
  type AutomationEdge,
  type AutomationNode,
  JOIN_MODES,
  joinOf,
  linesInto,
  missingSettings,
  partnersOf,
  readyNodes,
} from "../src";

const node = (id: string, extra: Partial<AutomationNode> = {}): AutomationNode => ({
  id,
  kind: "step",
  stepId: "video-trim",
  input: { start: "0", end: "1" },
  position: { x: 0, y: 0 },
  ...extra,
});
const edges: AutomationEdge[] = [
  { id: "e1", source: "a", target: "c" },
  { id: "e2", source: "b", target: "c" },
];

describe("how a step treats lines that meet at it", () => {
  test("waits for every line unless it takes whichever finishes first", () => {
    const status = { a: "done", b: "running", c: "pending" } as const;
    expect(readyNodes([node("a"), node("b"), node("c")], edges, { ...status })).toEqual([]);
    const first = node("c", { join: "first" });
    expect(readyNodes([node("a"), node("b"), first], edges, { ...status })).toEqual([first]);
    // Nothing finished yet: still waits.
    expect(
      readyNodes([node("a"), node("b"), first], edges, {
        a: "running",
        b: "running",
        c: "pending",
      }),
    ).toEqual([]);
  });

  test("pairs by upload or by place, null where there is no partner", () => {
    const main = [
      { url: "m1", source: "A" },
      { url: "m2", source: "B" },
      { url: "m3", source: null },
    ];
    const others = [
      { url: "o2", source: "B" },
      { url: "o1", source: "A" },
    ];
    expect(partnersOf("source", main, others)).toEqual(["o1", "o2", null]);
    expect(partnersOf("position", main, others)).toEqual(["o2", "o1", null]);
  });

  test("a pairing step does not ask for the files it gets from the other line", () => {
    const pip = node("c", { stepId: "recipe-picture-in-picture", input: {} });
    expect(missingSettings(pip)).toContain("other_video_url");
    expect(missingSettings({ ...pip, join: "source" })).not.toContain("other_video_url");
  });

  test("defaults to using every file, and counts the lines in", () => {
    expect(joinOf(node("c"))).toBe("all");
    expect(JOIN_MODES.map((mode) => mode.value)).toEqual(["all", "source", "position", "first"]);
    expect(linesInto("c", edges)).toBe(2);
    expect(linesInto("a", edges)).toBe(0);
  });
});
