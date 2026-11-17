import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { standAlone } from "./automations";
import { addPerson, addTeam, backend } from "./test.setup";

const FILE = "https://files.example/uploads/station_interview.mp4?X-Amz-Signature=abc";

const CAPTION = {
  id: "caption",
  kind: "step" as const,
  stepId: "video-caption",
  // Pointed at an earlier step's file in the editor.
  input: { video_url: "{{steps.trim.url}}" },
  position: { x: 400, y: 0 },
};

async function setUp({ toolkit = true } = {}) {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
  const automationId = await t.run(async (ctx) => {
    if (toolkit) {
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
    }
    return ctx.db.insert("automations", {
      organizationId: team,
      name: "Weekly clips",
      enabled: true,
      trigger: { kind: "upload", fileType: "video" },
      nodes: [
        { id: "trim", kind: "step", stepId: "video-trim", input: {}, position: { x: 0, y: 0 } },
        CAPTION,
      ],
      edges: [{ id: "e1", source: "trim", target: "caption" }],
      hookToken: "token",
      nextRunAt: null,
      createdBy: maya.id,
      updatedAt: Date.now(),
    });
  });
  const look = (runId: string) =>
    t.run(async (ctx) => {
      const run = await ctx.db.get(runId as Id<"runs">);
      const steps = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId as Id<"runs">))
        .collect();
      const jobs = await Promise.all(
        steps.flatMap((step) => step.jobIds).map((id) => ctx.db.get(id)),
      );
      const alerts = await ctx.db.query("alerts").collect();
      return { run, steps, jobs, alerts };
    });
  return { t, team, maya, outsider, automationId, look };
}

describe("testing one step on its own", () => {
  test("runs only that step, on the chosen file, even where it pointed at an earlier step", async () => {
    const { maya, automationId, look } = await setUp();
    const runId = await maya.as.mutation(api.automations.testStep, {
      automationId,
      node: CAPTION,
      fileUrl: FILE,
    });
    const { run, steps, jobs } = await look(runId);
    expect(run).toMatchObject({ test: "caption", triggerKind: "manual", startedBy: maya.id });
    expect(steps.map((step) => step.nodeId)).toEqual(["caption"]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ stepId: "video-caption", input: { video_url: FILE } });
    // The file is named from its address, signed links and all.
    const shown = await maya.as.query(api.runs.get, { runId });
    expect(shown?.startedWith).toBe("station_interview.mp4");
  });

  test("shows as a test in the runs list, named after the step", async () => {
    const { maya, automationId } = await setUp();
    await maya.as.mutation(api.automations.testStep, {
      automationId,
      node: CAPTION,
      fileUrl: FILE,
    });
    const [listed] = await maya.as.query(api.runs.listForAutomation, { automationId });
    expect(listed.testOf).toBe("Caption video");
  });

  test("a test that fails tells nobody, since the person testing is watching", async () => {
    const { maya, automationId, look } = await setUp({ toolkit: false });
    const runId = await maya.as.mutation(api.automations.testStep, {
      automationId,
      node: CAPTION,
      fileUrl: FILE,
    });
    const { run, alerts } = await look(runId);
    expect(run?.status).toBe("failed");
    expect(alerts).toEqual([]);
  });

  test("logic steps and people outside the team cannot test", async () => {
    const { maya, outsider, automationId } = await setUp();
    await expect(
      maya.as.mutation(api.automations.testStep, {
        automationId,
        node: { id: "w", kind: "wait", input: {}, position: { x: 0, y: 0 } },
      }),
    ).rejects.toThrow(/Only steps that do work/);
    await expect(
      outsider.as.mutation(api.automations.testStep, {
        automationId,
        node: CAPTION,
        fileUrl: FILE,
      }),
    ).rejects.toThrow();
  });

  test("a file address must be a web address", async () => {
    const { maya, automationId } = await setUp();
    await expect(
      maya.as.mutation(api.automations.testStep, {
        automationId,
        node: CAPTION,
        fileUrl: "file:///etc/passwd",
      }),
    ).rejects.toThrow(/http/);
  });
});

describe("a step's settings, made to stand alone", () => {
  test("a file from an earlier step becomes the test's file; other values from one are dropped", () => {
    expect(
      standAlone({
        video_url: "{{steps.trim.url}}",
        captions: "{{steps.transcribe.result.srt}}",
        font_size: 48,
        logo_url: "https://files.example/logo.png",
      }),
    ).toEqual({
      video_url: "{{trigger.file_url}}",
      font_size: 48,
      logo_url: "https://files.example/logo.png",
    });
  });
});
