import { describe, expect, it } from "vitest";

import {
  applyOperations,
  type AutomationDraft,
  branchOf,
  chainGroup,
  chainLoop,
  draftChanges,
  draftProblems,
  exportAutomation,
  FIRST_TRIGGER,
  isTriggerId,
  outline,
  readAutomationFile,
  startsByTrigger,
  startsOf,
  triggersOf,
  triggersProblem,
  unstartedSteps,
} from "../src";

const empty: AutomationDraft = {
  name: "Two ways in",
  trigger: { kind: "manual" },
  nodes: [],
  edges: [],
};
const upload = { kind: "upload", fileType: "video" } as const;
const folder = { kind: "folder", prefix: "incoming/", fileType: "video" } as const;
const daily = {
  kind: "schedule",
  schedule: { mode: "daily", time: "09:00", timeZone: "UTC" },
} as const;

/** Upload starts transcribe then thumbnail; a schedule starts its own convert step. */
function twoBranches(): AutomationDraft {
  return applyOperations({ ...empty, trigger: upload }, [
    { op: "add", type: "step:media-transcribe", id: "transcribe" },
    { op: "add", type: "step:video-thumbnail", id: "thumb", after: "transcribe" },
    { op: "addTrigger", trigger: daily },
    { op: "add", type: "step:video-trim", id: "mp3", after: "__trigger_2" },
  ]);
}

describe("several triggers on one automation", () => {
  it("keeps an automation with one trigger exactly as it was", () => {
    const one = applyOperations(empty, [{ op: "add", type: "step:media-transcribe", id: "a" }]);
    expect(one.moreTriggers).toBeUndefined();
    expect(one.triggerStarts).toBeUndefined();
    expect(startsOf(one, FIRST_TRIGGER)).toEqual(["a"]);
    expect(branchOf(one, FIRST_TRIGGER)).toEqual({ nodes: one.nodes, edges: one.edges });
  });

  it("gives each trigger its own branch of steps", () => {
    const draft = twoBranches();
    expect(triggersOf(draft).map((each) => each.id)).toEqual([FIRST_TRIGGER, "__trigger_2"]);
    expect(startsOf(draft, FIRST_TRIGGER)).toEqual(["transcribe"]);
    expect(startsOf(draft, "__trigger_2")).toEqual(["mp3"]);
    expect(branchOf(draft, FIRST_TRIGGER).nodes.map((node) => node.id)).toEqual([
      "transcribe",
      "thumb",
    ]);
    const second = branchOf(draft, "__trigger_2");
    expect(second.nodes.map((node) => node.id)).toEqual(["mp3"]);
    expect(second.edges).toEqual([]);
    expect(triggersProblem(draft)).toBeNull();
  });

  it("lets two triggers start the same steps", () => {
    const draft = applyOperations({ ...empty, trigger: upload }, [
      { op: "add", type: "step:media-transcribe", id: "transcribe" },
      { op: "addTrigger", trigger: folder, starts: ["transcribe"] },
    ]);
    expect(startsByTrigger(draft)).toEqual(
      new Map([
        [FIRST_TRIGGER, ["transcribe"]],
        ["__trigger_2", ["transcribe"]],
      ]),
    );
    expect(branchOf(draft, "__trigger_2").nodes.map((node) => node.id)).toEqual(["transcribe"]);
  });

  it("connects and disconnects a trigger like a line", () => {
    let draft = twoBranches();
    draft = applyOperations(draft, [
      { op: "connect", source: "__trigger_2", target: "transcribe" },
    ]);
    expect(startsOf(draft, "__trigger_2").sort()).toEqual(["mp3", "transcribe"]);
    // The first trigger still starts it too.
    expect(startsOf(draft, FIRST_TRIGGER)).toEqual(["transcribe"]);
    draft = applyOperations(draft, [
      { op: "disconnect", source: FIRST_TRIGGER, target: "transcribe" },
    ]);
    expect(startsOf(draft, FIRST_TRIGGER)).toEqual([]);
    expect(triggersProblem(draft)).toMatch(/not connected to a step/);
    expect(() =>
      applyOperations(draft, [{ op: "connect", source: "__trigger_2", target: "thumb" }]),
    ).toThrow(/only start a step that nothing else feeds/);
    expect(() =>
      applyOperations(draft, [{ op: "connect", source: "transcribe", target: FIRST_TRIGGER }]),
    ).toThrow(/Nothing can lead into a trigger/);
  });

  it("hands a removed start step's triggers to the steps after it", () => {
    const draft = applyOperations(twoBranches(), [
      { op: "add", type: "step:video-thumbnail", id: "after_mp3", after: "mp3" },
      { op: "remove", ids: ["mp3"] },
    ]);
    expect(startsOf(draft, "__trigger_2")).toEqual(["after_mp3"]);
    expect(startsOf(draft, FIRST_TRIGGER)).toEqual(["transcribe"]);
  });

  it("puts a step in front of a start step on the same trigger", () => {
    const draft = applyOperations(twoBranches(), [
      { op: "add", type: "step:media-transcribe", id: "first", before: "mp3" },
    ]);
    expect(startsOf(draft, "__trigger_2")).toEqual(["first"]);
    expect(startsOf(draft, FIRST_TRIGGER)).toEqual(["transcribe"]);
  });

  it("gives a step joined to nothing to the first trigger", () => {
    const draft = applyOperations(twoBranches(), [
      { op: "add", type: "step:media-transcribe", id: "loose" },
    ]);
    expect(startsOf(draft, FIRST_TRIGGER).sort()).toEqual(["loose", "transcribe"]);
    expect(unstartedSteps(draft)).toEqual([]);
  });

  it("removes a trigger, and makes the next one first when the first goes", () => {
    const draft = twoBranches();
    const without = applyOperations(draft, [{ op: "removeTrigger", id: "__trigger_2" }]);
    expect(without.moreTriggers).toBeUndefined();
    // On its own again, the first trigger starts every step nothing feeds.
    expect(without.triggerStarts).toBeUndefined();
    expect(unstartedSteps(without)).toEqual([]);
    expect(draftProblems(without).map((problem) => problem.message)).toEqual([]);

    const promoted = applyOperations(draft, [{ op: "remove", ids: [FIRST_TRIGGER] }]);
    expect(promoted.trigger).toEqual(daily);
    expect(promoted.moreTriggers).toBeUndefined();
    expect(startsOf(promoted, FIRST_TRIGGER).sort()).toEqual(["mp3", "transcribe"]);

    expect(() => applyOperations(empty, [{ op: "removeTrigger", id: FIRST_TRIGGER }])).toThrow(
      /needs a trigger/,
    );
  });

  it("changes one trigger without touching the others", () => {
    const draft = applyOperations(twoBranches(), [
      { op: "trigger", id: "__trigger_2", trigger: folder },
    ]);
    expect(draft.trigger).toEqual(upload);
    expect(draft.moreTriggers?.[0].trigger).toEqual(folder);
    expect(() =>
      applyOperations(draft, [{ op: "trigger", id: "__trigger_9", trigger: folder }]),
    ).toThrow(/no trigger called/);
  });

  it("allows only one webhook and one Run now", () => {
    const hooked = applyOperations({ ...empty, trigger: { kind: "webhook" } }, [
      { op: "add", type: "step:media-transcribe", id: "a" },
    ]);
    expect(() =>
      applyOperations(hooked, [{ op: "addTrigger", trigger: { kind: "webhook" } }]),
    ).toThrow(/only have one/);
    expect(() =>
      applyOperations(empty, [{ op: "addTrigger", trigger: { kind: "manual" } }]),
    ).toThrow(/Run now/);
  });

  it("names every trigger and what it starts for the agent", () => {
    const text = outline(twoBranches());
    expect(text).toContain("Triggers (each run does only what its trigger starts):");
    expect(text).toContain(`- ${FIRST_TRIGGER} [trigger:upload]`);
    expect(text).toContain("- __trigger_2 [trigger:schedule]");
    expect(text).toMatch(/- mp3 \[step:video-trim\] from __trigger_2/);
    // One trigger reads as it always has.
    expect(outline(applyOperations(empty, [{ op: "add", type: "step:media-transcribe" }]))).toMatch(
      /^Automation "Two ways in"\nStarts: trigger:manual/,
    );
  });

  it("checks every trigger's settings", () => {
    const draft = applyOperations(twoBranches(), [
      {
        op: "addTrigger",
        trigger: { kind: "finished", automationId: "", when: "done" },
        starts: ["mp3"],
      },
    ]);
    expect(draftProblems(draft).map((problem) => problem.message)).toContain(
      "Pick which automation it waits for.",
    );
  });

  it("says when what starts it changed", () => {
    const live = twoBranches();
    const draft = applyOperations(live, [{ op: "trigger", id: "__trigger_2", trigger: folder }]);
    expect(draftChanges(live, draft)).toContain("Changed what starts it");
  });

  it("follows every finished trigger in chains", () => {
    const members = [
      { id: "a", name: "A", trigger: { kind: "manual" } as const, nodes: [] },
      {
        id: "b",
        name: "B",
        trigger: { kind: "manual" } as const,
        moreTriggers: [{ trigger: { kind: "finished", automationId: "a", when: "done" } as const }],
        nodes: [{ kind: "automation" as const, input: { automation: "a" } }],
      },
    ];
    expect(chainLoop("b", members)).toEqual(["B", "A", "B"]);
    expect(chainGroup(members, "a").links).toContainEqual({ from: "a", to: "b", how: "done" });
  });

  it("keeps every trigger in an exported file", () => {
    const draft = twoBranches();
    const { file } = exportAutomation(draft);
    const read = readAutomationFile(JSON.parse(JSON.stringify(file)));
    if (!read.ok) throw new Error(read.message);
    expect(read.draft.moreTriggers).toEqual(draft.moreTriggers);
    expect(startsOf(read.draft, "__trigger_2")).toEqual(["mp3"]);
  });

  it("tells trigger ids from step ids", () => {
    expect(isTriggerId(FIRST_TRIGGER)).toBe(true);
    expect(isTriggerId("__trigger_3")).toBe(true);
    expect(isTriggerId("transcribe_1")).toBe(false);
  });
});
