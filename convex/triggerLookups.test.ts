import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { startRun } from "./lib/runner";
import { teamEnabledWithTrigger } from "./lib/triggers";
import { addPerson, addTeam, backend } from "./test.setup";

type Node = Doc<"automations">["nodes"][number];
type Trigger = Doc<"automations">["trigger"];

// Turned off, so a run needs no toolkit: it hands its files straight on.
const offStep = (id: string): Node => ({
  id,
  kind: "step",
  stepId: "video-trim",
  input: {},
  position: { x: 0, y: 0 },
  off: true,
});

async function setUp() {
  const t = backend();
  const salt = await addTeam(t, "Salt House");
  const harbor = await addTeam(t, "Harbor Films");
  const maya = await addPerson(t, "Maya Ortiz", [salt, harbor], "owner");
  const automation = (
    organizationId: string,
    name: string,
    trigger: Trigger,
    more: Partial<Doc<"automations">> = {},
  ) =>
    t.run((ctx) =>
      ctx.db.insert("automations", {
        organizationId,
        name,
        enabled: true,
        trigger,
        nodes: [offStep("trim")],
        edges: [],
        hookToken: name,
        nextRunAt: null,
        createdBy: maya.id,
        updatedAt: Date.now(),
        ...more,
      }),
    );
  return { t, salt, harbor, maya, automation };
}

describe("finding the automations a trigger starts", () => {
  test("reads only the team's own, and only those switched on with that kind", async () => {
    const { t, salt, harbor, automation } = await setUp();
    const leader = await automation(salt, "Leader", { kind: "manual" });
    const follows = { kind: "finished" as const, automationId: leader, when: "done" as const };
    const own = await automation(salt, "Own follower", follows);
    await automation(salt, "Switched off", follows, { enabled: false });
    await automation(harbor, "Other team", follows);
    const second = await automation(
      salt,
      "Second trigger follows",
      { kind: "manual" },
      {
        moreTriggers: [{ id: "__trigger_2", trigger: follows, starts: ["trim"] }],
        multiTrigger: true,
      },
    );
    const found = await t.run((ctx) => teamEnabledWithTrigger(ctx, salt, "finished"));
    expect(found.map((each) => each._id).sort()).toEqual([own, second].sort());
  });

  test("a follower starts however many other teams' followers there are", async () => {
    const { t, salt, harbor, maya, automation } = await setUp();
    const leader = await automation(salt, "Leader", { kind: "manual" });
    const follows = { kind: "finished" as const, automationId: leader, when: "done" as const };
    // More than the old lookup read across every team before it filtered by team.
    for (let i = 0; i < 510; i++) await automation(harbor, `Other ${i}`, follows);
    const follower = await automation(salt, "Follower", follows);
    await t.run(async (ctx) => {
      const started = await startRun(ctx, (await ctx.db.get(leader))!, "manual", {}, maya.id);
      if (!started.ok) throw new Error(started.message);
    });
    const runs = await t.run((ctx) =>
      ctx.db
        .query("runs")
        .withIndex("by_automation", (q) => q.eq("automationId", follower))
        .collect(),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0].triggerKind).toBe("finished");
  });
});

describe("the watched folder check", () => {
  test("reads every watcher, page after page, each once", async () => {
    const { t, salt, maya, automation } = await setUp();
    await t.run((ctx) =>
      ctx.db.insert("toolkitConnections", {
        organizationId: salt,
        baseUrl: "https://toolkit.example",
        apiKeyCipher: "x",
        apiKeyHint: "abcd",
        status: "ok",
        buildNumber: null,
        lastCheckedAt: 0,
        lastError: null,
        storage: { bucket: "media", endpoint: null, publicUrl: null },
        createdBy: maya.id,
      }),
    );
    const folder = (prefix: string) => ({
      kind: "folder" as const,
      prefix,
      fileType: "video" as const,
    });
    // More than one page of watchers whose first trigger is a folder.
    for (let i = 0; i < 230; i++) await automation(salt, `Watcher ${i}`, folder(`in-${i}/`));
    // A folder as the second trigger, and one with a folder as both.
    await automation(
      salt,
      "Second trigger watches",
      { kind: "manual" },
      {
        moreTriggers: [{ id: "__trigger_2", trigger: folder("second/"), starts: ["trim"] }],
        multiTrigger: true,
      },
    );
    await automation(salt, "Watches twice", folder("both-a/"), {
      moreTriggers: [{ id: "__trigger_2", trigger: folder("both-b/"), starts: ["trim"] }],
      multiTrigger: true,
    });

    const prefixes: string[] = [];
    type At = { source: "first" | "several"; cursor: string | null };
    let at: At | null = { source: "first", cursor: null };
    let reads = 0;
    while (at) {
      const read: { found: { prefix: string }[]; next: At | null } = await t.query(
        internal.watch.watchers,
        at,
      );
      prefixes.push(...read.found.map((each) => each.prefix));
      at = read.next;
      reads++;
    }
    expect(reads).toBeGreaterThan(2);
    expect(prefixes).toHaveLength(233);
    expect(new Set(prefixes).size).toBe(233);
    expect(prefixes).toEqual(expect.arrayContaining(["second/", "both-a/", "both-b/", "in-229/"]));
  });
});
