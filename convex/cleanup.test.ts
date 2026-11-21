import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { adFolder, takeFolder } from "./lib/adFiles";
import { encryptSecret } from "./lib/crypto";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";
import { connectToolkit, fakeToolkitStorage } from "./test.toolkit";

const TOOLKIT = "https://toolkit.example";
const FILE = "https://files.example/uploads/boots-raw.mp4";
const WORDS_FILE = "https://files.example/out/boots-words.json";

/** Each sentence said from where the last ended, 0.4 s a word, with `gap` seconds between. */
function segmentsOf(sentences: string[], gap = 0.5) {
  let at = 1;
  return sentences.map((sentence, id) => {
    const words = sentence.split(" ").map((word) => {
      const spoken = { word: ` ${word}`, start: at, end: at + 0.3, probability: 0.9 };
      at += 0.4;
      return spoken;
    });
    at += gap;
    return { id, start: words[0].start, end: words[words.length - 1].end, text: sentence, words };
  });
}

const UGC = segmentsOf(
  [
    "Hook one.",
    "Are your feet always cold?",
    "Hook two.",
    "Are your feet freezing every winter?",
    "Body.",
    "These boots fixed it.",
    "These boots fixed it for good.",
  ],
  2,
);

type Sent = { url: string; body: Record<string, unknown> };

function fakeToolkit(segments: unknown, silences: unknown = []) {
  const sent: Sent[] = [];
  let made = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      sent.push({ url, body });
      const done = (response: unknown) =>
        new Response(JSON.stringify({ code: 200, response }), { status: 200 });
      if (url === WORDS_FILE) return new Response(JSON.stringify(segments), { status: 200 });
      if (url.endsWith("/v1/media/metadata")) {
        return done({ duration: 40, width: 1080, height: 1920, fps: 29.97, has_audio: true });
      }
      if (url.endsWith("/v1/media/silence")) return done(silences);
      if (url.endsWith("/v1/media/transcribe")) {
        return done({ text: null, srt: null, segments: null, segments_url: WORDS_FILE });
      }
      if (url.endsWith("/v1/ffmpeg/compose")) {
        made += 1;
        return done([{ file_url: `https://files.example/out/clean-${made}.mp4` }]);
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
});

async function settled(t: ReturnType<typeof backend>) {
  for (let second = 0; second < 60; second++) {
    vi.advanceTimersByTime(1000);
    await t.finishInProgressScheduledFunctions();
  }
}

async function setUp(
  input: Record<string, unknown>,
  trigger: Record<string, unknown> = { kind: "webhook" },
) {
  process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
  process.env.CONVEX_SITE_URL = "https://dash.example";
  const apiKeyCipher = await encryptSecret("toolkit-key");
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  const automationId = await t.run(async (ctx) => {
    await ctx.db.insert("toolkitConnections", {
      organizationId: team,
      baseUrl: TOOLKIT,
      apiKeyCipher,
      apiKeyHint: "abcd",
      status: "ok",
      buildNumber: null,
      lastCheckedAt: 0,
      lastError: null,
      createdBy: maya.id,
    });
    return await ctx.db.insert("automations", {
      organizationId: team,
      name: "Clean Up Takes",
      enabled: true,
      trigger: trigger as never,
      nodes: [{ id: "cleanup", kind: "cleanup", input, position: { x: 0, y: 0 } }],
      edges: [],
      hookToken: "token",
      nextRunAt: null,
      createdBy: maya.id,
      updatedAt: Date.now(),
    });
  });
  const start = (key?: string) =>
    t.run(async (ctx) => {
      const automation = (await ctx.db.get(automationId))!;
      const started = await startRun(
        ctx,
        automation,
        key ? "folder" : "webhook",
        { file_url: FILE, file_name: "boots-raw.mp4", ...(key ? { key } : {}) },
        key ? null : maya.id,
      );
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });
  const runOf = (runId: Id<"runs">) => maya.as.query(api.runs.get, { runId });
  return { t, team, maya, start, runOf };
}

/** The kept stretches of a compose request, from its select expression, in seconds. */
function keptFrames(body: Record<string, unknown>) {
  const filters = body.filters as { filter: string }[];
  return filters.flatMap(({ filter }) =>
    [...filter.matchAll(/\btrim=start_frame=(\d+):end_frame=(\d+)/g)].map((match) => [
      Number(match[1]),
      Number(match[2]) - 1,
    ]),
  );
}

describe("Clean Up Pauses And Retakes", () => {
  test("hears pauses and words, then cuts a file per hook take and the body", async () => {
    const sent = fakeToolkit(UGC);
    const { t, start, runOf } = await setUp({ creator: "Jane Doe" });
    const runId = await start();
    await settled(t);

    const run = (await runOf(runId))!;
    expect(run.status).toBe("done");
    const step = run.steps.find((one) => one.nodeId === "cleanup")!;
    // The silence check was asked for, beside the words.
    const silence = sent.find((one) => one.url.endsWith("/v1/media/silence"))!;
    expect(silence.body).toMatchObject({ media_url: FILE, duration: 0.3 });
    const cuts = sent.filter((one) => one.url.endsWith("/v1/ffmpeg/compose"));
    expect(cuts).toHaveLength(3);
    expect(step.outputs).toHaveLength(3);
    expect(step.cleaned).toHaveLength(1);
    expect(step.cleaned![0]).toMatchObject({
      source: FILE,
      hooks: 2,
      retakes: 1,
      labels: ["hook01", "hook02", "body"],
    });
    // The 2 s pauses between the takes, and the retake, are not in any file.
    expect(step.cleaned![0].after).toBeLessThan(step.cleaned![0].before);
    // Cut on whole frames at 30 a second, the sound on the same frames.
    expect(cuts[0].body.filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filter: expect.stringContaining("fps=30,") }),
        expect.objectContaining({
          filter: expect.stringMatching(/trim=start_frame=\d+:end_frame=\d+/),
        }),
        expect.objectContaining({
          filter: expect.stringMatching(/atrim=start_sample=\d+:end_sample=\d+/),
        }),
      ]),
    );
    // The first hook starts on its own words, after "Hook one." was cut out.
    const words = UGC.flatMap((segment) => segment.words);
    const seek = (
      cuts[0].body.inputs as { options: { option: string; argument?: number }[] }[]
    )[0].options.find((one) => one.option === "-ss")!;
    expect(seek.argument).toBeCloseTo(words[2].start - 0.08, 2);
    expect(keptFrames(cuts[0].body)).toHaveLength(1);

    // Each file carries its take's code, which names it and picks its folder.
    const steps = await t.run(async (ctx) =>
      ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect(),
    );
    const labels = steps.find((one) => one.nodeId === "cleanup")!.labels!;
    expect(labels.map((one) => one.label)).toEqual(["hook01", "hook02", "body"]);
    expect(labels.map((one) => adFolder(one.label, "Jane Doe"))).toEqual([
      "Jane Doe/hooks/",
      "Jane Doe/hooks/",
      "Jane Doe/body/",
    ]);
  });

  test("a recording dropped in a creator's folder is theirs", async () => {
    fakeToolkit(UGC);
    const { t, start, runOf } = await setUp(
      {},
      { kind: "folder", prefix: "raw-takes/", fileType: "video" },
    );
    const runId = await start("raw-takes/Sam Lee/boots-raw.mp4");
    await settled(t);
    const run = (await runOf(runId))!;
    expect(run.status).toBe("done");
    const step = run.steps.find((one) => one.nodeId === "cleanup")!;
    expect(step.cleaned![0]).toMatchObject({ creator: "Sam Lee", hooks: 2 });
    const kept = await t.query(internal.files.finishedOfRun, { runId });
    expect(kept?.creator).toBe("Sam Lee");
  });

  test("makes one cleaned video when no hooks are said, and no codes without a creator", async () => {
    const plain = segmentsOf(
      ["So here is my morning routine.", "First I make coffee.", "Then I go for a run."],
      3,
    );
    const sent = fakeToolkit(plain, [
      { start: "00:00:03.700", end: "00:00:06.600" },
      { start: "00:00:08.200", end: "00:00:11.100" },
    ]);
    const { t, start, runOf } = await setUp({});
    const runId = await start();
    await settled(t);
    const run = (await runOf(runId))!;
    expect(run.status).toBe("done");
    const step = run.steps.find((one) => one.nodeId === "cleanup")!;
    expect(sent.filter((one) => one.url.endsWith("/v1/ffmpeg/compose"))).toHaveLength(1);
    expect(step.cleaned![0]).toMatchObject({ hooks: 0, retakes: 0, pauses: 2, labels: [null] });
    const steps = await t.run(async (ctx) =>
      ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect(),
    );
    expect(steps[0].labels ?? []).toEqual([]);
  });

  test("still cleans up when the silence check fails, from the gaps between words", async () => {
    const plain = segmentsOf(["One line here.", "Another line there."], 3);
    const sent = fakeToolkit(plain);
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      sent.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      const done = (response: unknown) =>
        new Response(JSON.stringify({ code: 200, response }), { status: 200 });
      if (url === WORDS_FILE) return new Response(JSON.stringify(plain), { status: 200 });
      if (url.endsWith("/v1/media/metadata")) {
        return done({ duration: 20, width: 1920, height: 1080, fps: 25, has_audio: true });
      }
      if (url.endsWith("/v1/media/silence")) return new Response("boom", { status: 500 });
      if (url.endsWith("/v1/media/transcribe")) {
        return done({ text: null, srt: null, segments: null, segments_url: WORDS_FILE });
      }
      if (url.endsWith("/v1/ffmpeg/compose")) {
        return done([{ file_url: "https://files.example/out/clean.mp4" }]);
      }
      return new Response("not found", { status: 404 });
    });
    const { t, team, start, runOf } = await setUp({ hooks: "none" });
    // No second try, so the step goes on without the pauses at once.
    await t.run(async (ctx) => {
      const settings = await ctx.db
        .query("teamSettings")
        .withIndex("by_organization", (q) => q.eq("organizationId", team))
        .first();
      if (settings) await ctx.db.patch(settings._id, { stepRetries: 0 });
      else
        await ctx.db.insert("teamSettings", {
          organizationId: team,
          maxParallelJobs: 4,
          stepRetries: 0,
        });
    });
    const runId = await start();
    await settled(t);
    const run = (await runOf(runId))!;
    expect(run.status).toBe("done");
    const step = run.steps.find((one) => one.nodeId === "cleanup")!;
    expect(step.cleaned![0].pauses).toBe(1);
  });

  test("says so when no speech is heard", async () => {
    fakeToolkit([]);
    const { t, start, runOf } = await setUp({});
    const runId = await start();
    await settled(t);
    const run = (await runOf(runId))!;
    expect(run.status).toBe("failed");
    expect(run.steps[0].error).toBe(
      "No speech was heard in the video, so there was nothing to clean up.",
    );
  });
});

describe("keeping a cleaned recording's takes", () => {
  let storage: ReturnType<typeof fakeToolkitStorage> | null = null;
  afterEach(() => storage?.restore());

  test("hooks and body go in the creator's folders, and are not listed as ads", async () => {
    expect(takeFolder("hook03")).toBe("hooks/");
    expect(takeFolder("body")).toBe("body/");
    expect(takeFolder("h01_c01")).toBeNull();
    expect(adFolder("hook01", "")).toBe("hooks/");

    vi.useRealTimers();
    process.env.CONNECTIONS_SECRET = "a-test-secret-that-is-long-enough-1234";
    storage = fakeToolkitStorage();
    const LINK = "https://r2.example/test-bucket";
    const JOB = "ca4934e3-5b1f-4c3e-9a77-0d2f1b6e8a10";
    const t = backend();
    const salt = await addTeam(t, "Salt House");
    const maya = await addPerson(t, "Maya Ortiz", [salt], "owner");
    await connectToolkit(t, salt, maya.id);
    const codes = ["hook01", "hook02", "body"];
    const outputs = codes.map((_, i) => `${LINK}/${JOB}_output_${i}.mp4`);
    const runId = await t.run(async (ctx) => {
      const automationId = await ctx.db.insert("automations", {
        organizationId: salt,
        name: "Clean Up Takes",
        enabled: true,
        trigger: { kind: "manual" },
        nodes: [],
        edges: [],
        hookToken: "token",
        nextRunAt: null,
        createdBy: maya.id,
        updatedAt: Date.now(),
      });
      const runId = await ctx.db.insert("runs", {
        organizationId: salt,
        automationId,
        automationName: "Clean Up Takes",
        status: "done",
        triggerKind: "manual",
        trigger: { file_url: `${LINK}/teams/${salt}/uploads/x/jane.mp4`, file_name: "jane.mp4" },
        nodes: [
          {
            id: "cleanup",
            kind: "cleanup",
            input: { creator: "Jane Doe" },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
        error: null,
        startedBy: null,
        finishedAt: Date.now(),
      });
      await ctx.db.insert("runSteps", {
        runId,
        organizationId: salt,
        nodeId: "cleanup",
        status: "done",
        jobIds: [],
        outputs,
        labels: outputs.map((url, i) => ({ url, label: codes[i]! })),
        error: null,
        startedAt: 0,
        finishedAt: 0,
      });
      return runId;
    });
    outputs.forEach((_, i) => storage!.put(`${JOB}_output_${i}.mp4`));
    const kept = await t.action(internal.files.keepFinished, { runId });
    const folder = "Finished/Clean Up Takes/Jane Doe/";
    expect(kept.filter((key) => key.startsWith(`${folder}hooks/`))).toHaveLength(2);
    expect(kept.filter((key) => key.startsWith(`${folder}body/`))).toHaveLength(1);
    expect(kept.some((key) => key.endsWith(".csv"))).toBe(false);
    expect(kept).toEqual([
      `${folder}hooks/Jane hook01.mp4`,
      `${folder}hooks/Jane hook02.mp4`,
      `${folder}body/Jane body.mp4`,
    ]);
  });
});
