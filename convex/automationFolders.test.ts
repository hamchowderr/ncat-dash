import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";

async function team() {
  const t = backend();
  const org = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [org], "member");
  const other = await addTeam(t, "Other Team");
  const outsider = await addPerson(t, "Someone Else", [other]);
  const automationId = await t.run((ctx) =>
    ctx.db.insert("automations", {
      organizationId: org,
      name: "Weekly shorts",
      enabled: false,
      trigger: { kind: "manual" },
      nodes: [],
      edges: [],
      hookToken: "token",
      nextRunAt: null,
      createdBy: "someone",
      updatedAt: Date.now(),
    }),
  );
  return { t, org, other, maya, outsider, automationId };
}

describe("folders on the Automations page", () => {
  test("anyone on the team makes one, names are unique, and it counts what is in it", async () => {
    const { org, maya, automationId } = await team();
    const shorts = await maya.as.mutation(api.automationFolders.create, {
      organizationId: org,
      name: "  Shorts  ",
    });
    await expect(
      maya.as.mutation(api.automationFolders.create, { organizationId: org, name: "shorts" }),
    ).rejects.toThrow(/already a folder called/);
    await expect(
      maya.as.mutation(api.automationFolders.create, { organizationId: org, name: "  " }),
    ).rejects.toThrow(/Give the folder a name/);

    await maya.as.mutation(api.automationFolders.moveAutomation, {
      automationId,
      folderId: shorts,
    });
    const [folder] = await maya.as.query(api.automationFolders.list, { organizationId: org });
    expect(folder).toMatchObject({ name: "Shorts", count: 1 });
    const [automation] = await maya.as.query(api.automations.list, { organizationId: org });
    expect(automation.folderId).toBe(shorts);

    await maya.as.mutation(api.automationFolders.rename, { folderId: shorts, name: "Reels" });
    expect(
      (await maya.as.query(api.automationFolders.list, { organizationId: org })).map((f) => f.name),
    ).toEqual(["Reels"]);
  });

  test("deleting a folder keeps its automations, back on the main list", async () => {
    const { org, maya, automationId } = await team();
    const shorts = await maya.as.mutation(api.automationFolders.create, {
      organizationId: org,
      name: "Shorts",
    });
    await maya.as.mutation(api.automationFolders.moveAutomation, {
      automationId,
      folderId: shorts,
    });
    await maya.as.mutation(api.automationFolders.remove, { folderId: shorts });
    expect(await maya.as.query(api.automationFolders.list, { organizationId: org })).toEqual([]);
    const [automation] = await maya.as.query(api.automations.list, { organizationId: org });
    expect(automation).toMatchObject({ name: "Weekly shorts", folderId: null });
  });

  test("another team cannot see, use or change a team's folders", async () => {
    const { org, other, maya, outsider, automationId } = await team();
    const shorts = await maya.as.mutation(api.automationFolders.create, {
      organizationId: org,
      name: "Shorts",
    });
    await expect(
      outsider.as.query(api.automationFolders.list, { organizationId: org }),
    ).rejects.toThrow();
    await expect(
      outsider.as.mutation(api.automationFolders.rename, { folderId: shorts, name: "Mine" }),
    ).rejects.toThrow();
    await expect(
      outsider.as.mutation(api.automationFolders.moveAutomation, { automationId, folderId: null }),
    ).rejects.toThrow();
    const theirs = await outsider.as.mutation(api.automationFolders.create, {
      organizationId: other,
      name: "Theirs",
    });
    await expect(
      maya.as.mutation(api.automationFolders.moveAutomation, { automationId, folderId: theirs }),
    ).rejects.toThrow(/That folder is gone/);
  });
});
