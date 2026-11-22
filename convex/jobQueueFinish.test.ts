import { describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";

// Found when Google Meet recordings came in four at a time and each was then sent to be
// transcribed: recording a job's result also read the team's whole queue to send the next
// job, so it clashed with every job being added at that moment, and after Convex's retries
// one result was lost and its upload stayed "on its way". A result is now recorded on its
// own, and the queue is moved on by a separate mutation.
describe("a job's result", () => {
  async function team() {
    const t = backend();
    const organizationId = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [organizationId]);
    const ids = await t.run(async (ctx) => {
      const connectionId = await ctx.db.insert("toolkitConnections", {
        organizationId,
        baseUrl: "https://toolkit.example",
        apiKeyCipher: "x",
        apiKeyHint: "abcd",
        status: "ok",
        buildNumber: null,
        lastCheckedAt: 0,
        lastError: null,
        createdBy: maya.id,
      });
      await ctx.db.insert("teamSettings", { organizationId, maxParallelJobs: 1 });
      const job = (status: "running" | "queued", extra: Record<string, unknown> = {}) =>
        ctx.db.insert("jobs", {
          organizationId,
          connectionId,
          stepId: "media-metadata",
          input: { media_url: "https://files.example/a.mp4" },
          status,
          webhookToken: "token",
          toolkitJobId: null,
          outputs: [],
          error: null,
          createdBy: maya.id,
          startedAt: null,
          finishedAt: null,
          ...extra,
        });
      return {
        running: await job("running", { dispatchedAt: 1 }),
        waiting: await job("queued"),
      };
    });
    const dispatched = (jobId: Id<"jobs">) =>
      t.run(async (ctx) => (await ctx.db.get(jobId))!.dispatchedAt);
    return { t, ...ids, dispatched };
  }

  test("is recorded without touching the team's waiting jobs", async () => {
    // A fake clock holds back the scheduled queue move, so only the result's own writes show.
    vi.useFakeTimers();
    try {
      const { t, running, waiting, dispatched } = await team();
      expect(
        await t.mutation(internal.jobs.finish, { jobId: running, ok: true, result: "done" }),
      ).toBe("recorded");
      expect(await dispatched(waiting)).not.toBeTypeOf("number");
      const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
      expect(scheduled.map((one) => one.name)).toContain("jobs:pumpTeam");
    } finally {
      vi.useRealTimers();
    }
  });

  test("then frees its slot for the next waiting job", async () => {
    vi.useFakeTimers();
    try {
      const { t, running, waiting, dispatched } = await team();
      await t.mutation(internal.jobs.finish, { jobId: running, ok: true, result: "done" });
      // Only the queue's own mutation; sending to the toolkit is left out of this test.
      await t.mutation(internal.jobs.pumpTeam, {
        organizationId: (await t.run((ctx) => ctx.db.get(running)))!.organizationId,
      });
      expect(await dispatched(waiting)).toBeTypeOf("number");
    } finally {
      vi.useRealTimers();
    }
  });
});
