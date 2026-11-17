import { describe, expect, it } from "vitest";

import { applyOperations, type AutomationDraft, readyNodes } from "../src";

const empty: AutomationDraft = { name: "Clips", trigger: { kind: "manual" }, nodes: [], edges: [] };

// Two sides from the start: trim and thumbnail.
const sides = applyOperations(empty, [
  { op: "add", type: "step:video-trim", id: "trim_1" },
  { op: "add", type: "step:video-caption", id: "caption_1", after: "trim_1" },
  { op: "add", type: "step:video-trim", id: "trim_2" },
]);

describe("joining two sides back together", () => {
  const joined = applyOperations(sides, [
    {
      op: "add",
      type: "step:video-concatenate",
      id: "join_1",
      after: "caption_1",
      join: ["trim_2"],
    },
  ]);

  it("connects the new step from each, and puts it right of both, between them", () => {
    const into = joined.edges.filter((edge) => edge.target === "join_1").map((e) => e.source);
    expect(into.sort()).toEqual(["caption_1", "trim_2"]);
    const at = (id: string) => joined.nodes.find((node) => node.id === id)!.position;
    expect(at("join_1").x).toBeGreaterThan(Math.max(at("caption_1").x, at("trim_2").x));
    expect(at("join_1").y).toBe(Math.round((at("caption_1").y + at("trim_2").y) / 2));
  });

  it("waits until both sides have finished", () => {
    const base = {
      trim_1: "done",
      trim_2: "done",
      caption_1: "running",
      join_1: "pending",
    } as const;
    expect(readyNodes(joined.nodes, joined.edges, base).map((n) => n.id)).toEqual([]);
    const both = { ...base, caption_1: "done" } as const;
    expect(readyNodes(joined.nodes, joined.edges, both).map((n) => n.id)).toEqual(["join_1"]);
  });

  it("needs a step to come after", () => {
    expect(() =>
      applyOperations(sides, [{ op: "add", type: "step:video-concatenate", join: ["trim_2"] }]),
    ).toThrow(/say which step it comes after/);
  });
});
