import { afterEach, describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { brandOf } from "./lib/queue";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit, fakeToolkitStorage } from "./test.toolkit";

let toolkit: ReturnType<typeof fakeToolkitStorage> | null = null;
afterEach(() => toolkit?.restore());

async function agency() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const owner = await addPerson(t, "Maya Ortiz", [team], "owner");
  const editor = await addPerson(t, "Dev Patel", [team], "member");
  const otherTeam = await addTeam(t, "Other Team");
  const outsider = await addPerson(t, "Someone Else", [otherTeam]);
  await owner.as.mutation(api.teamSettings.setBrand, {
    organizationId: team,
    brand: { color: "#112233", font: "Team Font" },
  });
  return { t, team, otherTeam, owner, editor, outsider };
}

async function automationFor(
  t: ReturnType<typeof backend>,
  team: string,
  by: string,
  clientId?: Id<"clients">,
) {
  return await t.run((ctx) =>
    ctx.db.insert("automations", {
      organizationId: team,
      name: "Weekly shorts",
      enabled: false,
      trigger: { kind: "manual" },
      nodes: [],
      edges: [],
      hookToken: "token",
      nextRunAt: null,
      createdBy: by,
      updatedAt: Date.now(),
      ...(clientId ? { clientId } : {}),
    }),
  );
}

describe("clients inside one team", () => {
  test("anyone on the team can add one; names are unique on the team", async () => {
    const { team, editor, outsider } = await agency();
    const acme = await editor.as.mutation(api.clients.create, {
      organizationId: team,
      name: "  Acme   Studio ",
    });
    await editor.as.mutation(api.clients.create, { organizationId: team, name: "Bright Co" });
    const list = await editor.as.query(api.clients.list, { organizationId: team });
    expect(list.map((client) => client.name)).toEqual(["Acme Studio", "Bright Co"]);
    await expect(
      editor.as.mutation(api.clients.create, { organizationId: team, name: "acme studio" }),
    ).rejects.toThrow(/already a client/);
    await expect(
      editor.as.mutation(api.clients.create, { organizationId: team, name: "   " }),
    ).rejects.toThrow(/name/);
    // Another team sees nothing and can change nothing.
    await expect(outsider.as.query(api.clients.list, { organizationId: team })).rejects.toThrow();
    expect(await outsider.as.query(api.clients.get, { clientId: acme })).toBeNull();
    await expect(
      outsider.as.mutation(api.clients.rename, { clientId: acme, name: "Mine" }),
    ).rejects.toThrow();
  });

  test("a client's own brand fills in before the team's, and only what it sets", async () => {
    const { t, team, editor } = await agency();
    const acme = await editor.as.mutation(api.clients.create, {
      organizationId: team,
      name: "Acme",
    });
    await editor.as.mutation(api.clients.setBrand, {
      clientId: acme,
      brand: { color: "#FF0000", font: "" },
    });
    const client = await editor.as.query(api.clients.get, { clientId: acme });
    expect(client?.brand).toEqual({ color: "#FF0000" });
    expect(client?.teamBrand).toMatchObject({ color: "#112233", font: "Team Font" });
    const brands = await t.run(async (ctx) => ({
      team: await brandOf(ctx, team),
      client: await brandOf(ctx, team, acme),
    }));
    expect(brands.team).toMatchObject({ color: "#112233", font: "Team Font" });
    expect(brands.client).toMatchObject({ color: "#FF0000", font: "Team Font" });
    await expect(
      editor.as.mutation(api.clients.setBrand, { clientId: acme, brand: { color: "red-ish" } }),
    ).rejects.toThrow();
  });

  test("an automation for a client starts runs that carry the client", async () => {
    const { t, team, owner, editor } = await agency();
    const acme = await editor.as.mutation(api.clients.create, {
      organizationId: team,
      name: "Acme",
    });
    const automationId = await automationFor(t, team, owner.id);
    await editor.as.mutation(api.clients.setForAutomation, { automationId, clientId: acme });
    const client = await editor.as.query(api.clients.get, { clientId: acme });
    expect(client?.automations.map((automation) => automation.name)).toEqual(["Weekly shorts"]);
    const { startRun } = await import("./lib/runner");
    const runId = await t.run(async (ctx) => {
      const automation = {
        ...(await ctx.db.get(automationId))!,
        nodes: [
          {
            id: "caps",
            kind: "step" as const,
            stepId: "video-caption",
            input: {},
            position: { x: 0, y: 0 },
          },
        ],
      };
      const started = await startRun(ctx, automation, "manual", {}, owner.id);
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.clientId).toBe(acme);
    await editor.as.mutation(api.clients.setForAutomation, { automationId, clientId: null });
    expect((await t.run((ctx) => ctx.db.get(automationId)))?.clientId).toBeUndefined();
  });

  test("an automation can only be given a client of its own team", async () => {
    const { t, team, otherTeam, owner, outsider } = await agency();
    const theirs = await outsider.as.mutation(api.clients.create, {
      organizationId: otherTeam,
      name: "Their client",
    });
    const automationId = await automationFor(t, team, owner.id);
    await expect(
      owner.as.mutation(api.clients.setForAutomation, { automationId, clientId: theirs }),
    ).rejects.toThrow(/gone/);
  });

  test("deleting a client keeps its automations and projects for the team; owners only", async () => {
    const { t, team, owner, editor } = await agency();
    const acme = await editor.as.mutation(api.clients.create, {
      organizationId: team,
      name: "Acme",
    });
    const automationId = await automationFor(t, team, owner.id, acme);
    const projectId = await editor.as.mutation(api.projects.create, {
      organizationId: team,
      name: "Episode 1",
      package: "blank",
      clientId: acme,
    });
    await expect(editor.as.mutation(api.clients.remove, { clientId: acme })).rejects.toThrow(
      /owner or admin/,
    );
    await owner.as.mutation(api.clients.remove, { clientId: acme });
    expect((await t.run((ctx) => ctx.db.get(automationId)))?.clientId).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(projectId)))?.clientId).toBeUndefined();
    expect(await owner.as.query(api.clients.list, { organizationId: team })).toEqual([]);
  });

  test("a delivery folder is checked, and Clients/<name>/ is used until one is set", async () => {
    const { team, editor } = await agency();
    const acme = await editor.as.mutation(api.clients.create, {
      organizationId: team,
      name: "Acme",
    });
    expect((await editor.as.query(api.clients.get, { clientId: acme }))?.deliversTo).toBe(
      "Clients/Acme/",
    );
    await editor.as.mutation(api.clients.setDeliveryFolder, {
      clientId: acme,
      folder: " /Deliveries/ Acme / ",
    });
    expect((await editor.as.query(api.clients.get, { clientId: acme }))?.deliversTo).toBe(
      "Deliveries/Acme/",
    );
    await expect(
      editor.as.mutation(api.clients.setDeliveryFolder, { clientId: acme, folder: "a/../b" }),
    ).rejects.toThrow();
  });
});

describe("a client's finished files", () => {
  test("go into the client's folder instead of Finished/", async () => {
    process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
    toolkit = fakeToolkitStorage();
    const { t, team, owner } = await agency();
    await connectToolkit(t, team, owner.id);
    const acme = await owner.as.mutation(api.clients.create, {
      organizationId: team,
      name: "Acme",
    });
    const automationId = await automationFor(t, team, owner.id, acme);
    const LINK = "https://r2.example/test-bucket";
    const JOB = "ca4934e3-5b1f-4c3e-9a77-0d2f1b6e8a10";
    const runId = await t.run(async (ctx) => {
      const at = { x: 0, y: 0 };
      const runId = await ctx.db.insert("runs", {
        organizationId: team,
        automationId,
        automationName: "Weekly shorts",
        status: "done",
        triggerKind: "manual",
        trigger: { file_url: `${LINK}/teams/${team}/uploads/x/space.mp4`, file_name: "space.mp4" },
        nodes: [{ id: "caps", kind: "step", stepId: "video-caption", input: {}, position: at }],
        edges: [],
        error: null,
        startedBy: null,
        finishedAt: Date.now(),
        clientId: acme,
      });
      await ctx.db.insert("runSteps", {
        runId,
        organizationId: team,
        nodeId: "caps",
        status: "done",
        jobIds: [],
        outputs: [`${LINK}/${JOB}_captioned.mp4`],
        error: null,
        startedAt: 0,
        finishedAt: 0,
      });
      return runId;
    });
    toolkit.put(`${JOB}_captioned.mp4`);
    const kept = await t.action(internal.files.keepFinished, { runId });
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatch(/^Clients\/Acme\/Weekly shorts\//);
  });
});
