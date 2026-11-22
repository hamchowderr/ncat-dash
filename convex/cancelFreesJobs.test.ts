import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { encryptSecret } from "./lib/crypto";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const FILE = "https://files.example/uploads/station_interview.mp4";
const TOOLKIT = "https://toolkit.example";

afterEach(() => {
  vi.unstubAllGlobals();
});

// Found by the speed test (dash-60v): Follow the speaker hung on the toolkit, the run was
// stopped, and its jobs kept the team's three slots for six hours.
describe("stopping a run", () => {
  test("ends the jobs the toolkit already has, so the team's next run can start", async () => {
    process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
    process.env.CONVEX_SITE_URL = "https://dash.example";
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ code: 202, job_id: "tk" }), { status: 202 }),
    );
    const apiKeyCipher = await encryptSecret("toolkit-key");
    const t = backend();
    const team = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [team]);
    const { stuck, next } = await t.run(async (ctx) => {
      await ctx.db.insert("toolkitConnections", {
        organizationId: team,
        baseUrl: TOOLKIT,
        apiKeyCipher,
        apiKeyHint: "abcd",
        status: "ok",
        buildNumber: null,
        lastCheckedAt: 0,
        lastError: null,
        createdBy: maya.id,
      });
      const automationId = await ctx.db.insert("automations", {
        organizationId: team,
        name: "Follow",
        enabled: true,
        trigger: { kind: "webhook" },
        nodes: [
          {
            id: "thumb",
            kind: "step",
            stepId: "video-thumbnail",
            input: {},
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
        hookToken: "token",
        nextRunAt: null,
        createdBy: maya.id,
        updatedAt: Date.now(),
      });
      const automation = (await ctx.db.get(automationId))!;
      const runs = [];
      for (let i = 0; i < 4; i++) {
        const started = await startRun(ctx, automation, "webhook", { file_url: FILE }, maya.id);
        if (!started.ok) throw new Error(started.message);
        runs.push(started.runId);
      }
      return { stuck: runs.slice(0, 3), next: runs[3] };
    });
    const jobOf = (runId: (typeof stuck)[number]) =>
      t.run(async (ctx) => {
        const step = await ctx.db
          .query("runSteps")
          .withIndex("by_run", (q) => q.eq("runId", runId))
          .first();
        return (await ctx.db.get(step!.jobIds[0]))!;
      });
    // Three jobs fill the team's three slots and the toolkit has them; the fourth waits.
    for (const runId of stuck) {
      const job = await jobOf(runId);
      await t.run((ctx) =>
        ctx.db.patch(job._id, { status: "running", toolkitJobId: "tk", dispatchedAt: Date.now() }),
      );
    }
    const waiting = await jobOf(next);
    await t.run((ctx) => ctx.db.patch(waiting._id, { dispatchedAt: undefined }));

    for (const runId of stuck) await maya.as.mutation(api.runs.cancel, { runId });

    for (const runId of stuck) {
      const job = await jobOf(runId);
      expect(job.status).toBe("failed");
      expect(job.error).toMatch(/stopped while the toolkit worked on this job/);
    }
    // The slots are free, so the waiting job is sent.
    expect((await jobOf(next)).dispatchedAt).toBeDefined();

    // A result that turns up later for a stopped job changes nothing.
    const late = await jobOf(stuck[0]);
    const answer = await t.mutation(internal.jobs.finish, {
      jobId: late._id,
      token: late.webhookToken,
      ok: true,
      result: "https://files.example/out.jpg",
    });
    expect(answer).toBe("ignored");
    expect((await jobOf(stuck[0])).status).toBe("failed");
  });
});
