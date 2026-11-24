import { afterEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit, fakeToolkitStorage } from "./test.toolkit";

/**
 * Many teams can share one toolkit, and so one bucket (Otaku's hosted toolkit does). Each
 * team works inside its own folder, teams/<id>/, and never sees or reaches another's.
 */
let toolkit: ReturnType<typeof fakeToolkitStorage> | null = null;
afterEach(() => {
  toolkit?.restore();
  vi.useRealTimers();
});

const LINK = "https://r2.example/test-bucket";
const JOB = "ca4934e3-5b1f-4c3e-9a77-0d2f1b6e8a10";

async function twoTeamsOneToolkit() {
  process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
  toolkit = fakeToolkitStorage();
  const t = backend();
  const salt = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [salt], "owner");
  const pine = await addTeam(t, "Pine Studio");
  const olu = await addPerson(t, "Olu Bello", [pine], "owner");
  await connectToolkit(t, salt, maya.id);
  await connectToolkit(t, pine, olu.id);
  return { t, salt, maya, pine, olu, toolkit };
}

describe("two teams on one toolkit", () => {
  test("each team's uploads go into its own folder", async () => {
    const { t, salt, maya, pine, olu, toolkit } = await twoTeamsOneToolkit();
    const upload = async (as: typeof maya, team: string) => {
      const { uploadId } = await as.as.action(api.storage.startUpload, {
        organizationId: team,
        fileName: "talk.mp4",
        contentType: "video/mp4",
        size: 5000,
      });
      return (await t.run((ctx) => ctx.db.get(uploadId)))!.key;
    };
    await upload(maya, salt);
    await upload(olu, pine);
    const signed = toolkit.calls.filter((call) => call.request === "sign");
    expect(signed.map((call) => String(call.body.key).split("/").slice(0, 2).join("/"))).toEqual([
      `teams/${salt}`,
      `teams/${pine}`,
    ]);
  });

  test("Files shows a team only its own folder", async () => {
    const { salt, maya, pine, toolkit } = await twoTeamsOneToolkit();
    toolkit.put(`teams/${salt}/shows/ep1.mp4`);
    toolkit.put(`teams/${salt}/top.mp4`);
    toolkit.put(`teams/${pine}/secret.mp4`);
    toolkit.put(`teams/${pine}/private/`);
    toolkit.put(`${JOB}_output_0.mp4`);

    const top = await maya.as.action(api.files.list, { organizationId: salt, prefix: "" });
    expect(top.folders.map((folder) => folder.key)).toEqual(["shows/"]);
    expect(top.files.map((file) => file.key)).toEqual(["top.mp4"]);
    // Every request names a key inside the team's folder.
    for (const call of toolkit.calls) {
      const key = String(call.body.prefix ?? call.body.key ?? "");
      expect(key.startsWith(`teams/${salt}/`)).toBe(true);
    }
  });

  test("a key from another team only ever names a file inside this team's folder", async () => {
    const { salt, maya, pine, toolkit } = await twoTeamsOneToolkit();
    toolkit.put(`teams/${pine}/secret.mp4`);
    const link = await maya.as.action(api.files.linkFor, {
      organizationId: salt,
      key: `teams/${pine}/secret.mp4`,
      use: "view",
    });
    expect(new URL(link).pathname).toBe(`/test-bucket/teams/${salt}/teams/${pine}/secret.mp4`);

    await maya.as.action(api.files.remove, {
      organizationId: salt,
      keys: [`teams/${pine}/secret.mp4`],
    });
    expect(toolkit.files.has(`teams/${pine}/secret.mp4`)).toBe(true);
  });

  test("a team makes folders and folders inside them, all inside its own folder", async () => {
    const { salt, maya, toolkit } = await twoTeamsOneToolkit();
    const shows = await maya.as.action(api.files.createFolder, {
      organizationId: salt,
      prefix: "",
      name: "Shows",
    });
    const raw = await maya.as.action(api.files.createFolder, {
      organizationId: salt,
      prefix: shows,
      name: "Raw",
    });
    expect([shows, raw]).toEqual(["Shows/", "Shows/Raw/"]);
    expect(toolkit.files.has(`teams/${salt}/Shows/Raw/`)).toBe(true);
    toolkit.put(`teams/${salt}/talk.mp4`);
    await maya.as.action(api.files.move, {
      organizationId: salt,
      keys: ["talk.mp4"],
      toFolder: raw,
    });
    expect(toolkit.files.has(`teams/${salt}/Shows/Raw/talk.mp4`)).toBe(true);
    const inside = await maya.as.action(api.files.folders, { organizationId: salt, prefix: shows });
    expect(inside.map((folder) => folder.key)).toEqual(["Shows/Raw/"]);
  });

  test("a team cannot use another team's toolkit connection", async () => {
    const { salt, olu } = await twoTeamsOneToolkit();
    await expect(
      olu.as.action(api.files.list, { organizationId: salt, prefix: "" }),
    ).rejects.toThrow();
  });
});

describe("the team's folder", () => {
  test("is made when the toolkit is connected, and older uploads move into it", async () => {
    process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
    toolkit = fakeToolkitStorage();
    const t = backend();
    const salt = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [salt], "owner");
    // From before teams had folders: the upload's key was read from the top of the bucket.
    const old = `uploads/${salt}/1234/talk.mp4`;
    toolkit.put(old);
    await t.run((ctx) =>
      ctx.db.insert("uploads", {
        organizationId: salt,
        key: old,
        fileName: "talk.mp4",
        contentType: "video/mp4",
        size: 1000,
        status: "ready",
        createdBy: maya.id,
      }),
    );

    vi.useFakeTimers();
    const result = await maya.as.action(api.toolkitConnections.connect, {
      organizationId: salt,
      baseUrl: toolkit.baseUrl,
      apiKey: "toolkit-key",
    });
    expect(result.ok).toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(toolkit.files.has(`teams/${salt}/`)).toBe(true);
    expect(toolkit.files.has(`teams/${salt}/${old}`)).toBe(true);
    expect(toolkit.files.has(old)).toBe(false);
    // The record keeps its key, which now reads from inside the team's folder.
    const uploads = await t.run((ctx) => ctx.db.query("uploads").collect());
    expect(uploads.map((upload) => upload.key)).toEqual([old]);

    // Running it again changes nothing.
    expect(await t.action(internal.files.settleTeamFolder, { organizationId: salt })).toEqual({
      moved: 0,
      leftBehind: 0,
    });
  });
});

describe("a finished run's files", () => {
  async function finishedRun() {
    const teams = await twoTeamsOneToolkit();
    const { t, salt, maya } = teams;
    const runId = await t.run(async (ctx) => {
      const automationId = await ctx.db.insert("automations", {
        organizationId: salt,
        name: "Shorts",
        enabled: true,
        trigger: { kind: "upload", fileType: "video" },
        nodes: [],
        edges: [],
        hookToken: "token",
        nextRunAt: null,
        createdBy: maya.id,
        updatedAt: Date.now(),
      });
      const at = { x: 0, y: 0 };
      const runId = await ctx.db.insert("runs", {
        organizationId: salt,
        automationId,
        automationName: "Shorts",
        status: "done",
        triggerKind: "upload",
        trigger: { file_url: `${LINK}/teams/${salt}/uploads/x/space.mp4`, file_name: "space.mp4" },
        nodes: [
          { id: "cut", kind: "step", stepId: "video-split", input: {}, position: at },
          { id: "caps", kind: "step", stepId: "video-caption", input: {}, position: at },
        ],
        edges: [{ id: "e1", source: "cut", target: "caps" }],
        error: null,
        startedBy: null,
        finishedAt: Date.now(),
      });
      const step = (nodeId: string, outputs: string[]) =>
        ctx.db.insert("runSteps", {
          runId,
          organizationId: salt,
          nodeId,
          status: "done",
          jobIds: [],
          outputs,
          error: null,
          startedAt: 0,
          finishedAt: 0,
        });
      await step("cut", [`${LINK}/${JOB}_output_0.mp4`]);
      await step("caps", [`${LINK}/${JOB}_captioned.mp4`]);
      return runId;
    });
    teams.toolkit.put(`${JOB}_output_0.mp4`);
    teams.toolkit.put(`${JOB}_captioned.mp4`);
    return { ...teams, runId };
  }

  test("are copied into the team's folder with readable names", async () => {
    const { t, salt, runId, toolkit } = await finishedRun();
    const kept = await t.action(internal.files.keepFinished, { runId });
    expect(kept).toEqual(["Finished/Shorts/Space captioned.mp4"]);
    expect(toolkit.files.has(`teams/${salt}/Finished/Shorts/Space captioned.mp4`)).toBe(true);
    // Only the run's finished files, not the ones made on the way.
    expect([...toolkit.files.keys()].filter((key) => key.includes("output_0"))).toEqual([
      `${JOB}_output_0.mp4`,
    ]);
    // The run keeps its own links, and the original stays where the toolkit put it.
    expect(toolkit.files.has(`${JOB}_captioned.mp4`)).toBe(true);
    const steps = await t.run((ctx) => ctx.db.query("runSteps").collect());
    expect(steps.find((step) => step.nodeId === "caps")?.outputs).toEqual([
      `${LINK}/${JOB}_captioned.mp4`,
    ]);
  });

  test("a second run of the same automation does not overwrite the first's files", async () => {
    const { t, salt, runId, toolkit } = await finishedRun();
    await t.action(internal.files.keepFinished, { runId });
    const again = await t.action(internal.files.keepFinished, { runId });
    expect(again).toEqual(["Finished/Shorts/Space captioned (2).mp4"]);
    expect(toolkit.files.has(`teams/${salt}/Finished/Shorts/Space captioned.mp4`)).toBe(true);
  });

  test("a run that did not finish keeps nothing", async () => {
    const { t, runId } = await finishedRun();
    await t.run((ctx) => ctx.db.patch(runId, { status: "failed" }));
    expect(await t.action(internal.files.keepFinished, { runId })).toEqual([]);
  });

  test("links to another team's folder are not followed when a file is renamed", async () => {
    const { t, salt, pine, runId } = await finishedRun();
    const theirs = `${LINK}/teams/${pine}/talk.mp4`;
    await t.run((ctx) => ctx.db.patch(runId, { trigger: { file_url: theirs } }));
    await t.mutation(internal.files.followLinks, {
      organizationId: salt,
      moves: [{ from: "talk.mp4", to: "renamed.mp4" }],
      folders: [],
    });
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect((run?.trigger as { file_url: string }).file_url).toBe(theirs);
  });
});
