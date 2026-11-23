import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/crypto";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const FILE = "https://files.example/uploads/station_interview.mp4";

afterEach(() => vi.unstubAllGlobals());

describe("a step that joins two sides", () => {
  test("waits for both, then runs once with the files from both", async () => {
    // The toolkit takes every job it is sent and reports later.
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ code: 202, job_id: "tk-1" }), { status: 202 }),
    );
    process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
    const apiKeyCipher = await encryptSecret("toolkit-key");
    const t = backend();
    const team = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [team]);
    const runId = await t.run(async (ctx) => {
      await ctx.db.insert("toolkitConnections", {
        organizationId: team,
        baseUrl: "https://toolkit.example",
        apiKeyCipher,
        apiKeyHint: "abcd",
        status: "ok",
        buildNumber: null,
        lastCheckedAt: 0,
        lastError: null,
        createdBy: maya.id,
      });
      const step = (id: string, stepId: string, x: number, y: number) => ({
        id,
        kind: "step" as const,
        stepId,
        input: {},
        position: { x, y },
      });
      const automationId = await ctx.db.insert("automations", {
        organizationId: team,
        name: "Intro and talk",
        enabled: true,
        trigger: { kind: "webhook" },
        nodes: [
          step("intro", "video-trim", 0, 0),
          step("talk", "video-trim", 0, 150),
          step("join", "video-concatenate", 220, 75),
        ],
        edges: [
          { id: "e1", source: "intro", target: "join" },
          { id: "e2", source: "talk", target: "join" },
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
        const steps = await ctx.db
          .query("runSteps")
          .withIndex("by_run", (q) => q.eq("runId", runId))
          .collect();
        const byNode = Object.fromEntries(steps.map((step) => [step.nodeId, step]));
        const jobs = await Promise.all(
          steps.flatMap((step) => step.jobIds).map((id) => ctx.db.get(id)),
        );
        return { byNode, jobs };
      });
    const finish = (jobId: Id<"jobs">, url: string) =>
      t.mutation(internal.jobs.finish, { jobId, ok: true, result: url });

    const first = await look();
    await finish(first.byNode.intro.jobIds[0], "https://files.example/out/intro.mp4");
    expect((await look()).byNode.join.status).toBe("pending");

    await finish(first.byNode.talk.jobIds[0], "https://files.example/out/talk.mp4");
    const after = await look();
    expect(after.byNode.join.status).toBe("running");
    const joins = after.jobs.filter((job) => job?.stepId === "video-concatenate");
    expect(joins).toHaveLength(1);
    expect(JSON.stringify(joins[0]?.input)).toContain("intro.mp4");
    expect(JSON.stringify(joins[0]?.input)).toContain("talk.mp4");
  });
});
