import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/crypto";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const TOOLKIT = "https://toolkit.example";
const AGENT_URL = "https://agent.example";
const SHEET = "https://files.example/out/sheet.png";
const SAMPLE = "https://files.example/signed/cafe-sample.mp4";

const LOOK_ANSWER = JSON.stringify({
  fill: "blur",
  brightness: 0,
  contrast: 1.2,
  saturation: 1.3,
  warmth: 0.4,
  captions: {
    effect: "highlight",
    position: "middle",
    size: "large",
    bold: true,
    all_caps: true,
    words_per_line: 3,
    text_color: "#FFFFFF",
    word_color: "#22DD88",
    outline_color: "#000000",
  },
  notes: "Warm and punchy, over a blurred copy of itself.",
});

type Sent = { url: string; body: Record<string, unknown> };

/** A stand-in toolkit that answers each job at once, and a stand-in agent server. */
function fakeServers(answer: unknown = { answer: LOOK_ANSWER }, sheetFails = false) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      sent.push({ url, body });
      const done = (response: unknown) =>
        new Response(JSON.stringify({ code: 200, response }), { status: 200 });
      if (url.endsWith("/v1/storage/sign")) return done({ url: SAMPLE });
      if (url.endsWith("/v1/ffmpeg/compose")) {
        if (sheetFails) return new Response("no frames", { status: 400 });
        const output = (body.outputs as { options: { argument?: unknown }[] }[])[0].options;
        const isSheet = output.some((one) => one.argument === "image2");
        return done([{ file_url: isSheet ? SHEET : "https://files.example/out/looked.mp4" }]);
      }
      if (url.endsWith("/v1/media/look"))
        return done({ media: { duration: 30, cuts: [3, 6, 9, 12, 15, 18, 21, 24, 27] } });
      if (url === `${AGENT_URL}/ncat/look`) {
        return new Response(JSON.stringify(answer), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }),
  );
  return sent;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.AGENT_URL;
  delete process.env.MASTRA_JWT_SECRET;
});

async function settled(t: ReturnType<typeof backend>, seconds = 30) {
  for (let second = 0; second < seconds; second++) {
    vi.advanceTimersByTime(1000);
    await t.finishInProgressScheduledFunctions();
  }
}

async function setUp() {
  process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
  process.env.CONVEX_SITE_URL = "https://dash.example";
  process.env.AGENT_URL = AGENT_URL;
  process.env.MASTRA_JWT_SECRET = "a-shared-secret-for-the-agent-server";
  const apiKeyCipher = await encryptSecret("toolkit-key");
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const ines = await addPerson(t, "Ines Duarte", [team], "owner");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const uploadId = await t.run(async (ctx) => {
    await ctx.db.insert("toolkitConnections", {
      organizationId: team,
      baseUrl: TOOLKIT,
      apiKeyCipher,
      apiKeyHint: "abcd",
      status: "ok",
      buildNumber: null,
      lastCheckedAt: 0,
      lastError: null,
      createdBy: ines.id,
      storage: { bucket: "media", endpoint: null, publicUrl: null },
    });
    return await ctx.db.insert("uploads", {
      organizationId: team,
      key: "uploads/abc/cafe-sample.mp4",
      fileName: "Cafe sample.mp4",
      contentType: "video/mp4",
      size: 1000,
      status: "ready",
      createdBy: ines.id,
      details: { duration: 30, width: 1080, height: 1920, hasVideo: true },
    });
  });
  return { t, team, ines, maya, uploadId };
}

describe("copying a look from a sample", () => {
  test("takes a sheet of frames and the cuts, asks the model once, and waits to be saved", async () => {
    const sent = fakeServers();
    const { t, team, ines, uploadId } = await setUp();
    await ines.as.mutation(api.looks.study, { organizationId: team, uploadId });
    let shown = await ines.as.query(api.looks.list, { organizationId: team });
    expect(shown.study).toMatchObject({ status: "working", sourceName: "Cafe sample.mp4" });
    await settled(t);

    const sheet = sent.find((one) => one.url.endsWith("/v1/ffmpeg/compose"))!;
    expect((sheet.body.inputs as { file_url: string }[])[0].file_url).toBe(SAMPLE);
    expect(JSON.stringify(sheet.body.filters)).toContain("scale=360:-2,tile=3x2");
    const asked = sent.filter((one) => one.url === `${AGENT_URL}/ncat/look`);
    expect(asked).toHaveLength(1);
    expect(asked[0].body).toMatchObject({
      sheet: SHEET,
      name: "Cafe sample.mp4",
      width: 1080,
      height: 1920,
      duration: 30,
      shotSeconds: 3,
      organizationId: team,
    });

    shown = await ines.as.query(api.looks.list, { organizationId: team });
    expect(shown.study).toMatchObject({
      status: "ready",
      sheetUrl: SHEET,
      summary:
        "Vertical, a blurred copy behind, punchier, more vivid, warmer, a new shot every 3 seconds",
    });
    expect(shown.study?.proposal?.captions).toMatchObject({
      position: "middle_center",
      word_color: "#22DD88",
    });
  });

  test("saving names the look and keeps its captions as a caption style for its shape", async () => {
    fakeServers();
    const { t, team, ines, uploadId } = await setUp();
    await ines.as.mutation(api.looks.study, { organizationId: team, uploadId });
    await settled(t);
    const { study } = await ines.as.query(api.looks.list, { organizationId: team });
    await ines.as.mutation(api.looks.save, {
      organizationId: team,
      studyId: study!._id,
      name: " Cafe Reels ",
      captionsForShape: true,
    });

    const shown = await ines.as.query(api.looks.list, { organizationId: team });
    expect(shown.study).toBeNull();
    expect(shown.looks).toHaveLength(1);
    expect(shown.looks[0]).toMatchObject({
      name: "Cafe Reels",
      captionStyle: "Cafe Reels",
      shotSeconds: 3,
      sourceName: "Cafe sample.mp4",
      frame: { shape: "vertical", fill: "blur", contrast: 1.2, saturation: 1.3, warmth: 0.4 },
    });
    const captions = await t.run(
      async (ctx) => (await ctx.db.query("teamSettings").first())?.captions,
    );
    expect(captions?.styles.map((style) => style.name)).toEqual(["Cafe Reels"]);
    expect(captions?.byShape).toEqual({ vertical: "Cafe Reels" });

    await expect(
      ines.as.mutation(api.looks.save, {
        organizationId: team,
        studyId: study!._id,
        name: "Again",
      }),
    ).rejects.toThrow("This study is no longer waiting to be saved.");
  });

  test("a second look with a taken name is refused, and removing a look keeps its captions", async () => {
    fakeServers();
    const { t, team, ines, uploadId } = await setUp();
    for (const name of ["Cafe Reels", "cafe reels"]) {
      await ines.as.mutation(api.looks.study, { organizationId: team, uploadId });
      await settled(t);
      const { study } = await ines.as.query(api.looks.list, { organizationId: team });
      const saving = ines.as.mutation(api.looks.save, {
        organizationId: team,
        studyId: study!._id,
        name,
      });
      if (name === "Cafe Reels") await saving;
      else await expect(saving).rejects.toThrow("There is already a look called");
    }
    const { looks } = await ines.as.query(api.looks.list, { organizationId: team });
    await ines.as.mutation(api.looks.remove, { organizationId: team, lookId: looks[0]._id });
    expect((await ines.as.query(api.looks.list, { organizationId: team })).looks).toEqual([]);
    const styles = await t.run(
      async (ctx) => (await ctx.db.query("teamSettings").first())?.captions?.styles,
    );
    expect(styles?.map((style) => style.name)).toEqual(["Cafe Reels"]);
  });

  test("says plainly when the frames cannot be taken, and never asks the model", async () => {
    const sent = fakeServers(undefined, true);
    const { t, team, ines, uploadId } = await setUp();
    await ines.as.mutation(api.looks.study, { organizationId: team, uploadId });
    await settled(t);
    const { study } = await ines.as.query(api.looks.list, { organizationId: team });
    expect(study?.status).toBe("failed");
    expect(study?.error).toMatch(
      /^The toolkit could not take frames from the video: The toolkit refused the job/,
    );
    expect(sent.some((one) => one.url.startsWith(AGENT_URL))).toBe(false);
  });

  test("says plainly when the agent's answer cannot be read", async () => {
    fakeServers({ answer: "I could not tell." });
    const { t, team, ines, uploadId } = await setUp();
    await ines.as.mutation(api.looks.study, { organizationId: team, uploadId });
    await settled(t);
    const { study } = await ines.as.query(api.looks.list, { organizationId: team });
    expect(study).toMatchObject({
      status: "failed",
      error: "The agent's answer could not be read. Study the video again.",
    });
  });

  test("only owners and admins can study, save or remove, and only videos are studied", async () => {
    fakeServers();
    const { t, team, maya, ines, uploadId } = await setUp();
    await expect(
      maya.as.mutation(api.looks.study, { organizationId: team, uploadId }),
    ).rejects.toThrow("Only a team owner or admin can do this.");
    const audio = await t.run(async (ctx) =>
      ctx.db.insert("uploads", {
        organizationId: team,
        key: "uploads/x/voice.mp3",
        fileName: "voice.mp3",
        contentType: "audio/mpeg",
        size: 10,
        status: "ready",
        createdBy: ines.id,
        details: { duration: 10, hasVideo: false },
      }),
    );
    await expect(
      ines.as.mutation(api.looks.study, { organizationId: team, uploadId: audio }),
    ).rejects.toThrow("Pick a video. A look is copied from moving pictures.");
  });
});

describe("Match A Saved Look in a run", () => {
  test("puts the video into the saved look by name, with plain FFmpeg and no AI", async () => {
    const sent = fakeServers();
    const { t, team, ines } = await setUp();
    const automationId = await t.run(async (ctx) => {
      await ctx.db.insert("teamLooks", {
        organizationId: team,
        name: "Square Bars",
        frame: {
          shape: "square",
          fill: "bars",
          brightness: 0,
          contrast: 1,
          saturation: 1,
          warmth: 0,
        },
        notes: "",
        sourceName: "x.mp4",
        createdBy: ines.id,
        at: 0,
      });
      return await ctx.db.insert("automations", {
        organizationId: team,
        name: "Into the look",
        enabled: true,
        trigger: { kind: "webhook" },
        nodes: [
          {
            id: "look",
            kind: "step",
            stepId: "recipe-saved-look",
            input: { look: "square bars" },
            position: { x: 0, y: 0 },
          },
        ] as never,
        edges: [],
        hookToken: "token",
        nextRunAt: null,
        createdBy: ines.id,
        updatedAt: Date.now(),
      });
    });
    const runId = await t.run(async (ctx) => {
      const automation = (await ctx.db.get(automationId))!;
      const started = await startRun(
        ctx,
        automation,
        "webhook",
        { file_url: "https://files.example/in.mp4" },
        ines.id,
      );
      if (!started.ok) throw new Error(started.message);
      return started.runId as Id<"runs">;
    });
    await settled(t);
    const compose = sent.find((one) => one.url.endsWith("/v1/ffmpeg/compose"))!;
    expect((compose.body.filters as { filter: string }[])[0].filter).toBe(
      "[0:v]scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p[v]",
    );
    expect(sent.some((one) => one.url.startsWith(AGENT_URL))).toBe(false);
    const run = await ines.as.query(api.runs.get, { runId });
    expect(run?.status).toBe("done");
  });

  test("a run names a look the team does not have: the step says so", async () => {
    fakeServers();
    const { t, team, ines } = await setUp();
    const automationId = await t.run(async (ctx) =>
      ctx.db.insert("automations", {
        organizationId: team,
        name: "Into the look",
        enabled: true,
        trigger: { kind: "webhook" },
        nodes: [
          {
            id: "look",
            kind: "step",
            stepId: "recipe-saved-look",
            input: { look: "Gone" },
            position: { x: 0, y: 0 },
          },
        ] as never,
        edges: [],
        hookToken: "token",
        nextRunAt: null,
        createdBy: ines.id,
        updatedAt: Date.now(),
      }),
    );
    const runId = await t.run(async (ctx) => {
      const started = await startRun(
        ctx,
        (await ctx.db.get(automationId))!,
        "webhook",
        { file_url: "https://files.example/in.mp4" },
        ines.id,
      );
      if (!started.ok) throw new Error(started.message);
      return started.runId as Id<"runs">;
    });
    await settled(t);
    const run = await ines.as.query(api.runs.get, { runId });
    expect(JSON.stringify(run)).toContain('There is no saved look called \\"Gone\\".');
  });
});

describe("Match A Saved Look on the Steps page", () => {
  test("a job run by hand gets the team's first look when none is named", async () => {
    const sent = fakeServers();
    const { t, team, ines } = await setUp();
    await t.run(async (ctx) => {
      await ctx.db.insert("teamLooks", {
        organizationId: team,
        name: "Wide Warm",
        frame: {
          shape: "wide",
          fill: "crop",
          brightness: 0,
          contrast: 1,
          saturation: 1,
          warmth: 1,
        },
        notes: "",
        sourceName: "x.mp4",
        createdBy: ines.id,
        at: 0,
      });
    });
    await ines.as.mutation(api.jobs.run, {
      organizationId: team,
      stepId: "recipe-saved-look",
      input: { video_url: "https://files.example/in.mp4", look: "" },
    });
    await settled(t);
    const compose = sent.find((one) => one.url.endsWith("/v1/ffmpeg/compose"))!;
    expect((compose.body.filters as { filter: string }[])[0].filter).toBe(
      "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,colorbalance=rm=0.15:bm=-0.15,setsar=1,format=yuv420p[v]",
    );
  });
});

describe("the agent's brief", () => {
  test("names the team's saved looks, so the agent can pick one in the step", async () => {
    fakeServers();
    const { t, team, ines, maya } = await setUp();
    await t.run(async (ctx) => {
      await ctx.db.insert("teamLooks", {
        organizationId: team,
        name: "Cafe Reels",
        frame: {
          shape: "vertical",
          fill: "blur",
          brightness: 0,
          contrast: 1.2,
          saturation: 1,
          warmth: 0,
        },
        shotSeconds: 2.5,
        notes: "",
        sourceName: "x.mp4",
        createdBy: ines.id,
        at: 0,
      });
    });
    const brief = await maya.as.query(api.teamSettings.agentBrief, { organizationId: team });
    expect(brief.text).toContain(
      "- Cafe Reels: Vertical, a blurred copy behind, punchier, a new shot every 2.5 seconds",
    );
  });
});
