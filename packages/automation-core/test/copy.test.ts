import { describe, expect, it } from "vitest";

import {
  applyOperations,
  type AutomationDraft,
  copySteps,
  draftProblems,
  pasteSteps,
} from "../src";

const empty: AutomationDraft = { name: "Clips", trigger: { kind: "manual" }, nodes: [], edges: [] };

// trim -> if -(yes)-> caption -> thumbnail
const built = applyOperations(empty, [
  { op: "add", type: "step:video-trim", id: "trim_1" },
  { op: "add", type: "if", id: "if_1", after: "trim_1" },
  { op: "add", type: "step:video-caption", id: "caption_1", after: "if_1", branch: "yes" },
  { op: "add", type: "step:video-thumbnail", id: "thumbnail_1", after: "caption_1" },
  { op: "use", id: "thumbnail_1", field: "video_url", from: "caption_1" },
  { op: "use", id: "caption_1", field: "video_url", from: "trim_1" },
  { op: "switch", id: "caption_1", on: false },
]);
const node = (draft: AutomationDraft, id: string) => draft.nodes.find((n) => n.id === id)!;
const into = (draft: AutomationDraft, id: string) =>
  draft.edges.filter((edge) => edge.target === id).map((edge) => [edge.source, edge.branch]);

describe("duplicating steps", () => {
  it("makes a copy fed the same way, below the original, with its settings", () => {
    const { draft, ids } = pasteSteps(built, { op: "duplicate", ids: ["caption_1"] });
    expect(ids).toEqual(["caption_2"]);
    const copy = node(draft, "caption_2");
    expect(copy.input).toEqual(node(built, "caption_1").input);
    expect(copy.off).toBe(true);
    expect(into(draft, "caption_2")).toEqual([["if_1", "yes"]]);
    expect(draft.edges.some((edge) => edge.source === "caption_2")).toBe(false);
    expect(copy.position.x).toBe(node(built, "caption_1").position.x);
    expect(copy.position.y).toBeGreaterThan(node(built, "caption_1").position.y);
    expect(draftProblems(draft).filter((p) => p.nodeId === "caption_2")).toEqual([]);
  });

  it("copies the lines between several steps, and points settings at the copies", () => {
    const { draft, ids } = pasteSteps(built, {
      op: "duplicate",
      ids: ["caption_1", "thumbnail_1"],
    });
    expect(ids).toEqual(["caption_2", "thumbnail_2"]);
    expect(into(draft, "thumbnail_2")).toEqual([["caption_2", undefined]]);
    expect(JSON.stringify(node(draft, "thumbnail_2").input)).toContain("steps.caption_2.");
    // A setting pointing outside the copy, at a step that still runs first, is kept.
    expect(JSON.stringify(node(draft, "caption_2").input)).toContain("steps.trim_1.");
  });

  it("is an operation the agent can use too", () => {
    const draft = applyOperations(built, [{ op: "duplicate", ids: ["trim_1"] }]);
    expect(draft.nodes.map((n) => n.id)).toContain("trim_2");
    // trim_1 starts from the start, and so does its copy.
    expect(into(draft, "trim_2")).toEqual([]);
  });
});

describe("pasting steps", () => {
  const clip = copySteps(built, ["caption_1", "thumbnail_1"]);

  it("carries on from the chosen step, by the way asked for", () => {
    const { draft, ids } = pasteSteps(built, {
      op: "paste",
      steps: clip,
      after: "if_1",
      branch: "no",
    });
    expect(into(draft, ids[0])).toEqual([["if_1", "no"]]);
    expect(into(draft, ids[1])).toEqual([[ids[0], undefined]]);
    expect(node(draft, ids[0]).position.y).toBeGreaterThan(node(built, "if_1").position.y);
  });

  it("drops a setting that points at a step which would not run first", () => {
    // Pasted after Trim's If, Caption's link to Trim is fine; pasted at the start it is not.
    const { draft, ids } = pasteSteps(built, { op: "paste", steps: clip });
    expect(into(draft, ids[0])).toEqual([]);
    expect(JSON.stringify(node(draft, ids[0]).input)).not.toContain("steps.trim_1.");
    expect(JSON.stringify(node(draft, ids[1]).input)).toContain(`steps.${ids[0]}.`);
    expect(draftProblems(draft).filter((p) => ids.includes(p.nodeId ?? ""))).toEqual([]);
  });

  it("works across automations, since the copy carries everything it needs", () => {
    const { draft } = pasteSteps(empty, { op: "paste", steps: clip });
    expect(draft.nodes).toHaveLength(2);
    expect(draft.nodes[0].position).toEqual({ x: 0, y: 0 });
  });

  it("says when there is nothing to paste or too much", () => {
    expect(() => pasteSteps(built, { op: "paste", steps: { nodes: [], edges: [] } })).toThrow(
      /nothing to paste/,
    );
    const many = copySteps(
      built,
      built.nodes.map((n) => n.id),
    );
    let big = empty;
    for (let i = 0; i < 12; i++) big = pasteSteps(big, { op: "paste", steps: many }).draft;
    expect(() => pasteSteps(big, { op: "paste", steps: many })).toThrow(/at most 50/);
  });
});
