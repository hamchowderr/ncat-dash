import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { type AutomationDraft, applyOperations, draftProblems, type Operation } from "../src";

/**
 * Answers a real model gave (packages/agent/fixtures/recorded, made with `pnpm dev:record`).
 * Its changes are made here, in order, against the real rules, so a rule that changes
 * under the agent shows up as a failing test rather than as a model that cannot build.
 */
type Recording = {
  fixtures: {
    match: { userMessage?: string; turnIndex?: number };
    response: { toolCalls?: { name: string; arguments: string }[] };
  }[];
};

const dir = new URL("../../agent/fixtures/recorded/", import.meta.url);
const recordings = readdirSync(dir)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .flatMap((name) => (JSON.parse(readFileSync(new URL(name, dir), "utf8")) as Recording).fixtures);

/** The agent's tool sends "trigger:upload" as "upload" (packages/agent ncat/tools.ts asSent). */
function asSent(op: Operation): Operation {
  if (op.op !== "trigger" || !op.trigger.kind.startsWith("trigger:")) return op;
  return { ...op, trigger: { ...op.trigger, kind: op.trigger.kind.slice(8) } } as Operation;
}

const ASK =
  "Build an automation that makes short clips with captions from each new recording I upload.";

/** The tool calls of the recorded conversation, in order. The person's pick of platforms
 * reaches the model as the answer to ask_user, inside the same conversation. */
const calls = recordings
  .filter((fixture) => fixture.match.userMessage === ASK)
  .sort((a, b) => (a.match.turnIndex ?? 0) - (b.match.turnIndex ?? 0))
  .flatMap((fixture) => fixture.response.toolCalls ?? []);
const names = calls.map((call) => call.name);

describe("the real model's recorded changes", () => {
  it("ask which platforms before building anything, letting the person pick several", () => {
    const asked = names.indexOf("ask_user");
    expect(asked).toBeGreaterThanOrEqual(0);
    for (const change of ["create_automation", "change_automation", "try_automation"]) {
      expect(names.indexOf(change)).toBeGreaterThan(asked);
    }
    const question = JSON.parse(calls[asked]?.arguments ?? "{}") as {
      options?: { label: string }[];
      selectionMode?: string;
    };
    expect(question.selectionMode).toBe("multi_select");
    expect(question.options?.map((option) => option.label)).toEqual(
      expect.arrayContaining(["TikTok", "YouTube Shorts"]),
    );
  });

  it("build one clips step for each platform the person picked", () => {
    const build = calls
      .filter((call) => call.name === "change_automation")
      .map((call) =>
        (JSON.parse(call.arguments) as { operations: Operation[] }).operations.map(asSent),
      );
    expect(build.length).toBeGreaterThan(0);

    let draft: AutomationDraft = {
      name: "New",
      trigger: { kind: "manual" },
      nodes: [],
      edges: [],
    };
    for (const operations of build) draft = applyOperations(draft, operations);
    expect(draft.trigger.kind).toBe("upload");
    const platforms = draft.nodes
      .filter((node) => node.kind === "clips")
      .map((node) => String(node.input.platform));
    expect(platforms.sort()).toEqual(["TikTok", "YouTube Shorts"]);
    expect(draft.nodes.filter((node) => node.stepId === "video-caption")).toHaveLength(2);
    expect(draftProblems(draft)).toEqual([]);
  });

  it("try what they built before saying it is done", () => {
    expect(names).toContain("try_automation");
    expect(names.indexOf("try_automation")).toBeGreaterThan(names.lastIndexOf("change_automation"));
    expect(names.lastIndexOf("check_run")).toBeGreaterThan(names.indexOf("try_automation"));
  });
});
