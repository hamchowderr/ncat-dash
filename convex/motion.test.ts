import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/crypto";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const TOOLKIT = "https://toolkit.example";
const FILE = "https://files.example/uploads/growth-talk.mp4";
const WORDS_FILE = "https://files.example/out/growth-words.json";

/** "Hi I'm Ana. We grew 40 percent faster than last year. ..." said from 1 s, 0.5 s a word. */
function segmentsOf(sentences: string[]) {
  let at = 1;
  return sentences.map((sentence, id) => {
    const words = sentence.split(" ").map((word) => {
      const spoken = { word: ` ${word}`, start: at, end: at + 0.4, probability: 0.9 };
      at += 0.5;
      return spoken;
    });
    at += 0.5;
    return { id, start: words[0].start, end: words[words.length - 1].end, text: sentence, words };
  });
}

const SEGMENTS = segmentsOf([
  "Hi I'm Ana and this is the show.",
  "This year we grew 40 percent faster than last year.",
  "We made 900 sales in one week.",
  "Thanks for watching.",
]);

type Sent = { url: string; body: Record<string, unknown> };

function fakeToolkit(duration = 30) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      sent.push({ url, body });
      const done = (response: unknown) =>
        new Response(JSON.stringify({ code: 200, response }), { status: 200 });
      if (url === WORDS_FILE) return new Response(JSON.stringify(SEGMENTS), { status: 200 });
      if (url.endsWith("/v1/media/metadata")) {
        return done({ duration, width: 1080, height: 1920, fps: 30, has_audio: true });
      }
      if (url.endsWith("/v1/media/transcribe")) {
        return done({ text: null, srt: null, segments: null, segments_url: WORDS_FILE });
      }
      if (url.endsWith("/v1/video/motion")) {
        return done({
          file_url: "https://files.example/out/with-motion.mp4",
          pieces: 3,
          sounds: 0,
          seconds: 30,
        });
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

type Node = { id: string; kind: string; input: Record<string, unknown> };

async function setUp(nodes: Node[], motion?: Record<string, unknown>) {
  process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
  process.env.CONVEX_SITE_URL = "https://dash.example";
  const apiKeyCipher = await encryptSecret("toolkit-key");
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  if (motion)
    await maya.as.mutation(api.teamSettings.setMotion, {
      organizationId: team,
      motion: motion as never,
    });
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
    const settings = await ctx.db
      .query("teamSettings")
      .withIndex("by_organization", (q) => q.eq("organizationId", team))
      .first();
    if (settings)
      await ctx.db.patch(settings._id, { brand: { color: "#FF2A6D", font: "Archivo Black" } });
    else {
      await ctx.db.insert("teamSettings", {
        organizationId: team,
        maxParallelJobs: 4,
        brand: { color: "#FF2A6D", font: "Archivo Black" },
      });
    }
    return await ctx.db.insert("automations", {
      organizationId: team,
      name: "Motion",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes: nodes.map((node, index) => ({ ...node, position: { x: index * 300, y: 0 } })) as never,
      edges: nodes.slice(1).map((node, index) => ({
        id: `${nodes[index].id}>${node.id}`,
        source: nodes[index].id,
        target: node.id,
      })),
      hookToken: "token",
      nextRunAt: null,
      createdBy: maya.id,
      updatedAt: Date.now(),
    });
  });
  const start = () =>
    t.run(async (ctx) => {
      const automation = (await ctx.db.get(automationId))!;
      const started = await startRun(
        ctx,
        automation,
        "webhook",
        { file_url: FILE, file_name: "growth-talk.mp4" },
        maya.id,
      );
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });
  const runOf = (runId: Id<"runs">) => maya.as.query(api.runs.get, { runId });
  return { t, team, maya, start, runOf };
}

const TEAM_MOTION = {
  preset: "clean-talking-head",
  style: {
    look: "clean",
    busy: "medium",
    pieces: ["title", "lower_third", "stat", "follow"],
    opening: "title",
    ending: "follow",
    sound: "light",
    showsUnsaid: false,
  },
  hostName: "Ana",
  hostRole: "Host",
  handle: "saltstudio",
  callToAction: "Follow for more",
  notes: "",
};

describe("Add Motion Graphics", () => {
  test("transcribes, places pieces by rules in the team's style and sends one render", async () => {
    const sent = fakeToolkit();
    const { t, start, runOf } = await setUp(
      [{ id: "motion", kind: "motion", input: {} }],
      TEAM_MOTION,
    );
    const runId = await start();
    await settled(t);

    const run = (await runOf(runId))!;
    expect(run.status).toBe("done");
    const step = run.steps.find((one) => one.nodeId === "motion")!;
    expect(step.outputs).toEqual(["https://files.example/out/with-motion.mp4"]);

    const render = sent.find((one) => one.url.endsWith("/v1/video/motion"))!;
    expect(render.body.video_url).toBe(FILE);
    const pieces = render.body.pieces as { type: string; title?: string; subtitle?: string }[];
    // The second number is said within the style's gap of the first, so it gets no card.
    expect(pieces.map((piece) => piece.type)).toEqual(["title", "lower_third", "stat", "follow"]);
    expect(pieces[0].title).toBe("growth-talk");
    expect(pieces[1]).toMatchObject({ title: "Ana", subtitle: "Host" });
    expect(pieces[2]).toMatchObject({ title: "40%", subtitle: "faster than last year" });
    expect(pieces.at(-1)).toMatchObject({ title: "@saltstudio" });
    expect(render.body.style).toEqual({ look: "clean", accent: "#FF2A6D", font: "Archivo Black" });
    expect(render.body).toMatchObject({ sound_volume: 0.55, piece_sounds: true });
    // What it placed is kept, for steps after it to keep clear of.
    expect(step.placed?.[0].source).toBe(FILE);
    expect(step.placed?.[0].items.map((item) => item.kind)).toEqual(
      pieces.map((piece) => piece.type),
    );
  });

  test("uses another preset and a typed title when the step picks them", async () => {
    const sent = fakeToolkit();
    const { t, start, runOf } = await setUp(
      [
        {
          id: "motion",
          kind: "motion",
          input: { style: "neon", title: "Big Year", sounds: "off" },
        },
      ],
      TEAM_MOTION,
    );
    const runId = await start();
    await settled(t);
    expect((await runOf(runId))!.status).toBe("done");
    const render = sent.find((one) => one.url.endsWith("/v1/video/motion"))!;
    expect((render.body.style as { look: string }).look).toBe("neon");
    expect(render.body).toMatchObject({ sound_volume: 0, piece_sounds: false });
    const pieces = render.body.pieces as { type: string; title?: string }[];
    expect(pieces.find((piece) => piece.type === "title")?.title).toBe("Big Year");
  });

  test("works with no Motion settings saved, in the default style", async () => {
    const sent = fakeToolkit();
    const { t, start, runOf } = await setUp([{ id: "motion", kind: "motion", input: {} }]);
    const runId = await start();
    await settled(t);
    expect((await runOf(runId))!.status).toBe("done");
    expect(sent.some((one) => one.url.endsWith("/v1/video/motion"))).toBe(true);
  });
});

describe("Add Sound Effects", () => {
  test("adds sounds by rules with no pieces, leaving the picture alone", async () => {
    const sent = fakeToolkit();
    const { t, start, runOf } = await setUp([
      { id: "sounds", kind: "sound-effects", input: { level: "heavy" } },
    ]);
    const runId = await start();
    await settled(t);
    expect((await runOf(runId))!.status).toBe("done");
    const render = sent.find((one) => one.url.endsWith("/v1/video/motion"))!;
    expect(render.body.pieces).toEqual([]);
    const sounds = (render.body.sounds as { sound: string }[]).map((one) => one.sound);
    expect(sounds[0]).toBe("impact");
    expect(sounds).toContain("pop");
    expect(sounds.at(-1)).toBe("ding");
    expect(render.body.piece_sounds).toBe(false);
  });
});

describe("Settings > Motion", () => {
  test("saves a tidied setup, shows it with the presets, and tells the agent", async () => {
    fakeToolkit();
    const { team, maya } = await setUp([], { ...TEAM_MOTION, handle: " saltstudio " });
    const settings = await maya.as.query(api.teamSettings.get, { organizationId: team });
    expect(settings.motion.handle).toBe("@saltstudio");
    expect(settings.motionPresets).toHaveLength(18);
    const brief = await maya.as.query(api.teamSettings.agentBrief, { organizationId: team });
    expect(brief.text).toContain("Clean Talking Head");
  });

  test("refuses an unknown preset", async () => {
    fakeToolkit();
    const { team, maya } = await setUp([]);
    await expect(
      maya.as.mutation(api.teamSettings.setMotion, {
        organizationId: team,
        motion: { ...TEAM_MOTION, preset: "nope" },
      }),
    ).rejects.toThrow("Pick one of the preset styles.");
  });
});

test("only owners and admins change Settings > Motion", async () => {
  fakeToolkit();
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const sam = await addPerson(t, "Sam Lee", [team]);
  await expect(
    sam.as.mutation(api.teamSettings.setMotion, { organizationId: team, motion: TEAM_MOTION }),
  ).rejects.toThrow("Only a team owner or admin can do this.");
});
