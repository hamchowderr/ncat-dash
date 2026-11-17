import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { type AutomationDraft, applyOperations, draftProblems, type Operation } from "../src";

/**
 * The agent's stand-in model (packages/agent/fixtures/chat.json) answers a few set
 * requests with scripted changes. They are made here, in order, against the real rules,
 * so the script cannot drift from what an automation accepts.
 */
type Fixture = {
  response: { toolCalls?: { name: string; arguments: { operations?: Operation[] } }[] };
};

const fixtures = (
  JSON.parse(readFileSync(new URL("../../agent/fixtures/chat.json", import.meta.url), "utf8")) as {
    fixtures: Fixture[];
  }
).fixtures;

const changes = fixtures
  .flatMap((fixture) => fixture.response.toolCalls ?? [])
  .filter((call) => call.name === "change_automation")
  .map((call) => call.arguments.operations ?? []);

describe("the stand-in model's scripted changes", () => {
  it("build an automation that can run, then add to it", () => {
    expect(changes.length).toBeGreaterThanOrEqual(2);
    const empty: AutomationDraft = {
      name: "New",
      trigger: { kind: "manual" },
      nodes: [],
      edges: [],
    };
    // The script builds first, then changes what it built.
    const [addTo, build] = changes;
    const built = applyOperations(empty, build);
    expect(built.trigger.kind).toBe("upload");
    expect(built.nodes.map((node) => node.id)).toEqual(["clips", "approve"]);
    expect(draftProblems(built)).toEqual([]);

    const added = applyOperations(built, addTo);
    expect(added.nodes.map((node) => node.id).sort()).toEqual(["approve", "captions", "clips"]);
    expect(added.edges.map((edge) => `${edge.source}>${edge.target}`).sort()).toEqual([
      "captions>approve",
      "clips>captions",
    ]);
    expect(draftProblems(added)).toEqual([]);
  });
});

// A real model (recorded 2026-11-17) asked for its first step to go "after": "trigger".
describe("a step added after the trigger", () => {
  const empty: AutomationDraft = {
    name: "New",
    trigger: { kind: "upload", fileType: "video" },
    nodes: [],
    edges: [],
  };

  it("is taken as a step that runs straight from the start", () => {
    for (const after of ["trigger", "__trigger"]) {
      const built = applyOperations(empty, [
        { op: "add", id: "clips", type: "clips", settings: { platform: "Instagram Reels" }, after },
        { op: "add", id: "captions", type: "step:video-caption", after: "clips" },
      ]);
      expect(built.nodes.map((node) => node.id)).toEqual(["clips", "captions"]);
      expect(built.edges.map((edge) => `${edge.source}>${edge.target}`)).toEqual([
        "clips>captions",
      ]);
    }
  });

  it("still means that step when one is really called trigger", () => {
    const withOne = applyOperations(empty, [{ op: "add", id: "trigger", type: "clips" }]);
    const built = applyOperations(withOne, [
      { op: "add", id: "next", type: "clips", after: "trigger" },
    ]);
    expect(built.edges.map((edge) => `${edge.source}>${edge.target}`)).toEqual(["trigger>next"]);
  });
});
