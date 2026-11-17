import { describe, expect, it } from "vitest";

import {
  applyOperations,
  type AutomationDraft,
  exportAutomation,
  graphProblem,
  readAutomationFile,
  passedOverNodes,
  readyNodes,
} from "../src";

const empty: AutomationDraft = { name: "Clips", trigger: { kind: "manual" }, nodes: [], edges: [] };

// trim -> thumbnail, and trim -(if it fails)-> caption
const built = applyOperations(empty, [
  { op: "add", type: "step:video-trim", id: "trim_1" },
  { op: "add", type: "step:video-thumbnail", id: "thumbnail_1", after: "trim_1" },
  { op: "add", type: "step:video-caption", id: "caption_1", after: "trim_1", branch: "failed" },
]);

describe("the way for when a step fails", () => {
  it("can be added after a step that does work, a row below it", () => {
    expect(built.edges).toContainEqual(
      expect.objectContaining({ source: "trim_1", target: "caption_1", branch: "failed" }),
    );
    const trim = built.nodes.find((node) => node.id === "trim_1")!;
    const caption = built.nodes.find((node) => node.id === "caption_1")!;
    expect(caption.position.y).toBeGreaterThan(trim.position.y);
    expect(graphProblem(built.nodes, built.edges)).toBeNull();
  });

  it("is not there on an If or a Wait", () => {
    expect(() =>
      applyOperations(built, [
        { op: "add", type: "wait", id: "wait_1" },
        { op: "add", type: "approval", after: "wait_1", branch: "failed" },
      ]),
    ).toThrow(/cannot have a way for when it fails/);
    const ifNodes = [
      { id: "if_1", kind: "if" as const, input: {}, position: { x: 0, y: 0 } },
      ...built.nodes,
    ];
    expect(
      graphProblem(ifNodes, [{ id: "x", source: "if_1", target: "trim_1", branch: "failed" }]),
    ).toMatch(/Only a step that does work/);
  });

  it("carries files only when the step failed", () => {
    const pending = { trim_1: "pending", thumbnail_1: "pending", caption_1: "pending" } as const;
    const failed = { ...pending, trim_1: "failed" } as const;
    expect(readyNodes(built.nodes, built.edges, failed).map((n) => n.id)).toEqual(["caption_1"]);
    expect(passedOverNodes(built.nodes, built.edges, failed).map((n) => n.id)).toEqual([
      "thumbnail_1",
    ]);
    const done = { ...pending, trim_1: "done" } as const;
    expect(readyNodes(built.nodes, built.edges, done).map((n) => n.id)).toEqual(["thumbnail_1"]);
    expect(passedOverNodes(built.nodes, built.edges, done).map((n) => n.id)).toEqual(["caption_1"]);
  });

  it("is not joined into the main flow when its step is removed", () => {
    const removed = applyOperations(built, [{ op: "remove", ids: ["trim_1"] }]);
    expect(removed.edges).toEqual([]);
  });

  it("survives export and import", () => {
    const read = readAutomationFile(JSON.parse(JSON.stringify(exportAutomation(built).file)));
    expect(read.ok && read.draft.edges).toContainEqual(
      expect.objectContaining({ source: "trim_1", target: "caption_1", branch: "failed" }),
    );
  });
});
