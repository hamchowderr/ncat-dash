import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";

/**
 * The agent has no access of its own: its tools call these functions with the signed-in
 * person's token. So what the agent can see and change is exactly what these allow.
 */
async function studio() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
  return { t, team, maya, outsider };
}

describe("the step list the agent reads", () => {
  test("is one line per kind of trigger and step", async () => {
    const { maya } = await studio();
    const { index, type } = await maya.as.query(api.automations.nodeTypes, {});
    expect(type).toBeUndefined();
    expect(index).toContain("trigger:upload");
    expect(index).toContain("step:video-caption");
    expect(index).toContain("approval");
  });

  test("gives one kind in full, with the settings it accepts", async () => {
    const { maya } = await studio();
    const { index, type } = await maya.as.query(api.automations.nodeTypes, { type: "clips" });
    expect(index).toBeUndefined();
    expect(type?.title).toBe("Clips for a platform");
    expect(type?.settings.required).toEqual(["platform"]);
  });

  test("says so when there is no such kind", async () => {
    const { maya } = await studio();
    await expect(
      maya.as.query(api.automations.nodeTypes, { type: "step:does-not-exist" }),
    ).rejects.toThrow(/no step type/);
  });

  test("is closed to visitors", async () => {
    const { t } = await studio();
    await expect(t.query(api.automations.nodeTypes, {})).rejects.toThrow(/Sign in/);
  });
});

describe("what the agent does as a person on the team", () => {
  test("makes an automation, builds it, reads it back and finds it in the list", async () => {
    const { maya, team } = await studio();
    const automationId = await maya.as.mutation(api.automations.create, {
      organizationId: team,
      name: "Clips from new recordings",
    });
    const built = await maya.as.mutation(api.automations.change, {
      automationId,
      operations: [
        { op: "trigger", trigger: { kind: "upload", fileType: "video" } },
        { op: "add", type: "clips", id: "clips", settings: { platform: "Instagram Reels" } },
        { op: "add", type: "approval", id: "approve", after: "clips" },
        { op: "tidy" },
      ],
    });
    expect(built.problems).toEqual([]);
    expect(built.enabled).toBe(false);

    const read = await maya.as.query(api.automations.describe, { automationId });
    expect(read.outline).toContain("clips");
    expect(read.outline).toContain("approve");

    const list = await maya.as.query(api.automations.list, { organizationId: team });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Clips from new recordings", enabled: false });
  });

  test("a change that cannot be made saves nothing", async () => {
    const { maya, team } = await studio();
    const automationId = await maya.as.mutation(api.automations.create, {
      organizationId: team,
      name: "Half built",
    });
    await expect(
      maya.as.mutation(api.automations.change, {
        automationId,
        operations: [
          { op: "add", type: "approval", id: "approve" },
          { op: "add", type: "step:does-not-exist" },
        ],
      }),
    ).rejects.toThrow();
    const read = await maya.as.query(api.automations.describe, { automationId });
    expect(read.outline).not.toContain("approve");
  });
});

describe("what the agent cannot do for someone outside the team", () => {
  test("see, make, read, change or switch on the team's automations", async () => {
    const { maya, outsider, team } = await studio();
    const automationId = await maya.as.mutation(api.automations.create, {
      organizationId: team,
      name: "Private",
    });
    await expect(
      outsider.as.query(api.automations.list, { organizationId: team }),
    ).rejects.toThrow();
    await expect(
      outsider.as.mutation(api.automations.create, { organizationId: team, name: "Sneaky" }),
    ).rejects.toThrow();
    await expect(outsider.as.query(api.automations.describe, { automationId })).rejects.toThrow();
    await expect(
      outsider.as.mutation(api.automations.change, {
        automationId,
        operations: [{ op: "name", name: "Taken over" }],
      }),
    ).rejects.toThrow();
    await expect(
      outsider.as.mutation(api.automations.setEnabled, { automationId, enabled: true }),
    ).rejects.toThrow();
    const read = await maya.as.query(api.automations.describe, { automationId });
    expect(read.outline).toContain("Private");
  });
});
