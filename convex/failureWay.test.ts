import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const FILE = "https://files.example/uploads/station_interview.mp4";

// trim -> thumbnail, and trim -(if it fails)-> caption
async function setUp({ fallback = true } = {}) {
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
      name: "Weekly clips",
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
        ...(fallback
          ? [
              {
                id: "caption",
                kind: "step" as const,
                stepId: "video-caption",
                // Its own look, so it does not stop to read the video's shape first.
                input: { settings: { style: "classic" } },
                position: { x: 220, y: 150 },
              },
            ]
          : []),
      ],
      edges: [
        { id: "e1", source: "trim", target: "thumbnail" },
        ...(fallback ? [{ id: "e2", source: "trim", target: "caption", branch: "failed" }] : []),
      ],
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
      const jobs = await Promise.all(
        steps.flatMap((step) => step.jobIds).map((id) => ctx.db.get(id)),
      );
      const alerts = await ctx.db.query("alerts").collect();
      return { run, byNode, jobs, alerts };
    });
  const finishJob = async (jobId: Id<"jobs">, ok: boolean, error = "FFmpeg gave up.") =>
    t.mutation(internal.jobs.finish, {
      jobId,
      ok,
      ...(ok ? { result: "https://files.example/out/done.mp4" } : { error }),
      permanent: true,
    });
  return { look, finishJob };
}

describe("a way for when a step fails", () => {
  test("when the step fails, its files go that way and the run still ends well", async () => {
    const { look, finishJob } = await setUp();
    const first = await look();
    const trimJob = first.byNode.trim.jobIds[0];
    expect(first.byNode.caption.status).toBe("pending");

    await finishJob(trimJob, false);
    const after = await look();
    expect(after.byNode.trim).toMatchObject({ status: "failed", outputs: [FILE] });
    expect(after.byNode.thumbnail.status).toBe("skipped");
    const captionJob = after.jobs.find((job) => job?.stepId === "video-caption");
    expect(captionJob?.input).toMatchObject({ video_url: FILE });

    await finishJob(captionJob!._id, true);
    const end = await look();
    expect(end.run?.status).toBe("done");
    expect(end.alerts).toEqual([]);
  });

  test("when the step works, the way for failing is passed over", async () => {
    const { look, finishJob } = await setUp();
    await finishJob((await look()).byNode.trim.jobIds[0], true);
    const after = await look();
    expect(after.byNode.caption.status).toBe("skipped");
    expect(after.byNode.thumbnail.status).toBe("running");
  });

  test("without one, a failure fails the run and tells the team", async () => {
    const { look, finishJob } = await setUp({ fallback: false });
    await finishJob((await look()).byNode.trim.jobIds[0], false);
    const end = await look();
    expect(end.run?.status).toBe("failed");
    expect(end.alerts).toHaveLength(1);
  });

  test("the alert says what went wrong in plain words; the run keeps the raw text", async () => {
    const { look, finishJob } = await setUp({ fallback: false });
    const raw = "Error: connect ECONNREFUSED 127.0.0.1:8080";
    await finishJob((await look()).byNode.trim.jobIds[0], false, raw);
    const end = await look();
    expect(end.alerts[0].message).toMatch(/^The toolkit could not be reached\./);
    expect(end.alerts[0].message).not.toContain("ECONNREFUSED");
    expect(end.byNode.trim.error).toBe(raw);
  });
});
