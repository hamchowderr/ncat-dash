import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { wordAlert } from "./lib/chatAlerts";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit, fakeToolkitStorage } from "./test.toolkit";

/**
 * Check Footage, before editing: every take of a creator's folder is measured by the
 * toolkit (FFmpeg only), plain rules decide what is wrong, the team is told in the bell
 * and their chat apps, a note goes in the creator's folder, and the run stops before the
 * editing steps, or carries on when the step is set to only tell.
 */

const FILES = "https://files.example/ugc";
const GOOD = {
  duration: 24,
  has_video: true,
  has_audio: true,
  width: 1080,
  height: 1920,
  fps: 30,
  checked_seconds: 24,
  black: [],
  frozen: [],
  loudness_lufs: -18,
  peak_db: -2,
  peak_count: 1,
  samples: 1_000_000,
};
// What the stand-in toolkit measures, by file name.
const MEASURED: Record<string, unknown> = {
  "body.mp4": GOOD,
  "hook 1.mp4": { ...GOOD, duration: 3 },
  "hook 2.mp4": { ...GOOD, duration: 3, width: 1920, height: 1080, loudness_lufs: -50 },
  "cta 1.mp4": { ...GOOD, duration: 4, black: [{ start: 0, end: 2.5 }] },
};

type Sent = { url: string; body: Record<string, unknown> };
let sent: Sent[] = [];
// An older toolkit, without the footage check.
let oldToolkit = false;
let toolkit: ReturnType<typeof fakeToolkitStorage> | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  oldToolkit = false;
  // The toolkit's measuring and editing requests; its storage is the fake bucket below.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      sent.push({ url, body });
      const done = (response: unknown) =>
        new Response(JSON.stringify({ code: 200, response }), { status: 200 });
      if (url.endsWith("/v1/media/check") && oldToolkit) {
        return new Response("<h1>Not Found</h1>", { status: 404 });
      }
      if (url.endsWith("/v1/media/check")) {
        const name = decodeURIComponent(String(body.media_url).split("/").pop() ?? "");
        const measured = MEASURED[name];
        if (!measured) return new Response("no such file", { status: 500 });
        return done(measured);
      }
      if (url.endsWith("/v1/video/thumbnail")) return done(`${FILES}/still.jpg`);
      return new Response("not found", { status: 404 });
    }),
  );
  toolkit = fakeToolkitStorage();
});

afterEach(() => {
  toolkit?.restore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function settled(t: ReturnType<typeof backend>) {
  for (let second = 0; second < 60; second++) {
    vi.advanceTimersByTime(1000);
    await t.finishInProgressScheduledFunctions();
  }
}

const take = (name: string, folder: string) => ({
  file_url: `${FILES}/Maya/${folder}/${encodeURIComponent(name)}`,
  file_name: name,
});

async function setUp(check: Record<string, unknown> = {}) {
  process.env.CONVEX_SITE_URL = "https://dash.example";
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  await connectToolkit(t, team, maya.id);
  const automationId = await t.run((ctx) =>
    ctx.db.insert("automations", {
      organizationId: team,
      name: "UGC Ads",
      enabled: true,
      trigger: { kind: "folder", prefix: "ugc/", fileType: "video", layout: "creators" },
      nodes: [
        { id: "check_1", kind: "footage-check", input: check, position: { x: 0, y: 0 } },
        {
          id: "still",
          kind: "step",
          stepId: "video-thumbnail",
          input: {},
          position: { x: 300, y: 0 },
        },
      ],
      edges: [{ id: "check_1>still", source: "check_1", target: "still" }],
      hookToken: "token",
      nextRunAt: null,
      createdBy: maya.id,
      updatedAt: Date.now(),
    }),
  );
  /** Starts a run the way a creator's settled folder does. */
  const start = (hooks: string[], endings: string[] = []) =>
    t.run(async (ctx) => {
      const automation = (await ctx.db.get(automationId))!;
      const started = await startRun(
        ctx,
        automation,
        "folder",
        {
          ...take("body.mp4", "body"),
          key: "ugc/Maya/body/body.mp4",
          size: 1000,
          creator: "Maya",
          hooks: hooks.map((name) => take(name, "hooks")),
          endings: endings.map((name) => take(name, "endings")),
        },
        null,
      );
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });
  const runOf = (runId: Id<"runs">) => maya.as.query(api.runs.get, { runId });
  /** No more tries for a failed job, so a test need not wait them out. */
  const noRetries = () =>
    t.run((ctx) =>
      ctx.db.insert("teamSettings", { organizationId: team, maxParallelJobs: 4, stepRetries: 0 }),
    );
  const alerts = () => t.run((ctx) => ctx.db.query("alerts").collect()) as Promise<Doc<"alerts">[]>;
  return { t, team, start, runOf, alerts, noRetries };
}

describe("Check Footage", () => {
  test("good takes pass and editing goes on, with nothing to tell", async () => {
    const { t, team, start, runOf, alerts } = await setUp();
    const runId = await start(["hook 1.mp4"]);
    await settled(t);

    const run = (await runOf(runId))!;
    expect(run.status).toBe("done");
    const check = run.steps.find((one) => one.nodeId === "check_1")!;
    expect(check.status).toBe("done");
    expect(check.footage).toMatchObject({ stopped: false, creator: "Maya" });
    expect(check.footage!.files.map((file) => [file.name, file.role, file.problems])).toEqual([
      ["body.mp4", "body", []],
      ["hook 1.mp4", "hook", []],
    ]);
    // Each take was measured once, reading up to 20 minutes of it.
    const checks = sent.filter((one) => one.url.endsWith("/v1/media/check"));
    expect(checks).toHaveLength(2);
    expect(checks[0].body).toMatchObject({ max_seconds: 1200 });
    // The editing step got the body.
    expect(run.steps.find((one) => one.nodeId === "still")!.status).toBe("done");
    expect(await alerts()).toEqual([]);
    // The creator's folder says every file passed.
    const note = toolkit!.texts.get(`teams/${team}/ugc/Maya/Footage check.txt`);
    expect(note).toContain("Every file passed: body.mp4, hook 1.mp4.");
  });

  test("a bad take stops the run before editing, tells the team and leaves a note", async () => {
    const { t, team, start, runOf, alerts } = await setUp();
    const runId = await start(["hook 1.mp4", "hook 2.mp4"], ["cta 1.mp4"]);
    await settled(t);

    const run = (await runOf(runId))!;
    expect(run.status).toBe("failed");
    const check = run.steps.find((one) => one.nodeId === "check_1")!;
    expect(check.status).toBe("failed");
    expect(check.error).toBe("2 of 4 files need another look before editing.");
    const byName = new Map(check.footage!.files.map((file) => [file.name, file]));
    expect(byName.get("hook 2.mp4")!.problems.map((p) => p.kind)).toEqual(["shape", "quiet"]);
    expect(byName.get("cta 1.mp4")!.role).toBe("ending");
    expect(byName.get("cta 1.mp4")!.problems.map((p) => p.kind)).toEqual(["black"]);
    expect(check.footage!.stopped).toBe(true);
    // Nothing was edited.
    expect(run.steps.find((one) => one.nodeId === "still")!.status).toBe("skipped");
    expect(sent.some((one) => one.url.endsWith("/v1/video/thumbnail"))).toBe(false);

    // One alert, saying what is wrong with which take; no second "run failed" alert.
    const all = await alerts();
    expect(all.map((alert) => alert.kind)).toEqual(["footage_problem"]);
    expect(all[0].message.split("\n")).toEqual([
      "2 of 4 files need another look before editing from Maya. Editing has not started.",
      "hook 2.mp4: It is landscape (16:9) (1920×1080); vertical (9:16) is needed. The sound is very quiet (-50 LUFS; -35 or louder is needed).",
      "cta 1.mp4 (ending): The picture is black for 2.5 s, from 0:00.",
    ]);
    expect(all[0]).toMatchObject({ runId, stepName: "Check Footage" });
    // In every chat app: a title, then a line per file, and a link to the run.
    const worded = wordAlert(all[0], "https://dash.example/runs/1");
    expect(worded.title).toBe("UGC Ads: footage needs another look");
    expect(worded.lines).toHaveLength(3);
    expect(worded.linkLabel).toBe("Open the run");

    const note = toolkit!.texts.get(`teams/${team}/ugc/Maya/Footage check.txt`)!;
    expect(note).toContain("need to be filmed again or fixed before editing can start");
    expect(note).toContain("- hook 2.mp4\n    It is landscape");
    expect(note).not.toContain("hook 1.mp4");
  });

  test("set to only tell, the team hears about it and editing goes on", async () => {
    const { t, start, runOf, alerts } = await setUp({ whenFound: "tell" });
    const runId = await start(["hook 2.mp4"]);
    await settled(t);
    const run = (await runOf(runId))!;
    expect(run.status).toBe("done");
    expect(run.steps.find((one) => one.nodeId === "check_1")!.footage!.stopped).toBe(false);
    expect(run.steps.find((one) => one.nodeId === "still")!.status).toBe("done");
    const all = await alerts();
    expect(all.map((alert) => alert.kind)).toEqual(["footage_problem"]);
    expect(all[0].message).toContain("Editing went ahead anyway.");
  });

  test("the step's own settings change what counts", async () => {
    const { t, start, runOf } = await setUp({ shape: "any", quietBelow: -60 });
    const runId = await start(["hook 2.mp4"]);
    await settled(t);
    expect((await runOf(runId))!.status).toBe("done");
  });

  test("a take the toolkit cannot read is a problem", async () => {
    const { t, start, runOf, noRetries } = await setUp();
    await noRetries();
    const runId = await start(["hook 9.mp4"]);
    await settled(t);
    const run = (await runOf(runId))!;
    const check = run.steps.find((step) => step.nodeId === "check_1")!;
    expect(check.footage!.files.find((file) => file.name === "hook 9.mp4")!.problems).toEqual([
      { kind: "unreadable", says: "The file could not be read." },
    ]);
    expect(run.status).toBe("failed");
  });

  test("when the toolkit can check nothing, the toolkit is blamed, not the footage", async () => {
    oldToolkit = true;
    const { t, start, runOf, alerts, noRetries } = await setUp();
    await noRetries();
    const runId = await start(["hook 1.mp4"]);
    await settled(t);
    const run = (await runOf(runId))!;
    const check = run.steps.find((step) => step.nodeId === "check_1")!;
    expect(check.status).toBe("failed");
    expect(check.footage).toBeNull();
    // The usual "run failed" alert, since no footage was judged.
    expect((await alerts()).map((alert) => alert.kind)).toEqual(["run_failed"]);
  });
});
