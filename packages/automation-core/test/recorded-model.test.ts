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

function changesFor(request: string): Operation[][] {
  return recordings
    .filter((fixture) => fixture.match.userMessage === request)
    .sort((a, b) => (a.match.turnIndex ?? 0) - (b.match.turnIndex ?? 0))
    .flatMap((fixture) => fixture.response.toolCalls ?? [])
    .filter((call) => call.name === "change_automation")
    .map((call) =>
      (JSON.parse(call.arguments) as { operations: Operation[] }).operations.map(asSent),
    );
}

describe("the real model's recorded changes", () => {
  it("build an automation that can run", () => {
    const build = changesFor(
      "Build an automation that makes short clips with captions from each new recording I upload.",
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
    expect(draft.nodes.map((node) => node.kind)).toEqual(expect.arrayContaining(["clips", "step"]));
    expect(draft.nodes.some((node) => node.stepId === "video-caption")).toBe(true);
    expect(draftProblems(draft)).toEqual([]);
  });

  it("try what they built before saying it is done", () => {
    const calls = recordings
      .filter((fixture) => fixture.match.userMessage?.startsWith("Build an automation"))
      .sort((a, b) => (a.match.turnIndex ?? 0) - (b.match.turnIndex ?? 0))
      .flatMap((fixture) => fixture.response.toolCalls ?? [])
      .map((call) => call.name);
    expect(calls).toContain("try_automation");
    expect(calls.indexOf("try_automation")).toBeGreaterThan(calls.lastIndexOf("change_automation"));
    expect(calls.lastIndexOf("check_run")).toBeGreaterThan(calls.indexOf("try_automation"));
  });
});
