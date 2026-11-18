import { driveDownloadUrl } from "@ncat-dash/automation-core";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const DRIVE = `https://drive.google.com/file/d/${ID}/view?usp=sharing`;

async function setUp() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const automationId = await t.run(async (ctx) => {
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
    return ctx.db.insert("automations", {
      organizationId: team,
      name: "Captions",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes: [
        {
          id: "caption",
          kind: "step",
          stepId: "video-caption",
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
  });
  return { t, team, maya, automationId };
}

describe("share links that just work", () => {
  test("a step run by hand gets the file, not Drive's preview page", async () => {
    const { t, team, maya } = await setUp();
    const jobId = await maya.as.mutation(api.jobs.run, {
      organizationId: team,
      stepId: "media-metadata",
      input: { media_url: DRIVE },
    });
    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.input).toEqual({ media_url: driveDownloadUrl(ID) });
  });

  test("a folder link is refused with a reason a person can act on", async () => {
    const { team, maya } = await setUp();
    await expect(
      maya.as.mutation(api.jobs.run, {
        organizationId: team,
        stepId: "media-metadata",
        input: { media_url: "https://www.dropbox.com/scl/fo/abc/xyz?rlkey=k&dl=0" },
      }),
    ).rejects.toThrow(/Dropbox folder/);
  });

  test("a run started with a share link works on the download link from its first step", async () => {
    const { t, maya, automationId } = await setUp();
    const runId = await maya.as.mutation(api.automations.testStep, {
      automationId,
      node: {
        id: "caption",
        kind: "step",
        stepId: "video-caption",
        input: {},
        position: { x: 0, y: 0 },
      },
      fileUrl: "https://www.dropbox.com/scl/fi/abc123/episode.mp4?rlkey=k9x&dl=0",
    });
    const { run, job } = await t.run(async (ctx) => {
      const run = await ctx.db.get(runId as Id<"runs">);
      const step = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId as Id<"runs">))
        .first();
      return { run, job: step ? await ctx.db.get(step.jobIds[0]) : null };
    });
    const fixed = "https://www.dropbox.com/scl/fi/abc123/episode.mp4?rlkey=k9x&dl=1";
    expect(run?.trigger.file_url).toBe(fixed);
    expect(job?.input.video_url).toBe(fixed);
  });

  test("a folder link in an automation fails the step and says why", async () => {
    const { t, maya, automationId } = await setUp();
    const runId = await maya.as.mutation(api.automations.testStep, {
      automationId,
      node: {
        id: "caption",
        kind: "step",
        stepId: "video-caption",
        input: {},
        position: { x: 0, y: 0 },
      },
      fileUrl: "https://drive.google.com/drive/folders/1xyzabcdefghij",
    });
    const run = await t.run((ctx) => ctx.db.get(runId as Id<"runs">));
    expect(run).toMatchObject({ status: "failed" });
    expect(run?.error).toMatch(/Google Drive folder/);
  });
});
