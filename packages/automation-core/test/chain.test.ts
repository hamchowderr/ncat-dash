import { describe, expect, it } from "vitest";

import {
  type ChainMember,
  chainLinks,
  chainLoop,
  chainProblem,
  draftProblems,
  followProblem,
  followsEnd,
  loopWords,
  MAX_CHAIN_DEPTH,
  missingSettings,
  readAutomationFile,
  targetOf,
  waitsForRun,
} from "../src";

const runs = (_from: string, target: string) => ({
  kind: "automation" as const,
  input: { automation: target },
});

function member(id: string, extra: Partial<ChainMember> = {}): ChainMember {
  return { id, name: id.toUpperCase(), trigger: { kind: "manual" }, nodes: [], ...extra };
}

describe("automations that start other automations", () => {
  it("reads which automation a step runs and whether it waits", () => {
    expect(targetOf({ kind: "automation", input: { automation: "b" } })).toBe("b");
    expect(targetOf({ kind: "automation", input: {} })).toBeNull();
    expect(targetOf({ kind: "wait", input: { automation: "b" } })).toBeNull();
    expect(waitsForRun({ input: {} })).toBe(true);
    expect(waitsForRun({ input: { wait: false } })).toBe(false);
  });

  it("needs the automation picked before it can run", () => {
    const node = {
      id: "a",
      kind: "automation" as const,
      input: { wait: true },
      position: { x: 0, y: 0 },
    };
    expect(missingSettings(node)).toEqual(["automation"]);
    expect(missingSettings({ ...node, input: { automation: "b" } })).toEqual([]);
  });

  it("starts a follower after the ends it asked for", () => {
    const after = (when: "done" | "failed" | "either") =>
      ({ kind: "finished", automationId: "a", when }) as const;
    expect(followsEnd(after("done"), "done")).toBe(true);
    expect(followsEnd(after("done"), "failed")).toBe(false);
    expect(followsEnd(after("failed"), "failed")).toBe(true);
    expect(followsEnd(after("failed"), "done")).toBe(false);
    expect(followsEnd(after("either"), "done")).toBe(true);
    expect(followsEnd(after("either"), "failed")).toBe(true);
  });

  it("asks for the automation to follow", () => {
    expect(followProblem({ kind: "finished", automationId: "", when: "done" })).toMatch(
      /Pick which/,
    );
    expect(followProblem({ kind: "finished", automationId: "a", when: "done" })).toBeNull();
    expect(followProblem({ kind: "manual" })).toBeNull();
    const problems = draftProblems({
      name: "Follow",
      trigger: { kind: "finished", automationId: "", when: "done" },
      nodes: [
        { id: "w", kind: "wait", input: { amount: 1, unit: "minutes" }, position: { x: 0, y: 0 } },
      ],
      edges: [],
    });
    expect(problems.map((problem) => problem.message)).toContain(
      "Pick which automation it waits for.",
    );
  });

  it("links automations by the steps that run others and the triggers that follow them", () => {
    const links = chainLinks([
      member("a", { nodes: [runs("a", "b")] }),
      member("b"),
      member("c", { trigger: { kind: "finished", automationId: "b", when: "done" } }),
    ]);
    expect([...links.get("a")!]).toEqual(["b"]);
    expect([...links.get("b")!]).toEqual(["c"]);
    expect([...links.get("c")!]).toEqual([]);
  });

  it("finds a loop through the automation being saved, shortest first", () => {
    const members = [
      member("a", { nodes: [runs("a", "b")] }),
      member("b", { trigger: { kind: "manual" }, nodes: [runs("b", "c")] }),
      member("c", { nodes: [runs("c", "a")] }),
      member("d", { trigger: { kind: "finished", automationId: "a", when: "either" } }),
    ];
    expect(chainLoop("a", members)).toEqual(["A", "B", "C", "A"]);
    expect(chainLoop("d", members)).toBeNull();
    expect(loopWords(["A", "B", "C", "A"])).toMatch(/A → B → C → A/);
  });

  it("finds an automation that would start itself", () => {
    const self = [member("a", { nodes: [runs("a", "a")] })];
    expect(chainLoop("a", self)).toEqual(["A", "A"]);
    expect(loopWords(["A", "A"])).toBe("A cannot start itself.");
    const following = [
      member("a", { trigger: { kind: "finished", automationId: "a", when: "done" } }),
    ];
    expect(chainLoop("a", following)).toEqual(["A", "A"]);
  });

  it("finds a loop made by a step and a trigger together", () => {
    const members = [
      member("a", { nodes: [runs("a", "b")] }),
      member("b"),
      member("a2", {
        trigger: { kind: "finished", automationId: "b", when: "done" },
        nodes: [runs("a2", "a")],
      }),
    ];
    expect(chainLoop("a", members)).toEqual(["A", "B", "A2", "A"]);
  });

  it("does not start an automation already in the chain, nor too deep", () => {
    expect(chainProblem(["a", "b"], "a", "A")).toMatch(/already part of this chain/);
    const deep = Array.from({ length: MAX_CHAIN_DEPTH }, (_, index) => `x${index}`);
    expect(chainProblem(deep, "z", "Z")).toMatch(/at most 5 automations deep/);
    expect(chainProblem(["a"], "b", "B")).toBeNull();
  });

  it("leaves the other team's automation out when one is imported", () => {
    const file = {
      format: "ncat-dash-automation",
      version: 1,
      name: "Chain",
      trigger: { kind: "finished", automationId: "elsewhere", when: "done" },
      nodes: [
        {
          id: "run",
          kind: "automation",
          input: { automation: "elsewhere", wait: false },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    };
    const read = readAutomationFile(file);
    if (!read.ok) throw new Error(read.message);
    expect(read.draft.trigger).toEqual({ kind: "manual" });
    expect(read.draft.nodes[0].input).toEqual({ wait: false });
    expect(read.notes.join(" ")).toMatch(/picked again/);
    expect(read.notes.join(" ")).toMatch(/another automation finished/);
  });
});
