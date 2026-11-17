import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";

const WAIT = {
  id: "wait_1",
  kind: "wait" as const,
  input: { amount: 5, unit: "minutes" },
  position: { x: 300, y: 0 },
};
const APPROVAL = {
  id: "approval_1",
  kind: "approval" as const,
  input: {},
  position: { x: 600, y: 0 },
};

async function studio() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const dev = await addPerson(t, "Dev Patel", [team]);
  const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
  const automationId = await maya.as.mutation(api.automations.create, {
    organizationId: team,
    name: "Weekly clips",
  });
  return { t, team, maya, dev, outsider, automationId };
}

type Studio = Awaited<ReturnType<typeof studio>>;

/** Saves the canvas as the given person, with these steps. */
async function save(
  who: Studio["maya"],
  automationId: Id<"automations">,
  nodes: (typeof WAIT | typeof APPROVAL)[],
  name = "Weekly clips",
) {
  const edges =
    nodes.length === 2 ? [{ id: "wait_1>approval_1", source: "wait_1", target: "approval_1" }] : [];
  return await who.as.mutation(api.automations.save, {
    automationId,
    name,
    trigger: { kind: "manual" },
    nodes,
    edges,
  });
}

describe("keeping versions", () => {
  test("a new automation starts at version 1, made by the person who made it", async () => {
    const { maya, automationId } = await studio();
    const listed = await maya.as.query(api.versions.list, { automationId });
    expect(listed?.hasDraft).toBe(false);
    expect(listed?.versions).toMatchObject([
      { number: 1, source: "created", byName: "Maya Ortiz", changes: [], live: true },
    ]);
  });

  test("each save of a switched-off automation is a new version that says what changed", async () => {
    const { maya, dev, automationId } = await studio();
    await save(maya, automationId, [WAIT]);
    await save(dev, automationId, [WAIT, APPROVAL], "Weekly clips for review");
    const { versions } = (await maya.as.query(api.versions.list, { automationId }))!;
    expect(versions.map((version) => version.number)).toEqual([3, 2, 1]);
    expect(versions[0]).toMatchObject({ byName: "Dev Patel", source: "saved", live: true });
    expect(versions[0].changes).toEqual(['Renamed to "Weekly clips for review"', "Added Approval"]);
    expect(versions[1]).toMatchObject({ changes: ["Added Wait"], live: false });
  });

  test("moving steps around or saving the same thing again adds nothing", async () => {
    const { maya, automationId } = await studio();
    await save(maya, automationId, [WAIT]);
    await save(maya, automationId, [{ ...WAIT, position: { x: 900, y: 120 } }]);
    await save(maya, automationId, [{ ...WAIT, position: { x: 900, y: 120 } }]);
    const { versions } = (await maya.as.query(api.versions.list, { automationId }))!;
    expect(versions).toHaveLength(2);
  });

  test("an imported automation starts at version 1, marked as imported", async () => {
    const { maya, team, automationId } = await studio();
    await save(maya, automationId, [WAIT]);
    const { file } = await maya.as.query(api.automations.exportFile, { automationId });
    const imported = await maya.as.mutation(api.automations.importFile, {
      organizationId: team,
      file,
    });
    const { versions } = (await maya.as.query(api.versions.list, {
      automationId: imported.automationId,
    }))!;
    expect(versions).toMatchObject([{ number: 1, source: "imported", live: true }]);
  });

  test("keeps the newest 100", async () => {
    const { maya, automationId } = await studio();
    for (let i = 0; i < 101; i++) {
      await save(maya, automationId, [{ ...WAIT, input: { amount: i + 1, unit: "minutes" } }]);
    }
    const { versions } = (await maya.as.query(api.versions.list, { automationId }))!;
    expect(versions).toHaveLength(100);
    expect(versions[0].number).toBe(102);
    expect(versions.at(-1)?.number).toBe(3);
  });
});

describe("bringing a version back", () => {
  test("makes it the draft, and the live version runs until it is published", async () => {
    const { maya, automationId } = await studio();
    await save(maya, automationId, [WAIT]);
    await save(maya, automationId, [WAIT, APPROVAL]);
    const before = (await maya.as.query(api.versions.list, { automationId }))!.versions;
    const second = before.find((version) => version.number === 2)!;

    const shown = await maya.as.query(api.versions.get, { versionId: second._id });
    expect(shown?.nodes.map((node) => node.id)).toEqual(["wait_1"]);

    expect(await maya.as.mutation(api.versions.restore, { versionId: second._id })).toEqual({
      draft: true,
    });
    const automation = await maya.as.query(api.automations.get, { automationId });
    expect(automation?.nodes.map((node) => node.id)).toEqual(["wait_1"]);
    expect(automation?.live?.nodes.map((node) => node.id)).toEqual(["wait_1", "approval_1"]);
    expect(automation?.restoredFrom).toBe(2);
    const listed = (await maya.as.query(api.versions.list, { automationId }))!;
    expect(listed.hasDraft).toBe(true);
    expect(listed.versions[0]).toMatchObject({ number: 3, live: true });

    await maya.as.mutation(api.automations.publish, { automationId });
    const after = (await maya.as.query(api.versions.list, { automationId }))!.versions;
    expect(after[0]).toMatchObject({
      number: 4,
      source: "published",
      restoredFrom: 2,
      changes: ["Removed Approval"],
      live: true,
    });
  });

  test("still says where a restored draft came from after more edits", async () => {
    const { maya, automationId } = await studio();
    await save(maya, automationId, [WAIT]);
    await save(maya, automationId, [WAIT, APPROVAL]);
    const first = (await maya.as.query(api.versions.list, { automationId }))!.versions.at(-1)!;
    await maya.as.mutation(api.versions.restore, { versionId: first._id });
    await save(maya, automationId, [WAIT], "Weekly clips, rebuilt");
    await maya.as.mutation(api.automations.publish, { automationId });
    const newest = (await maya.as.query(api.versions.list, { automationId }))!.versions[0];
    expect(newest).toMatchObject({ number: 4, restoredFrom: 1 });
  });

  test("the live version cannot be brought back, but doing so throws a draft away", async () => {
    const { maya, automationId } = await studio();
    await save(maya, automationId, [WAIT]);
    const [live, first] = (await maya.as.query(api.versions.list, { automationId }))!.versions;
    await expect(maya.as.mutation(api.versions.restore, { versionId: live._id })).rejects.toThrow(
      /already the live version/,
    );
    await maya.as.mutation(api.versions.restore, { versionId: first._id });
    expect(await maya.as.mutation(api.versions.restore, { versionId: live._id })).toEqual({
      draft: false,
    });
    const automation = await maya.as.query(api.automations.get, { automationId });
    expect(automation?.live).toBeNull();
    expect(automation?.nodes.map((node) => node.id)).toEqual(["wait_1"]);
  });
});

describe("who can see and use versions", () => {
  test("is closed to people outside the team", async () => {
    const { maya, outsider, automationId } = await studio();
    const [version] = (await maya.as.query(api.versions.list, { automationId }))!.versions;
    expect(await outsider.as.query(api.versions.list, { automationId })).toBeNull();
    expect(await outsider.as.query(api.versions.get, { versionId: version._id })).toBeNull();
    await expect(
      outsider.as.mutation(api.versions.restore, { versionId: version._id }),
    ).rejects.toThrow();
  });

  test("goes with the automation when it is deleted", async () => {
    const { t, maya, automationId } = await studio();
    await save(maya, automationId, [WAIT]);
    await maya.as.mutation(api.automations.remove, { automationId });
    const left = await t.run((ctx) => ctx.db.query("automationVersions").collect());
    expect(left).toEqual([]);
  });
});
