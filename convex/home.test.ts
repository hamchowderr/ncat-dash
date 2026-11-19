import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";

/**
 * A team with two automations, one switched on, and runs that are done, failed and
 * waiting, plus a test of one step. Rows made in a test are all from "now", so this week.
 */
async function team() {
  const t = backend();
  const teamId = await addTeam(t, "Salt House");
  const olu = await addPerson(t, "Olu Bello", [teamId], "owner");
  const stranger = await addPerson(t, "Sam Stone", [await addTeam(t, "Elsewhere")]);
  await t.run(async (ctx) => {
    const automation = (name: string, enabled: boolean) =>
      ctx.db.insert("automations", {
        organizationId: teamId,
        name,
        enabled,
        trigger: { kind: "upload", fileType: "video" },
        nodes: [],
        edges: [],
        hookToken: "token",
        nextRunAt: null,
        createdBy: olu.id,
        updatedAt: Date.now(),
      });
    const shorts = await automation("Shorts", true);
    await automation("Audio", false);
    const run = (
      status: "done" | "failed" | "waiting",
      extra: { test?: string; error?: string; file?: string } = {},
    ) =>
      ctx.db.insert("runs", {
        organizationId: teamId,
        automationId: shorts,
        automationName: "Shorts",
        status,
        triggerKind: "upload",
        trigger: extra.file ? { file_name: extra.file } : {},
        nodes: [],
        edges: [],
        error: extra.error ?? null,
        startedBy: null,
        finishedAt: status === "waiting" ? null : Date.now(),
        ...(extra.test ? { test: extra.test } : {}),
      });
    await run("done");
    await run("failed", { error: "An earlier failure." });
    await run("done", { file: "episode 12.mp4" });
    await run("failed", { error: "The toolkit did not answer." });
    await run("waiting");
    await run("failed", { test: "caption_1", error: "test failure" });
  });
  return { t, teamId, olu, stranger };
}

describe("the home summary", () => {
  test("counts the week's runs and leaves out tests of one step", async () => {
    const { teamId, olu } = await team();
    const summary = await olu.as.query(api.home.summary, { organizationId: teamId });
    expect(summary.week).toEqual({ runs: 5, done: 2, failed: 2, going: 1 });
    expect(summary.recentRuns).toHaveLength(5);
    expect(summary.recentRuns.every((run) => run.automationName === "Shorts")).toBe(true);
    expect(summary.recentRuns.map((run) => run.error)).not.toContain("test failure");
    expect(summary.recentRuns.find((run) => run.startedWith)?.startedWith).toBe("episode 12.mp4");
    expect(summary.failures.map((run) => run.error)).toEqual([
      "The toolkit did not answer.",
      "An earlier failure.",
    ]);
    expect(summary.automations).toEqual({ total: 2, on: 1 });
  });

  test("tracks how far the team is through setting up", async () => {
    const { t, teamId, olu } = await team();
    const before = await olu.as.query(api.home.summary, { organizationId: teamId });
    expect(before.setup).toEqual({
      toolkit: false,
      bucket: false,
      brand: false,
      automationOn: true,
      firstRun: true,
      goals: false,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("toolkitConnections", {
        organizationId: teamId,
        baseUrl: "https://toolkit.example",
        apiKeyCipher: "x",
        apiKeyHint: "1234",
        status: "ok",
        buildNumber: "204",
        lastCheckedAt: Date.now(),
        lastError: null,
        storage: { bucket: "media", endpoint: null, publicUrl: null },
        createdBy: olu.id,
      });
      await ctx.db.insert("teamSettings", {
        organizationId: teamId,
        maxParallelJobs: 2,
        brand: { logo: "upload:abc" },
      });
    });
    const after = await olu.as.query(api.home.summary, { organizationId: teamId });
    expect(after.setup).toMatchObject({ toolkit: true, bucket: true, brand: true });
  });

  test("is only for the team's own members", async () => {
    const { teamId, stranger } = await team();
    await expect(stranger.as.query(api.home.summary, { organizationId: teamId })).rejects.toThrow();
  });
});
