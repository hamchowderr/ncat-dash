import { describe, expect, it } from "vitest";

import {
  applyOperations,
  type AutomationDraft,
  canRedo,
  canUndo,
  canonical,
  missingSettings,
  draftChanges,
  HISTORY_LIMIT,
  HISTORY_MERGE_MS,
  record,
  redo,
  startHistory,
  undo,
} from "../src";

const empty: AutomationDraft = { name: "Clips", trigger: { kind: "manual" }, nodes: [], edges: [] };
const named = (name: string): AutomationDraft => ({ ...empty, name });

describe("history", () => {
  it("undoes and redoes one change at a time", () => {
    let history = startHistory(named("a"));
    history = record(history, named("b"), 1_000);
    history = record(history, named("c"), 5_000);
    expect(canUndo(history)).toBe(true);
    history = undo(history);
    expect(history.present.name).toBe("b");
    history = undo(history);
    expect(history.present.name).toBe("a");
    expect(canUndo(history)).toBe(false);
    expect(undo(history)).toBe(history);
    history = redo(redo(history));
    expect(history.present.name).toBe("c");
    expect(canRedo(history)).toBe(false);
    expect(redo(history)).toBe(history);
  });

  it("counts quick changes as one, so typing a word is one undo", () => {
    let history = startHistory(named(""));
    let now = 1_000;
    for (const name of ["C", "Cl", "Cli", "Clip"]) {
      history = record(history, named(name), now);
      now += HISTORY_MERGE_MS - 100;
    }
    history = record(history, named("Clip 2"), now + HISTORY_MERGE_MS);
    expect(history.past.map((entry) => entry.name)).toEqual(["", "Clip"]);
    expect(undo(undo(history)).present.name).toBe("");
  });

  it("does not merge a change marked as its own step", () => {
    let history = startHistory(named("a"));
    history = record(history, named("b"), 1_000, { merge: false });
    history = record(history, named("c"), 1_001);
    expect(history.past.map((entry) => entry.name)).toEqual(["a", "b"]);
  });

  it("does not merge into a state reached by undo", () => {
    let history = startHistory(named("a"));
    history = record(history, named("b"), 1_000);
    history = undo(history);
    history = record(history, named("c"), 1_001);
    expect(history.past.map((entry) => entry.name)).toEqual(["a"]);
    expect(history.future).toEqual([]);
  });

  it("ignores a state that is the same, whatever the key order", () => {
    const history = startHistory(empty);
    const same = {
      edges: [],
      nodes: [],
      trigger: { kind: "manual" },
      name: "Clips",
    } as AutomationDraft;
    expect(record(history, same, 1_000)).toBe(history);
    expect(canonical(same)).toBe(canonical(empty));
  });

  it("drops the step when quick changes end where they began", () => {
    let history = startHistory(named("a"));
    history = record(history, named("ab"), 1_000);
    history = record(history, named("a"), 1_100);
    expect(canUndo(history)).toBe(false);
  });

  it("forgets what was undone once something new is done", () => {
    let history = startHistory(named("a"));
    history = record(history, named("b"), 1_000);
    history = undo(history);
    history = record(history, named("c"), 9_000);
    expect(canRedo(history)).toBe(false);
    expect(undo(history).present.name).toBe("a");
  });

  it("keeps at most the limit of earlier states", () => {
    let history = startHistory(named("0"));
    for (let n = 1; n <= HISTORY_LIMIT + 20; n++) {
      history = record(history, named(String(n)), n * 10_000);
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0].name).toBe("20");
  });
});

describe("draftChanges", () => {
  const live = applyOperations(empty, [
    { op: "add", type: "step:media-transcribe", id: "transcribe_1" },
    { op: "add", type: "approval", id: "approval_1", after: "transcribe_1" },
  ]);

  it("is empty when nothing that runs has changed", () => {
    expect(draftChanges(live, live)).toEqual([]);
    const moved = {
      ...live,
      nodes: live.nodes.map((node) => ({ ...node, position: { x: 999, y: 999 } })),
    };
    expect(draftChanges(live, moved)).toEqual([]);
  });

  it("says what was added, changed and removed", () => {
    const draft = applyOperations(live, [
      { op: "name", name: "Clips v2" },
      { op: "trigger", trigger: { kind: "webhook" } },
      { op: "remove", ids: ["approval_1"] },
      { op: "set", id: "transcribe_1", settings: { language: "en" } },
      {
        op: "add",
        type: "approval",
        id: "approval_2",
        after: "transcribe_1",
        label: "Final check",
      },
    ]);
    const changes = draftChanges(live, draft);
    expect(changes).toContain('Renamed to "Clips v2"');
    expect(changes).toContain("Changed what starts it");
    expect(changes).toContain("Added Final check");
    expect(changes.some((line) => line.startsWith("Changed ") && /transcri/i.test(line))).toBe(
      true,
    );
    expect(changes.some((line) => line.startsWith("Removed "))).toBe(true);
    expect(changes).not.toContain("Changed how the steps are joined");
  });

  it("mentions the lines only when the steps are the same", () => {
    const three = applyOperations(live, [
      { op: "add", type: "approval", id: "approval_2", after: "approval_1" },
    ]);
    const rejoined = applyOperations(three, [
      { op: "disconnect", source: "approval_1", target: "approval_2" },
      { op: "connect", source: "transcribe_1", target: "approval_2" },
    ]);
    expect(draftChanges(three, rejoined)).toEqual(["Changed how the steps are joined"]);
  });
});

describe("turning a step off", () => {
  const live = applyOperations(empty, [
    { op: "add", type: "step:video-caption", id: "caption_1" },
    { op: "add", type: "if", id: "if_1", after: "caption_1" },
  ]);

  it("keeps the step and its settings, and says so as its own change", () => {
    const off = applyOperations(live, [{ op: "switch", id: "caption_1", on: false }]);
    const caption = off.nodes.find((node) => node.id === "caption_1")!;
    expect(caption.off).toBe(true);
    expect(caption.input).toEqual(live.nodes.find((node) => node.id === "caption_1")!.input);
    const changes = draftChanges(live, off);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatch(/^Turned off /);

    const back = applyOperations(off, [{ op: "switch", id: "caption_1", on: true }]);
    expect(back.nodes.find((node) => node.id === "caption_1")!.off).toBeUndefined();
    expect(draftChanges(off, back)[0]).toMatch(/^Turned on /);
    expect(draftChanges(live, back)).toEqual([]);
  });

  it("needs no settings while off", () => {
    const off = applyOperations(live, [{ op: "switch", id: "caption_1", on: false }]);
    expect(missingSettings(off.nodes.find((node) => node.id === "caption_1")!)).toEqual([]);
  });

  it("will not turn an If off", () => {
    expect(() => applyOperations(live, [{ op: "switch", id: "if_1", on: false }])).toThrow(
      /An If cannot be turned off/,
    );
  });
});
