import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";

async function setUp() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Maya Ortiz", [team], "owner");
  const otherTeam = await addTeam(t, "Far Away");
  const stranger = await addPerson(t, "Ana Cruz", [otherTeam], "owner");
  const make = (starterId: string, name = "") =>
    owner.as.mutation(api.automations.create, { organizationId: team, name, starterId });
  return { t, team, owner, stranger, make };
}

describe("the chain view", () => {
  test("shows every linked automation, laid out by what starts what, with its last run", async () => {
    const { t, team, owner, make } = await setUp();
    const clips = await make("social-clips");
    const brand = await make("brand-every-clip");
    const lonely = await make("podcast-master");
    const runId = await t.run((ctx) =>
      ctx.db.insert("runs", {
        organizationId: team,
        automationId: clips,
        automationName: "Clips for social",
        status: "done",
        triggerKind: "manual",
        trigger: {},
        nodes: [],
        edges: [],
        error: null,
        startedBy: null,
        finishedAt: Date.now(),
      }),
    );

    const view = await owner.as.query(api.automations.chainView, { automationId: brand });
    expect(view.columns).toEqual([[clips], [brand]]);
    expect(view.links).toEqual([{ from: clips, to: brand, how: "done" }]);
    expect(view.automations.map((each) => each.automationId)).toEqual([clips, brand]);
    expect(view.automations[0].lastRun).toMatchObject({ runId, status: "done" });
    expect(view.automations[1].lastRun).toBeNull();
    expect(view.automations[1].trigger).toMatchObject({ kind: "finished", automationId: clips });
    // Ready To Post goes well after Brand Every Clip and is not set up yet.
    expect(view.automations[1].suggestions).toContain("ready-to-post");
    // Brand Every Clip is already set up after the clips, so it is not suggested again.
    expect(view.automations[0].suggestions).not.toContain("brand-every-clip");

    const alone = await owner.as.query(api.automations.chainView, { automationId: lonely });
    expect(alone.columns).toEqual([[lonely]]);
    expect(alone.links).toEqual([]);
  });

  test("is only for the team's own members", async () => {
    const { stranger, make } = await setUp();
    const clips: Id<"automations"> = await make("social-clips");
    await expect(
      stranger.as.query(api.automations.chainView, { automationId: clips }),
    ).rejects.toThrow();
  });
});
