import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const FILE = "https://files.example/uploads/station_interview.mp4";

/**
 * Two branches from one file (`parallel`), or one step after another. One of them fails.
 */
async function setUp(shape: "parallel" | "chain") {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const runId = await t.run(async (ctx) => {
    await ctx.db.insert("toolkitConnections", {
      organizationId: team,
      baseUrl: "https://toolkit.example",
      apiKeyCipher: "x",
      apiKeyHint: "abcd",
      status: "ok",
      buildNumber: null,
      lastCheckedAt: 0,
      lastError: null,
      createdBy: maya.id,
    });
    const automationId = await ctx.db.insert("automations", {
      organizationId: team,
      name: "Clips for two platforms",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes: [
        {
          id: "trim",
          kind: "step",
          stepId: "video-trim",
          input: { start: "00:00:05" },
          position: { x: 0, y: 0 },
        },
        {
          id: "thumbnail",
          kind: "step",
          stepId: "video-thumbnail",
          input: {},
          position: { x: 220, y: 0 },
        },
      ],
      edges: shape === "chain" ? [{ id: "e1", source: "trim", target: "thumbnail" }] : [],
      hookToken: "token",
      nextRunAt: null,
      createdBy: maya.id,
      updatedAt: Date.now(),
    });
    const automation = (await ctx.db.get(automationId))!;
    const started = await startRun(ctx, automation, "webhook", { file_url: FILE }, maya.id);
    if (!started.ok) throw new Error(started.message);
    return started.runId;
  });
  const look = () =>
    t.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      const steps = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect();
      const byNode = Object.fromEntries(steps.map((step) => [step.nodeId, step]));
      const alerts = await ctx.db.query("alerts").collect();
      return { run, byNode, alerts };
    });
  const finishJob = async (jobId: Id<"jobs">, ok: boolean) =>
    t.mutation(internal.jobs.finish, {
      jobId,
      ok,
      ...(ok ? { result: "https://files.example/out/thumb.png" } : { error: "FFmpeg gave up." }),
      permanent: true,
    });
  return { t, maya, runId, look, finishJob };
}

describe("a run where one branch fails and another finishes", () => {
  test("it shows as partly done and the team hears the rest is in Files", async () => {
    const { maya, runId, look, finishJob } = await setUp("parallel");
    const first = await look();
    await finishJob(first.byNode.thumbnail.jobIds[0], true);
    await finishJob(first.byNode.trim.jobIds[0], false);

    const end = await look();
    expect(end.run).toMatchObject({ status: "failed", partly: true });
    expect(end.alerts).toHaveLength(1);
    expect(end.alerts[0].message).toContain(
      "The rest of the run finished, and what it made is in Files.",
    );
    // The run page and the lists say so too.
    const shown = await maya.as.query(api.runs.get, { runId });
    expect(shown).toMatchObject({ status: "failed", partly: true });
  });

  test("a step that only fed the failed one is not counted as finished", async () => {
    const { maya, runId, look, finishJob } = await setUp("chain");
    await finishJob((await look()).byNode.trim.jobIds[0], true);
    await finishJob((await look()).byNode.thumbnail.jobIds[0], false);

    const end = await look();
    expect(end.run?.status).toBe("failed");
    expect(end.run?.partly).toBeUndefined();
    expect(end.alerts[0].message).not.toContain("The rest of the run finished");
    expect(await maya.as.query(api.runs.get, { runId })).toMatchObject({ partly: false });
  });

  test("a run where every branch fails is not partly done", async () => {
    const { look, finishJob } = await setUp("parallel");
    const first = await look();
    await finishJob(first.byNode.thumbnail.jobIds[0], false);
    await finishJob(first.byNode.trim.jobIds[0], false);
    expect((await look()).run?.partly).toBeUndefined();
  });
});
