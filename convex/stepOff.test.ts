import { describe, expect, test } from "vitest";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const FILE = "https://files.example/uploads/station_interview.mp4";

describe("a step that is turned off", () => {
  test("does no work and hands its files straight to the next step", async () => {
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
            off: true,
            input: { video_url: "{{trigger.file_url}}", start: "00:00:05" },
            position: { x: 0, y: 0 },
          },
          {
            id: "caption",
            kind: "step",
            stepId: "video-caption",
            // Its own look, so it does not stop to read the video's shape first.
            input: { video_url: "{{steps.trim.url}}", settings: { style: "classic" } },
            position: { x: 220, y: 0 },
          },
        ],
        edges: [{ id: "e1", source: "trim", target: "caption" }],
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

    const { steps, jobs } = await t.run(async (ctx) => {
      const steps = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect();
      const jobs = await Promise.all(
        steps.flatMap((step) => step.jobIds).map((id) => ctx.db.get(id)),
      );
      return { steps, jobs };
    });
    const trim = steps.find((step) => step.nodeId === "trim")!;
    expect(trim).toMatchObject({ status: "done", jobIds: [], outputs: [FILE] });
    expect(jobs).toHaveLength(1);
    // Captions start with the timed words for the video (see burn-captions.ts).
    expect(jobs[0]).toMatchObject({ stepId: "media-generate-ass", input: { media_url: FILE } });
  });
});
