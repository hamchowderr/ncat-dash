import { describe, expect, it } from "vitest";

import {
  type AutomationEdge,
  type AutomationNode,
  type ChainMember,
  coveredByWorkflow,
  graphProblem,
  guessWorkflowKind,
  isWorkflowReview,
  reviewByDefault,
  reviewFromApprovals,
  reviewSentence,
  WORKFLOW_KINDS,
  WORKFLOW_REVIEW_ID,
  workflowEnds,
  workflowMembers,
  workflowName,
  workflowReview,
  withWorkflowReview,
} from "../src";

function member(id: string, extra: Partial<ChainMember> = {}): ChainMember {
  return { id, name: id.toUpperCase(), trigger: { kind: "manual" }, nodes: [], ...extra };
}
const follows = (automationId: string, when: "done" | "failed" | "either" = "done") =>
  ({ kind: "finished", automationId, when }) as const;

const step = (id: string, x: number, y = 0): AutomationNode => ({
  id,
  kind: "step",
  stepId: "video-caption",
  input: {},
  position: { x, y },
});
const approval = (id: string, x: number): AutomationNode => ({
  id,
  kind: "approval",
  input: { reviewers: ["u1"] },
  position: { x, y: 0 },
});
const edge = (source: string, target: string, branch?: string): AutomationEdge => ({
  id: `${source}-${target}`,
  source,
  target,
  ...(branch ? { branch } : {}),
});
const on = { on: true, reviewers: ["u2"], timeLimit: 2, timeLimitUnit: "days" as const, whenTimeUp: "approve" as const };
const workflow = { id: "w1", name: "UGC batch" };

describe("workflow kinds", () => {
  it("comes with a review for client work, UGC and your own content, not quick jobs", () => {
    expect(WORKFLOW_KINDS.filter(reviewByDefault)).toEqual(["client", "ugc", "own"]);
    expect(reviewByDefault("quick")).toBe(false);
  });

  it("guesses client work from a client, then UGC, then your own content", () => {
    expect(guessWorkflowKind({ hasClient: true, ugc: true })).toBe("client");
    expect(guessWorkflowKind({ hasClient: false, ugc: true })).toBe("ugc");
    expect(guessWorkflowKind({ hasClient: false, ugc: false })).toBe("own");
  });

  it("reads a review with the kind's default when on/off was never set", () => {
    expect(workflowReview(undefined, "ugc")).toEqual({ on: true, reviewers: [] });
    expect(workflowReview({}, "quick").on).toBe(false);
    expect(workflowReview({ on: false, reviewers: ["a", "a", ""] }, "client")).toEqual({
      on: false,
      reviewers: ["a"],
    });
    expect(workflowReview({ on: true, timeLimit: 3, timeLimitUnit: "days" }, "own")).toEqual({
      on: true,
      reviewers: [],
      timeLimit: 3,
      timeLimitUnit: "days",
      whenTimeUp: "reject",
    });
  });

  it("says the review in a line", () => {
    const names = (id: string) => ({ u2: "Ada" })[id];
    expect(reviewSentence({ ...on }, names)).toBe("Ada, approves after 2 days");
    expect(reviewSentence({ on: false, reviewers: [] }, names)).toMatch(/^No review/);
    expect(reviewSentence({ on: true, reviewers: [] }, names)).toBe("Anyone on the team");
  });

  it("starts the review from the first Approval step it finds", () => {
    expect(
      reviewFromApprovals([
        { nodes: [step("a", 0)] },
        {
          nodes: [
            { kind: "approval", off: true, input: { reviewers: ["x"] } },
            { kind: "approval", input: { reviewers: ["u1"], timeLimit: 24, timeLimitUnit: "hours" } },
          ],
        },
      ]),
    ).toEqual({ reviewers: ["u1"], timeLimit: 24, timeLimitUnit: "hours", whenTimeUp: "reject" });
    expect(reviewFromApprovals([{ nodes: [step("a", 0)] }])).toEqual({});
  });

  it("names it after the first automation when nothing is typed", () => {
    expect(workflowName("  ", "Clips")).toBe("Clips");
    expect(workflowName(" Weekly ads ", "Clips")).toBe("Weekly ads");
    expect(workflowName("x".repeat(100), "Clips")).toHaveLength(80);
  });
});

describe("the end of a workflow", () => {
  it("is the last automation of a straight chain", () => {
    const members = [member("a"), member("b", { trigger: follows("a") }), member("c", { trigger: follows("b", "either") })];
    expect([...workflowEnds(members, ["a", "b", "c"])]).toEqual(["c"]);
  });

  it("keeps an automation whose only follower is its backup for when it fails", () => {
    const members = [member("a"), member("backup", { trigger: follows("a", "failed") })];
    expect([...workflowEnds(members, ["a", "backup"])]).toEqual(["a", "backup"]);
  });

  it("is the automation that waits for another, not the one it runs", () => {
    const runsB = { id: "s", kind: "automation" as const, input: { automation: "b" }, position: { x: 0, y: 0 } };
    const members = [member("a", { nodes: [runsB] }), member("b")];
    expect([...workflowEnds(members, ["a", "b"])]).toEqual(["a"]);
    const noWait = { ...runsB, input: { automation: "b", wait: false } };
    expect([...workflowEnds([member("a", { nodes: [noWait] }), member("b")], ["a", "b"])]).toEqual(["a", "b"]);
  });

  it("follows more triggers when an automation has several", () => {
    const members = [
      member("a"),
      { ...member("b"), moreTriggers: [{ trigger: follows("a") }] } as ChainMember,
    ];
    expect([...workflowEnds(members, ["a", "b"])]).toEqual(["b"]);
  });

  it("follows its automations as links change, from the one holding most of the others", () => {
    const members = [member("a"), member("b", { trigger: follows("a") }), member("c"), member("d", { trigger: follows("c") })];
    expect(workflowMembers(members, ["a", "b"])).toEqual(["a", "b"]);
    // "a" was deleted: the chain around "b" is still the workflow.
    expect(workflowMembers(members.slice(1), ["a", "b"])).toEqual(["b"]);
    expect(workflowMembers(members, ["c", "d", "b"])).toEqual(["c", "d"]);
    expect(workflowMembers(members, ["gone"])).toEqual([]);
  });
});

describe("a run with the workflow's review", () => {
  const nodes = [step("cut", 0), step("caption", 220), approval("approve", 440)];
  const edges = [edge("cut", "caption"), edge("caption", "approve")];

  it("adds one review after the last steps of the last automation", () => {
    const made = withWorkflowReview(nodes, edges, on, workflow, true);
    const review = made.nodes.find(isWorkflowReview)!;
    expect(review).toMatchObject({
      id: WORKFLOW_REVIEW_ID,
      kind: "approval",
      label: "UGC batch review",
      input: { reviewers: ["u2"], timeLimit: 2, timeLimitUnit: "days", whenTimeUp: "approve", workflowId: "w1" },
      position: { x: 660, y: 0 },
    });
    expect(made.edges.at(-1)).toMatchObject({ source: "approve", target: WORKFLOW_REVIEW_ID });
    expect(graphProblem(made.nodes, made.edges)).toBeNull();
  });

  it("passes the automation's own Approval step through instead of asking twice", () => {
    const made = withWorkflowReview(nodes, edges, on, workflow, false);
    const own = made.nodes.find((node) => node.id === "approve")!;
    expect(own.off).toBe(true);
    expect(coveredByWorkflow(own)).toBe(true);
    expect(made.nodes.some(isWorkflowReview)).toBe(false);
    expect(made.edges).toEqual(edges);
  });

  it("takes every last step, each way out of an If, and not a way for failures", () => {
    const ifNode: AutomationNode = { id: "check", kind: "if", input: {}, position: { x: 220, y: 100 } };
    const many = [step("a", 0), step("b", 220, 0), ifNode, step("backup", 440, 200)];
    const wires = [edge("a", "b"), edge("a", "check"), edge("b", "backup", "failed")];
    const made = withWorkflowReview(many, wires, on, workflow, true);
    const into = made.edges.filter((each) => each.target === WORKFLOW_REVIEW_ID);
    expect(into.map((each) => [each.source, each.branch])).toEqual([
      ["b", undefined],
      ["check", "yes"],
      ["check", "no"],
      ["backup", undefined],
    ]);
  });

  it("changes nothing with the review off", () => {
    const made = withWorkflowReview(nodes, edges, { on: false, reviewers: [] }, workflow, true);
    expect(made.nodes).toBe(nodes);
    expect(made.edges).toBe(edges);
  });
});
