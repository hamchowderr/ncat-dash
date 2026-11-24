import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit } from "./test.toolkit";

const PAGE = { numItems: 10, cursor: null };
let BUCKET = "";
const JOB = "ca4934e3-5b1f-4c3e-9a77-0d2f1b6e8a10";
const source = () => `${BUCKET}/uploads/claude-interview.mp4`;
const clip = (n: number) => `${BUCKET}/${JOB}_output_${n}.mp4`;
const captioned = (n: number) => `${BUCKET}/${JOB}${n}_captioned.mp4`;

/**
 * A team whose "Shorts" automation ran on claude-interview.mp4: Best moments cut two clips
 * for TikTok, and Add captions captioned both.
 */
async function team() {
  const t = backend();
  const teamId = await addTeam(t, "Salt House");
  BUCKET = `https://s3.example.com/media/teams/${teamId}`;
  const olu = await addPerson(t, "Olu Bello", [teamId], "owner");
  const ids = await t.run(async (ctx) => {
    const automationId = await ctx.db.insert("automations", {
      organizationId: teamId,
      name: "Shorts",
      enabled: true,
      trigger: { kind: "upload", fileType: "video" },
      nodes: [],
      edges: [],
      hookToken: "token",
      nextRunAt: null,
      createdBy: olu.id,
      updatedAt: Date.now(),
    });
    const at = { x: 0, y: 0 };
    const runId = await ctx.db.insert("runs", {
      organizationId: teamId,
      automationId,
      automationName: "Shorts",
      status: "done",
      triggerKind: "upload",
      trigger: { file_url: source(), file_name: "claude-interview.mp4" },
      nodes: [
        { id: "cut", kind: "moments", input: { platform: "TikTok" }, position: at },
        { id: "caps", kind: "step", stepId: "video-caption", input: {}, position: at },
      ],
      edges: [{ id: "e1", source: "cut", target: "caps" }],
      error: null,
      startedBy: null,
      finishedAt: Date.now(),
    });
    const base = {
      runId,
      organizationId: teamId,
      status: "done" as const,
      jobIds: [],
      error: null,
      startedAt: 0,
      finishedAt: 0,
    };
    await ctx.db.insert("runSteps", {
      ...base,
      nodeId: "cut",
      outputs: [clip(0), clip(1)],
      items: [0, 1].map((n) => ({
        url: clip(n),
        from: source(),
        source: source(),
        kind: "video" as const,
      })),
    });
    await ctx.db.insert("runSteps", {
      ...base,
      nodeId: "caps",
      outputs: [captioned(0), captioned(1)],
      items: [0, 1].map((n) => ({
        url: captioned(n),
        from: clip(n),
        source: source(),
        kind: "video" as const,
      })),
    });
    return { runId };
  });
  await connectToolkit(t, teamId, olu.id, { bucket: "media", endpoint: "https://s3.example.com" });
  return { t, teamId, olu, ...ids };
}

describe("clips say which platform they were made for", () => {
  test("the run page has each clip's platform, captioned copies too", async () => {
    const { olu, runId } = await team();
    const run = await olu.as.query(api.runs.get, { runId });
    expect(run?.outputPlatforms).toEqual({
      [clip(0)]: "TikTok",
      [clip(1)]: "TikTok",
      [captioned(0)]: "TikTok",
      [captioned(1)]: "TikTok",
    });
    // And the names say it.
    expect(run?.outputNames[captioned(1)]).toBe("Claude interview TikTok clip 2");
  });

  test("Outputs gets the same platforms", async () => {
    const { teamId, olu } = await team();
    const { page } = await olu.as.query(api.outputs.byRun, {
      organizationId: teamId,
      paginationOpts: PAGE,
    });
    expect(page[0].platforms[captioned(0)]).toBe("TikTok");
  });

  test("finished clips keep their platform in the library and in Files", async () => {
    const { t, teamId, olu, runId } = await team();
    await t.mutation(internal.library.addFinished, {
      runId,
      kept: [
        { link: captioned(0), key: "Finished/Shorts/Claude interview TikTok clip 1.mp4" },
        { link: captioned(1), key: "Finished/Shorts/Claude interview TikTok clip 2.mp4" },
      ],
    });
    const { items } = await olu.as.query(api.library.list, { organizationId: teamId });
    expect(items.map((item) => item.platform)).toEqual(["TikTok", "TikTok"]);
    expect(items.map((item) => item.title).sort()).toEqual([
      "Claude interview TikTok clip 1",
      "Claude interview TikTok clip 2",
    ]);

    const found = await t.query(internal.files.platformsAt, {
      organizationId: teamId,
      keys: [
        "Finished/Shorts/Claude interview TikTok clip 1.mp4",
        "Finished/Shorts/somebody else.mp4",
      ],
    });
    expect(found).toEqual({ "Finished/Shorts/Claude interview TikTok clip 1.mp4": "TikTok" });
  });

  test("another team's file at the same place is not looked at", async () => {
    const { t, runId } = await team();
    await t.mutation(internal.library.addFinished, {
      runId,
      kept: [{ link: captioned(0), key: "Finished/Shorts/a.mp4" }],
    });
    const other = await addTeam(t, "Pine Studio");
    expect(
      await t.query(internal.files.platformsAt, {
        organizationId: other,
        keys: ["Finished/Shorts/a.mp4"],
      }),
    ).toEqual({});
  });
});
