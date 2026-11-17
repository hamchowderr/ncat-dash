import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";

const PAGE = { numItems: 10, cursor: null };
const SOURCE = "https://files.example/uploads/podcast%20episode%2012.mp4";
const clip = (n: number) => `https://files.example/out/clip-${n}.mp4`;
const captioned = (n: number) => `https://files.example/out/clip-${n}-captioned.mp4`;

/**
 * A team with two automations. "Shorts" ran on an upload: clips for TikTok, then captions,
 * then an approval that hands the captioned files on. "Audio" ran on a schedule and made
 * nothing. One step was also run by hand on the Steps page.
 */
async function team() {
  const t = backend();
  const teamId = await addTeam(t, "Salt House");
  const olu = await addPerson(t, "Olu Bello", [teamId], "owner");
  const stranger = await addPerson(t, "Sam Stone", [await addTeam(t, "Elsewhere")]);
  const ids = await t.run(async (ctx) => {
    const automation = (name: string) =>
      ctx.db.insert("automations", {
        organizationId: teamId,
        name,
        enabled: true,
        trigger: { kind: "upload", fileType: "video" },
        nodes: [],
        edges: [],
        hookToken: "token",
        nextRunAt: null,
        createdBy: olu.id,
        updatedAt: Date.now(),
      });
    const shorts = await automation("Shorts");
    const audio = await automation("Audio");
    const at = { x: 0, y: 0 };
    const shortsRun = await ctx.db.insert("runs", {
      organizationId: teamId,
      automationId: shorts,
      automationName: "Shorts",
      status: "done",
      triggerKind: "upload",
      trigger: { file_url: SOURCE, file_name: "podcast episode 12.mp4" },
      nodes: [
        {
          id: "cut",
          kind: "clips",
          input: { platform: "TikTok" },
          label: "TikTok clips",
          position: at,
        },
        { id: "caps", kind: "step", stepId: "video-caption", input: {}, position: at },
        { id: "ok", kind: "approval", input: {}, position: at },
      ],
      edges: [
        { id: "e1", source: "cut", target: "caps" },
        { id: "e2", source: "caps", target: "ok" },
      ],
      error: null,
      startedBy: null,
      finishedAt: Date.now(),
    });
    const step = (runId: Id<"runs">, nodeId: string, outputs: string[]) =>
      ctx.db.insert("runSteps", {
        runId,
        organizationId: teamId,
        nodeId,
        status: "done",
        jobIds: [],
        outputs,
        error: null,
        startedAt: 0,
        finishedAt: 0,
      });
    await step(shortsRun, "cut", [clip(1), clip(2)]);
    await step(shortsRun, "caps", [captioned(1), captioned(2)]);
    await step(shortsRun, "ok", [captioned(1), captioned(2)]);
    await ctx.db.insert("runs", {
      organizationId: teamId,
      automationId: audio,
      automationName: "Audio",
      status: "failed",
      triggerKind: "schedule",
      trigger: {},
      nodes: [],
      edges: [],
      error: "The toolkit could not be reached.",
      startedBy: null,
      finishedAt: Date.now(),
    });
    const connectionId = await ctx.db.insert("toolkitConnections", {
      organizationId: teamId,
      baseUrl: "http://toolkit.example",
      apiKeyCipher: "x",
      apiKeyHint: "1234",
      status: "ok",
      buildNumber: null,
      lastCheckedAt: 0,
      lastError: null,
      createdBy: olu.id,
    });
    const job = (outputs: string[], runStepId?: Id<"runSteps">) =>
      ctx.db.insert("jobs", {
        organizationId: teamId,
        connectionId,
        stepId: "media-convert-mp3",
        input: {},
        status: "done",
        webhookToken: "w",
        toolkitJobId: null,
        outputs,
        error: null,
        createdBy: olu.id,
        startedAt: 0,
        finishedAt: 1_700_000_000_000,
        ...(runStepId ? { runStepId } : {}),
      });
    await job(["https://files.example/out/episode.mp3"]);
    const inRun = await step(shortsRun, "unused", []);
    await job([clip(1)], inRun);
    return { shorts, audio, shortsRun };
  });
  return { t, teamId, olu, stranger, ...ids };
}

describe("Outputs by run", () => {
  test("shows each run's files under the step that made them, finished ones first", async () => {
    const { teamId, olu, shorts, shortsRun } = await team();
    const { page } = await olu.as.query(api.outputs.byRun, {
      organizationId: teamId,
      paginationOpts: PAGE,
    });
    // The schedule run made nothing, so it is left out.
    expect(page).toHaveLength(1);
    const [run] = page;
    expect(run).toMatchObject({
      runId: shortsRun,
      automationId: shorts,
      automationName: "Shorts",
      triggerKind: "upload",
      test: false,
      startedWith: "podcast episode 12.mp4",
    });
    // The approval hands the captioned clips on; they count once, under Caption video.
    expect(run.finished).toEqual([
      {
        nodeId: "caps",
        kind: "step",
        stepId: "video-caption",
        label: null,
        files: [captioned(1), captioned(2)],
      },
    ]);
    expect(run.along).toEqual([
      {
        nodeId: "cut",
        kind: "clips",
        stepId: null,
        label: "TikTok clips",
        files: [clip(1), clip(2)],
      },
    ]);
  });

  test("shows one automation's runs when asked", async () => {
    const { teamId, olu, audio, shorts } = await team();
    const only = (automationId: Id<"automations">) =>
      olu.as.query(api.outputs.byRun, {
        organizationId: teamId,
        automationId,
        paginationOpts: PAGE,
      });
    expect((await only(shorts)).page).toHaveLength(1);
    expect((await only(audio)).page).toEqual([]);
  });

  test("is closed to people outside the team", async () => {
    const { t, teamId, stranger } = await team();
    await expect(
      stranger.as.query(api.outputs.byRun, { organizationId: teamId, paginationOpts: PAGE }),
    ).rejects.toThrow();
    await expect(
      t.query(api.outputs.byRun, { organizationId: teamId, paginationOpts: PAGE }),
    ).rejects.toThrow();
  });
});

describe("Outputs of steps run by hand", () => {
  test("lists only jobs run outside any automation", async () => {
    const { teamId, olu } = await team();
    const { page } = await olu.as.query(api.outputs.byHand, {
      organizationId: teamId,
      paginationOpts: PAGE,
    });
    expect(page).toEqual([
      expect.objectContaining({
        stepId: "media-convert-mp3",
        urls: ["https://files.example/out/episode.mp3"],
      }),
    ]);
  });

  test("is closed to people outside the team", async () => {
    const { teamId, stranger } = await team();
    await expect(
      stranger.as.query(api.outputs.byHand, { organizationId: teamId, paginationOpts: PAGE }),
    ).rejects.toThrow();
  });
});
