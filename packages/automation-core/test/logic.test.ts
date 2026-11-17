import { describe, expect, it } from "vitest";

import {
  applyOperations,
  type AutomationDraft,
  type AutomationEdge,
  type AutomationNode,
  automationFileName,
  branchesToward,
  conditionProblem,
  conditionSentence,
  draftProblems,
  exportAutomation,
  type FileDetails,
  getNodeType,
  graphProblem,
  type NodeStatus,
  OperationError,
  outline,
  parseAutomationFile,
  passedOverNodes,
  passes,
  readAutomationFile,
  readCondition,
  readyNodes,
  sortFiles,
  uploadRef,
  waitMs,
  waitProblem,
  waitSentence,
} from "../src";

const video: FileDetails = {
  duration: 95,
  width: 1920,
  height: 1080,
  hasVideo: true,
  hasAudio: true,
  format: "mov,mp4,m4a,3gp,3g2,mj2",
};
const vertical: FileDetails = { ...video, duration: 20, width: 1080, height: 1920 };
const picture: FileDetails = { width: 800, height: 800, format: "png_pipe", hasVideo: true };
const sound: FileDetails = { duration: 200, hasAudio: true, audioCodec: "mp3", format: "mp3" };

describe("if conditions", () => {
  it("starts with a check that works as it is", () => {
    const nodeType = getNodeType("if")!;
    expect(nodeType.branches).toEqual(["yes", "no"]);
    expect(conditionProblem({ check: "length", is: "longer", value: 60 })).toBeNull();
    expect(conditionSentence({ check: "length", is: "longer", value: 60 })).toBe(
      "Longer than 1:00",
    );
  });

  it("checks length, and never passes a file with no length", () => {
    const longer = readCondition({ check: "length", is: "longer", value: 60 })!;
    expect(passes(longer, video)).toBe(true);
    expect(passes(longer, vertical)).toBe(false);
    expect(passes(longer, picture)).toBe(false);
    expect(passes(longer, null)).toBe(false);
    const shorter = readCondition({ check: "length", is: "shorter", value: 60 })!;
    expect(passes(shorter, vertical)).toBe(true);
    expect(passes(shorter, picture)).toBe(false);
  });

  it("checks type, shape, picture size and sound", () => {
    expect(passes({ check: "type", is: "video" }, video)).toBe(true);
    expect(passes({ check: "type", is: "image" }, picture)).toBe(true);
    expect(passes({ check: "type", is: "audio" }, sound)).toBe(true);
    expect(passes({ check: "type", is: "video" }, sound)).toBe(false);

    expect(passes({ check: "shape", is: "wide" }, video)).toBe(true);
    expect(passes({ check: "shape", is: "tall" }, vertical)).toBe(true);
    expect(passes({ check: "shape", is: "square" }, picture)).toBe(true);
    expect(passes({ check: "shape", is: "square" }, { width: 1080, height: 1088 })).toBe(true);
    expect(passes({ check: "shape", is: "tall" }, { width: 1080, height: 1088 })).toBe(false);
    expect(passes({ check: "shape", is: "wide" }, sound)).toBe(false);

    // Size goes by the shorter side, so a vertical 1080 by 1920 video is 1080p.
    expect(passes({ check: "size", is: "at_least", value: 1080 }, vertical)).toBe(true);
    expect(passes({ check: "size", is: "below", value: 1080 }, picture)).toBe(true);
    expect(passes({ check: "size", is: "at_least", value: 2160 }, video)).toBe(false);

    expect(passes({ check: "sound", is: "present" }, video)).toBe(true);
    expect(passes({ check: "sound", is: "absent" }, { ...video, hasAudio: false })).toBe(true);
    expect(passes({ check: "sound", is: "absent" }, picture)).toBe(false);
  });

  it("says what is wrong with settings that make no check", () => {
    expect(conditionProblem({})).toBe("Choose what to check.");
    expect(conditionProblem({ check: "length", is: "video" })).toMatch(/length/);
    expect(conditionProblem({ check: "length", is: "longer" })).toMatch(/length above zero/);
    expect(conditionProblem({ check: "size", is: "below", value: -1 })).toMatch(/picture size/);
    expect(readCondition({ check: "type", is: "video", value: 5 })).toEqual({
      check: "type",
      is: "video",
    });
    expect(conditionSentence({ check: "type", is: "image" })).toBe("Is a picture");
    expect(conditionSentence({ check: "size", is: "at_least", value: 1080 })).toBe(
      "At least 1080p (Full HD)",
    );
    expect(conditionSentence({ check: "sound", is: "absent" })).toBe("Has no sound");
  });

  it("sorts files into yes and no, keeping their order", () => {
    const condition = readCondition({ check: "length", is: "longer", value: 60 })!;
    expect(
      sortFiles(condition, [
        { url: "a", details: video },
        { url: "b", details: vertical },
        { url: "c", details: null },
        { url: "d", details: sound },
      ]),
    ).toEqual({ yes: ["a", "d"], no: ["b", "c"] });
  });
});

describe("wait", () => {
  it("turns an amount and a unit into time", () => {
    expect(waitMs({ amount: 30, unit: "minutes" })).toBe(30 * 60_000);
    expect(waitMs({ amount: 1.5, unit: "hours" })).toBe(90 * 60_000);
    expect(waitSentence({ amount: 1, unit: "hours" })).toBe("1 hour");
    expect(waitSentence({ amount: 2, unit: "days" })).toBe("2 days");
  });

  it("refuses a wait that is missing, zero or longer than six days", () => {
    expect(waitProblem({})).toMatch(/how long/);
    expect(waitProblem({ amount: 0, unit: "hours" })).toMatch(/how long/);
    expect(waitProblem({ amount: 5, unit: "weeks" })).toMatch(/minutes, hours or days/);
    expect(waitProblem({ amount: 7, unit: "days" })).toMatch(/6 days/);
    expect(waitProblem({ amount: 6, unit: "days" })).toBeNull();
    expect(waitMs({ amount: 7, unit: "days" })).toBeNull();
  });
});

const node = (id: string, kind: AutomationNode["kind"] = "approval"): AutomationNode => ({
  id,
  kind,
  input: {},
  position: { x: 0, y: 0 },
});
const edge = (source: string, target: string, branch?: string): AutomationEdge => ({
  id: `${source}>${target}`,
  source,
  target,
  ...(branch ? { branch } : {}),
});

describe("branches in a run", () => {
  // start -> if -yes-> a -> merge ; if -no-> b -> merge
  const nodes = [node("start"), node("if", "if"), node("a"), node("b"), node("merge")];
  const edges = [
    edge("start", "if"),
    edge("if", "a", "yes"),
    edge("if", "b", "no"),
    edge("a", "merge"),
    edge("b", "merge"),
  ];
  const status = (overrides: Record<string, NodeStatus>): Record<string, NodeStatus> => ({
    start: "done",
    if: "done",
    a: "pending",
    b: "pending",
    merge: "pending",
    ...overrides,
  });
  const ids = (found: AutomationNode[]) => found.map((item) => item.id);

  it("requires a way out on every line from an If, and on no other line", () => {
    expect(graphProblem(nodes, edges)).toBeNull();
    expect(graphProblem(nodes, [edge("start", "if"), edge("if", "a")])).toMatch(/yes or no/);
    expect(graphProblem(nodes, [edge("start", "if", "yes")])).toMatch(/Only an If/);
    expect(graphProblem(nodes, [edge("if", "a", "maybe")])).toMatch(/yes or no/);
  });

  it("behaves as before when there is no If", () => {
    const plain = [node("one"), node("two")];
    const line = [edge("one", "two")];
    expect(ids(readyNodes(plain, line, { one: "pending", two: "pending" }))).toEqual(["one"]);
    expect(ids(readyNodes(plain, line, { one: "running", two: "pending" }))).toEqual([]);
    expect(ids(readyNodes(plain, line, { one: "done", two: "pending" }))).toEqual(["two"]);
    expect(ids(passedOverNodes(plain, line, { one: "done", two: "pending" }))).toEqual([]);
  });

  it("starts only the way that got files and passes over the other", () => {
    const taken = { if: ["yes"] };
    expect(ids(readyNodes(nodes, edges, status({}), taken))).toEqual(["a"]);
    expect(ids(passedOverNodes(nodes, edges, status({}), taken))).toEqual(["b"]);
  });

  it("starts both ways when files went both ways", () => {
    const taken = { if: ["yes", "no"] };
    expect(ids(readyNodes(nodes, edges, status({}), taken))).toEqual(["a", "b"]);
    expect(ids(passedOverNodes(nodes, edges, status({}), taken))).toEqual([]);
  });

  it("lets the two ways join again once the one that ran is done", () => {
    const taken = { if: ["no"] };
    expect(ids(readyNodes(nodes, edges, status({ a: "skipped", b: "running" }), taken))).toEqual(
      [],
    );
    expect(ids(readyNodes(nodes, edges, status({ a: "skipped", b: "done" }), taken))).toEqual([
      "merge",
    ]);
  });

  it("passes over a whole chain behind a way that was not taken", () => {
    const chain = [node("if", "if"), node("a"), node("after")];
    const lines = [edge("if", "a", "yes"), edge("a", "after")];
    const first = passedOverNodes(
      chain,
      lines,
      { if: "done", a: "pending", after: "pending" },
      { if: [] },
    );
    expect(ids(first)).toEqual(["a"]);
    const second = passedOverNodes(
      chain,
      lines,
      { if: "done", a: "skipped", after: "pending" },
      { if: [] },
    );
    expect(ids(second)).toEqual(["after"]);
  });

  it("knows which of an If's ways leads to a later step", () => {
    expect(branchesToward("if", "a", edges)).toEqual(["yes"]);
    expect(branchesToward("if", "b", edges)).toEqual(["no"]);
    expect(branchesToward("if", "merge", edges).sort()).toEqual(["no", "yes"]);
    expect(branchesToward("start", "merge", edges)).toEqual([]);
  });
});

const empty: AutomationDraft = {
  name: "Sort by length",
  trigger: { kind: "upload", fileType: "video" },
  nodes: [],
  edges: [],
};

describe("building with an If", () => {
  const built = applyOperations(empty, [
    { op: "add", type: "if", id: "if_1" },
    { op: "add", type: "clips", id: "clips_1", after: "if_1" },
    { op: "add", type: "step:video-caption", id: "caption_1", after: "if_1" },
    { op: "add", type: "wait", id: "wait_1", after: "caption_1" },
  ]);

  it("hangs the first step on yes, the next on no, and fans them apart", () => {
    expect(built.edges).toEqual([
      { id: "if_1>clips_1", source: "if_1", target: "clips_1", branch: "yes" },
      { id: "if_1>caption_1", source: "if_1", target: "caption_1", branch: "no" },
      { id: "caption_1>wait_1", source: "caption_1", target: "wait_1" },
    ]);
    const y = (id: string) => built.nodes.find((item) => item.id === id)!.position.y;
    expect(y("clips_1")).toBeLessThan(y("if_1"));
    expect(y("caption_1")).toBeGreaterThan(y("if_1"));
    expect(built.nodes.find((item) => item.id === "if_1")!.input).toEqual({
      check: "length",
      is: "longer",
      value: 60,
    });
    expect(built.nodes.find((item) => item.id === "wait_1")!.input).toEqual({
      amount: 30,
      unit: "minutes",
    });
    expect(draftProblems(built)).toEqual([]);
    expect(graphProblem(built.nodes, built.edges)).toBeNull();
  });

  it("names the way in the outline the agent reads", () => {
    expect(outline(built)).toContain("clips_1 [clips] from if_1 (yes)");
    expect(outline(built)).toContain("caption_1 [step:video-caption] from if_1 (no)");
  });

  it("takes the way asked for, and refuses one that does not exist", () => {
    const asked = applyOperations(empty, [
      { op: "add", type: "if", id: "if_1" },
      { op: "add", type: "clips", id: "clips_1", after: "if_1", branch: "no" },
    ]);
    expect(asked.edges[0].branch).toBe("no");
    expect(() =>
      applyOperations(asked, [{ op: "add", type: "wait", after: "if_1", branch: "maybe" }]),
    ).toThrow(OperationError);
    expect(() =>
      applyOperations(asked, [{ op: "add", type: "wait", after: "clips_1", branch: "yes" }]),
    ).toThrow(/only one way out/);
  });

  it("moves a line to the other way when the same two steps are connected again", () => {
    const moved = applyOperations(built, [
      { op: "connect", source: "if_1", target: "clips_1", branch: "no" },
    ]);
    expect(moved.edges.find((item) => item.target === "clips_1")!.branch).toBe("no");
    expect(moved.edges).toHaveLength(3);
  });

  it("keeps a step on its way when the step before it is removed or one is put in between", () => {
    const removed = applyOperations(built, [{ op: "remove", ids: ["caption_1"] }]);
    expect(removed.edges).toContainEqual({
      id: "if_1>wait_1",
      source: "if_1",
      target: "wait_1",
      branch: "no",
    });
    const between = applyOperations(built, [
      { op: "add", type: "approval", id: "approval_1", after: "if_1", before: "caption_1" },
    ]);
    expect(between.edges).toContainEqual({
      id: "if_1>approval_1",
      source: "if_1",
      target: "approval_1",
      branch: "no",
    });
    expect(between.edges).toContainEqual({
      id: "approval_1>caption_1",
      source: "approval_1",
      target: "caption_1",
    });
    expect(graphProblem(between.nodes, between.edges)).toBeNull();
  });

  it("joins what fed a removed If straight to what followed it", () => {
    const start = applyOperations(empty, [
      { op: "add", type: "approval", id: "approval_1" },
      { op: "add", type: "if", id: "if_1", after: "approval_1" },
      { op: "add", type: "clips", id: "clips_1", after: "if_1" },
    ]);
    const removed = applyOperations(start, [{ op: "remove", ids: ["if_1"] }]);
    expect(removed.edges).toEqual([
      { id: "approval_1>clips_1", source: "approval_1", target: "clips_1" },
    ]);
    expect(graphProblem(removed.nodes, removed.edges)).toBeNull();
  });

  it("puts an If on a line and carries on by yes", () => {
    const line = applyOperations(empty, [
      { op: "add", type: "approval", id: "approval_1" },
      { op: "add", type: "clips", id: "clips_1", after: "approval_1" },
      { op: "add", type: "if", id: "if_1", after: "approval_1", before: "clips_1" },
    ]);
    expect(line.edges).toContainEqual({
      id: "if_1>clips_1",
      source: "if_1",
      target: "clips_1",
      branch: "yes",
    });
    expect(graphProblem(line.nodes, line.edges)).toBeNull();
  });

  it("reports settings that make no check", () => {
    const broken = applyOperations(built, [
      { op: "set", id: "if_1", settings: { check: "type" } },
      { op: "set", id: "wait_1", settings: { amount: 9, unit: "days" } },
    ]);
    const messages = draftProblems(broken).map((problem) => problem.message);
    expect(messages).toContainEqual(expect.stringContaining("If: Choose what the type"));
    expect(messages).toContainEqual(expect.stringContaining("Wait: A wait can be 6 days"));
  });

  it("puts what hangs off no below what hangs off yes when tidied", () => {
    const swapped = applyOperations(empty, [
      { op: "add", type: "if", id: "if_1" },
      { op: "add", type: "clips", id: "low", after: "if_1", branch: "no" },
      { op: "add", type: "clips", id: "high", after: "if_1", branch: "yes" },
      { op: "tidy" },
    ]);
    const y = (id: string) => swapped.nodes.find((item) => item.id === id)!.position.y;
    expect(y("high")).toBeLessThan(y("low"));
  });
});

describe("export and import", () => {
  const draft = applyOperations(empty, [
    { op: "add", type: "if", id: "if_1" },
    { op: "add", type: "clips", id: "clips_1", after: "if_1" },
    {
      op: "add",
      type: "step:recipe-logo",
      id: "logo_1",
      after: "if_1",
      settings: { logo_url: uploadRef("abc123") },
    },
  ]);

  it("comes back the same after a round trip, apart from the team's own files", () => {
    const { file, notes } = exportAutomation(draft);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/1 setting that pointed at one of your own uploads/);
    expect(JSON.stringify(file)).not.toContain("upload:");

    const read = parseAutomationFile(JSON.stringify(file));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.notes).toEqual([]);
    expect(read.draft.name).toBe("Sort by length");
    expect(read.draft.trigger).toEqual(draft.trigger);
    expect(read.draft.edges).toEqual(draft.edges);
    expect(read.draft.nodes).toEqual(
      draft.nodes.map((item) => (item.id === "logo_1" ? { ...item, input: {} } : item)),
    );
  });

  it("names the file after the automation", () => {
    expect(automationFileName("Clips for Social!")).toBe("clips-for-social.automation.json");
    expect(automationFileName("  ")).toBe("automation.automation.json");
  });

  const file = () => JSON.parse(JSON.stringify(exportAutomation(draft).file));

  it("refuses anything that is not an automation file", () => {
    expect(parseAutomationFile("not json").ok).toBe(false);
    expect(readAutomationFile({ nodes: [] }).ok).toBe(false);
    expect(readAutomationFile(null).ok).toBe(false);
    expect(readAutomationFile({ ...file(), version: 2 })).toMatchObject({
      ok: false,
      message: expect.stringContaining("newer version"),
    });
    expect(parseAutomationFile("x".repeat(600_000))).toMatchObject({
      ok: false,
      message: expect.stringContaining("too large"),
    });
  });

  it("refuses steps this dashboard does not have, loops and broken connections", () => {
    const unknown = file();
    unknown.nodes[1] = { ...unknown.nodes[1], kind: "step", stepId: "video-teleport" };
    expect(readAutomationFile(unknown)).toMatchObject({
      ok: false,
      message: expect.stringContaining("video-teleport"),
    });

    const loop = file();
    loop.edges.push({ id: "x", source: "clips_1", target: "if_1" });
    expect(readAutomationFile(loop)).toMatchObject({
      ok: false,
      message: expect.stringContaining("loop"),
    });

    const dangling = file();
    dangling.edges.push({ id: "x", source: "clips_1", target: "gone" });
    expect(readAutomationFile(dangling).ok).toBe(false);

    const twins = file();
    twins.nodes.push({ ...twins.nodes[0] });
    expect(readAutomationFile(twins).ok).toBe(false);
  });

  it("drops what it cannot use and says so", () => {
    const odd = file();
    odd.trigger = { kind: "teleport" };
    odd.nodes[0].input = { ...odd.nodes[0].input, extra: 1, $where: "x", __proto__x: 2 };
    odd.nodes[2].input = { logo_url: uploadRef("theirs") };
    odd.nodes[1].position = "nowhere";
    odd.edges[0] = { source: "if_1", target: "clips_1" };
    const read = readAutomationFile(odd);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.draft.trigger).toEqual({ kind: "manual" });
    expect(read.draft.nodes[0].input).toEqual({ check: "length", is: "longer", value: 60 });
    expect(read.draft.nodes[2].input).toEqual({});
    // A line out of an If with no way named leaves by yes.
    expect(read.draft.edges[0]).toEqual({
      id: "if_1>clips_1",
      source: "if_1",
      target: "clips_1",
      branch: "yes",
    });
    // No usable places, so the steps were laid out again.
    expect(new Set(read.draft.nodes.map((item) => item.position.x)).size).toBeGreaterThan(1);
    expect(read.notes.join(" ")).toMatch(/starts by hand/);
    expect(read.notes.join(" ")).toMatch(/another team's uploads/);
    expect(read.notes.join(" ")).toMatch(/3 settings this version does not use/);
  });

  it("does not let a file reach into object internals", () => {
    const text = JSON.stringify(exportAutomation(draft).file).replace(
      '"check":"length"',
      '"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"check":"length"',
    );
    const read = parseAutomationFile(text);
    expect(read.ok).toBe(true);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    if (read.ok)
      expect(Object.keys(read.draft.nodes[0].input).sort()).toEqual(["check", "is", "value"]);
  });

  it("keeps a schedule that is valid and falls back on one that is not", () => {
    const good = file();
    good.trigger = { kind: "schedule", schedule: { mode: "interval", minutes: 60 } };
    const read = readAutomationFile(good);
    expect(read.ok && read.draft.trigger).toEqual(good.trigger);
    const bad = file();
    bad.trigger = { kind: "schedule", schedule: { mode: "interval", minutes: -5 } };
    const fallback = readAutomationFile(bad);
    expect(fallback.ok && fallback.draft.trigger).toEqual({ kind: "manual" });
  });
});
