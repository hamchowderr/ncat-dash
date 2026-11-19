import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/crypto";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

/**
 * Add B-Roll and Plan B-Roll: what is said is matched to the team's own footage, and to
 * free stock when it is turned on, by a picture model, and the best matches are laid over
 * the talking head while the sound carries on.
 */

const TOOLKIT = "https://toolkit.example";
const AGENT_URL = "https://agent.example";
const FILE = "https://files.example/uploads/story.mp4?X-Amz-Signature=first";
const WORDS_FILE = "https://files.example/out/story-words.json";
const TRUCK_CLIP = "https://files.example/library/truck.mp4";
const BEACH_CLIP = "https://files.example/library/beach.mp4";
const PIXABAY_CLIP = "https://cdn.pixabay.com/video/2024/01/01/1234-coffee_large.mp4";
const PIXABAY_STILL = "https://cdn.pixabay.com/video/2024/01/01/1234-coffee_large.jpg";

/** Sentences said one after another: each word 0.4 s with a 0.1 s gap, 0.5 s between sentences. */
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

const SENTENCES = [
  "Hello and welcome back everyone.",
  "Last summer I rebuilt an old truck in my garage.",
  "It took months of evenings and plenty of patience to finish.",
  "Every morning started with strong coffee before work.",
  "That is my whole story so thanks for watching.",
];
const SEGMENTS = segmentsOf(SENTENCES);

/**
 * A stand-in for the picture model: each plain word gets its own direction, so a phrase and
 * a picture match as closely as the words they share.
 */
const PLAIN = new Set(["a", "photo", "of", "the", "and", "in", "my"]);
function vectorOf(words: string): number[] {
  const vector = new Array<number>(512).fill(0);
  for (const word of words.toLowerCase().split(/[^a-z]+/)) {
    if (!word || PLAIN.has(word)) continue;
    let hash = 7;
    for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) % 512;
    vector[hash] += 1;
  }
  const size = Math.hypot(...vector) || 1;
  return vector.map((x) => x / size);
}

type Sent = { url: string; body: Record<string, unknown> };

function fakeServers(options: { agent?: unknown[]; pixabay?: unknown } = {}) {
  const sent: Sent[] = [];
  let made = 0;
  let asked = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      sent.push({ url, body });
      const done = (response: unknown) =>
        new Response(JSON.stringify({ code: 200, response }), { status: 200 });
      if (url === WORDS_FILE) return new Response(JSON.stringify(SEGMENTS), { status: 200 });
      if (url.startsWith("https://pixabay.com/api/videos/")) {
        return new Response(JSON.stringify(options.pixabay ?? { hits: [] }), { status: 200 });
      }
      if (url.endsWith("/v1/media/metadata")) {
        return done({ duration: 30, width: 1920, height: 1080, fps: 30, has_audio: true });
      }
      if (url.endsWith("/v1/media/transcribe")) {
        return done({ text: null, srt: null, segments: null, segments_url: WORDS_FILE });
      }
      if (url.endsWith("/v1/media/look") && body.media_url) {
        // A library video: its frames, each showing green hills and no face.
        return done({
          model: "clip-vit-b-32",
          media: {
            duration: 12,
            width: 1920,
            height: 1080,
            frames: [1, 5, 9].map((time) => ({ time, face: 0, vector: vectorOf("green hills") })),
          },
        });
      }
      if (url.endsWith("/v1/media/look")) {
        const texts = (body.texts as string[] | undefined) ?? [];
        const pictures = (body.image_urls as string[] | undefined) ?? [];
        return done({
          model: "clip-vit-b-32",
          texts: texts.map((text) => ({ text, vector: vectorOf(text) })),
          // A still is named for what it shows.
          pictures: pictures.map((picture) => ({
            url: picture,
            vector: vectorOf(picture.includes("coffee") ? "coffee" : "nothing"),
          })),
        });
      }
      if (url.endsWith("/v1/ffmpeg/compose")) {
        made++;
        return done([{ file_url: `https://files.example/out/with-broll-${made}.mp4` }]);
      }
      if (url === `${AGENT_URL}/ncat/moments`) {
        const answer = options.agent?.[Math.min(asked++, (options.agent?.length ?? 1) - 1)];
        return new Response(JSON.stringify({ answer }), { status: 200 });
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
  delete process.env.PIXABAY_API_KEY;
  delete process.env.PEXELS_API_KEY;
});

async function settled(t: ReturnType<typeof backend>) {
  for (let second = 0; second < 60; second++) {
    vi.advanceTimersByTime(1000);
    await t.finishInProgressScheduledFunctions();
  }
}

type Node = { id: string; kind: string; stepId?: string; input: Record<string, unknown> };

async function setUp(nodes: Node[]) {
  process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
  process.env.CONVEX_SITE_URL = "https://dash.example";
  process.env.AGENT_URL = AGENT_URL;
  process.env.MASTRA_JWT_SECRET = "a-shared-secret-for-the-agent-server";
  const apiKeyCipher = await encryptSecret("toolkit-key");
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  const sam = await addPerson(t, "Sam Lee", [team], "member");
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
    await ctx.db.insert("teamSettings", { organizationId: team, maxParallelJobs: 4 } as never);
    return await ctx.db.insert("automations", {
      organizationId: team,
      name: "Talking head with B-Roll",
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

  /** A video in the team's library that the picture model has already looked at. */
  const libraryVideo = (
    title: string,
    url: string,
    shows: string,
    extra: { broll?: "yes" | "no"; faces?: number; organizationId?: string } = {},
  ) =>
    t.run(async (ctx) => {
      const organizationId = extra.organizationId ?? team;
      const itemId = await ctx.db.insert("libraryItems", {
        organizationId,
        shortId: `V${title.length}`,
        kind: "video",
        source: "upload",
        title,
        url,
        tags: [],
        searchText: title,
        createdBy: null,
        details: { duration: 12, width: 1920, height: 1080 } as never,
        look: { status: "ready", brollLike: (extra.faces ?? 0) < 0.06, at: 0 },
        ...(extra.broll ? { broll: extra.broll } : {}),
      });
      for (const time of [2, 6, 10]) {
        await ctx.db.insert("libraryFrames", {
          organizationId,
          itemId,
          time,
          face: extra.faces ?? 0,
          vector: vectorOf(shows),
        });
      }
      return itemId;
    });

  const start = () =>
    t.run(async (ctx) => {
      const automation = (await ctx.db.get(automationId))!;
      const started = await startRun(ctx, automation, "webhook", { file_url: FILE }, maya.id);
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });
  const runOf = (runId: Id<"runs">) => maya.as.query(api.runs.get, { runId });
  return { t, team, maya, sam, start, runOf, libraryVideo };
}

const brollNode = (input: Record<string, unknown> = {}): Node => ({
  id: "broll",
  kind: "broll",
  input: { sources: "library", ...input },
});

describe("Add B-Roll", () => {
  test("lays the team's own matching footage over what is said, keeping the sound", async () => {
    const sent = fakeServers();
    const { t, start, runOf, libraryVideo } = await setUp([brollNode()]);
    await libraryVideo("Truck build", TRUCK_CLIP, "old truck garage");
    await libraryVideo("Beach day", BEACH_CLIP, "sunny beach waves");
    const runId = await start();
    await settled(t);

    const run = (await runOf(runId))!;
    expect(run.status).toBe("done");
    const step = run.steps.find((one) => one.nodeId === "broll")!;
    expect(step.outputs).toEqual(["https://files.example/out/with-broll-1.mp4"]);
    expect(step.cutaways).toHaveLength(1);
    expect(step.cutaways?.[0]).toMatchObject({
      source: FILE,
      said: SENTENCES[1],
      kind: "library",
      title: "Truck build",
    });
    expect(step.pickNote).toMatch(/1 cutaway/);

    // The picture model was asked about what each sentence shows, in plain words.
    const look = sent.find((one) => one.url.endsWith("/v1/media/look"))!;
    expect(look.body.texts).toContain("a photo of old truck garage");
    expect(look.body.image_urls).toBeUndefined();

    // One FFmpeg job laid the truck footage over the video, with the video's own sound.
    const compose = sent.filter((one) => one.url.endsWith("/v1/ffmpeg/compose"));
    expect(compose).toHaveLength(1);
    const request = JSON.stringify(compose[0].body);
    expect(request).toContain(TRUCK_CLIP);
    expect(request).not.toContain(BEACH_CLIP);
    expect(request).toContain("0:a?");
  });

  test("skips footage marked as not B-Roll, and talking heads that look like the video", async () => {
    fakeServers();
    const { t, start, runOf, libraryVideo } = await setUp([brollNode()]);
    await libraryVideo("Truck interview", TRUCK_CLIP, "old truck garage", { broll: "no" });
    await libraryVideo("Truck vlog", BEACH_CLIP, "old truck garage", { faces: 0.3 });
    const runId = await start();
    await settled(t);
    const run = (await runOf(runId))!;
    expect(run.status).toBe("done");
    const step = run.steps[0];
    // Nothing matched, so the video is handed on as it came, and the step says why.
    expect(step.cutaways).toEqual([]);
    expect(step.outputs).toEqual([FILE]);
    expect(step.pickNote).toMatch(/^No footage looked enough like what was said/);
  });

  test("never covers the video with itself, nor another team's footage", async () => {
    fakeServers();
    const { t, start, runOf, libraryVideo } = await setUp([brollNode()]);
    const other = await addTeam(t, "Pine Studio");
    await libraryVideo("Their truck", TRUCK_CLIP, "old truck garage", {
      broll: "yes",
      organizationId: other,
    });
    const runId = await start();
    await settled(t);
    expect((await runOf(runId))!.steps[0].cutaways).toEqual([]);
  });

  test("finds free stock with the built-in key, credits it, and keeps the search a day", async () => {
    process.env.PIXABAY_API_KEY = "built-in-key";
    const pixabay = {
      hits: [
        {
          id: 1234,
          pageURL: "https://pixabay.com/videos/id-1234/",
          tags: "coffee, cup, morning",
          duration: 14,
          user: "Brewer",
          videos: {
            large: { url: PIXABAY_CLIP, width: 1920, height: 1080, thumbnail: PIXABAY_STILL },
          },
        },
      ],
    };
    const sent = fakeServers({ pixabay });
    const { t, start, runOf } = await setUp([brollNode({ sources: "stock" })]);
    const first = await start();
    await settled(t);

    const run = (await runOf(first))!;
    expect(run.status).toBe("done");
    const cut = run.steps[0].cutaways?.find((one) => one.kind === "stock");
    expect(cut).toMatchObject({
      said: SENTENCES[3],
      ref: "pixabay:1234",
      credit: { site: "Pixabay", page: "https://pixabay.com/videos/id-1234/", by: "Brewer" },
    });
    expect(
      JSON.stringify(sent.find((one) => one.url.endsWith("/v1/ffmpeg/compose"))!.body),
    ).toContain(PIXABAY_CLIP);
    const searches = sent.filter((one) => one.url.startsWith("https://pixabay.com/")).length;
    expect(searches).toBeGreaterThan(0);
    expect(sent.some((one) => one.url.includes("key=built-in-key"))).toBe(true);

    // The same words a second time are not searched again.
    await start();
    await settled(t);
    expect(sent.filter((one) => one.url.startsWith("https://pixabay.com/")).length).toBe(searches);
  });

  test("says how to set up stock when only stock is asked for and there is no key", async () => {
    fakeServers();
    const { t, start, runOf } = await setUp([brollNode({ sources: "stock" })]);
    const runId = await start();
    await settled(t);
    const run = (await runOf(runId))!;
    expect(run.status).toBe("failed");
    expect(run.steps[0].error).toMatch(/Add a free Pixabay key in Settings > B-Roll/);
  });

  test("Plan B-Roll's picks decide where the cutaways go", async () => {
    const sent = fakeServers({
      agent: [
        JSON.stringify({
          cutaways: [
            { quote: "plenty of patience to finish", show: "old truck garage" },
            { quote: "words that were never said", show: "a rocket" },
          ],
        }),
      ],
    });
    const { t, start, runOf, libraryVideo } = await setUp([
      { id: "plan", kind: "broll-plan", input: {} },
      brollNode(),
    ]);
    await libraryVideo("Truck build", TRUCK_CLIP, "old truck garage");
    const runId = await start();
    await settled(t);

    const run = (await runOf(runId))!;
    expect(run.status).toBe("done");
    const plan = run.steps.find((one) => one.nodeId === "plan")!;
    expect(plan.status).toBe("done");
    expect(plan.pickNote).toMatch(/^1 cutaway was left out/);
    const step = run.steps.find((one) => one.nodeId === "broll")!;
    // Placed where the plan said, not where the truck was first mentioned.
    expect(step.cutaways?.map((one) => one.said)).toEqual(["plenty of patience to finish."]);
    const question = sent.find((one) => one.url === `${AGENT_URL}/ncat/moments`)!;
    expect(question.body.kind).toBe("broll");
    // The video was transcribed once for both steps.
    expect(sent.filter((one) => one.url.endsWith("/v1/media/transcribe"))).toHaveLength(1);
  });
});

describe("The library and B-Roll", () => {
  test("keeps what the picture model saw in a library video and judges if it looks like B-Roll", async () => {
    fakeServers();
    const { t, team, maya } = await setUp([brollNode()]);
    const itemId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("libraryItems", {
        organizationId: team,
        shortId: "V1",
        kind: "video",
        source: "upload",
        title: "Drone over the hills",
        url: "https://files.example/library/drone.mp4",
        tags: [],
        searchText: "drone",
        createdBy: null,
      });
      return id;
    });
    expect(
      await t.mutation(internal.broll.startLook, {
        itemId,
        mediaUrl: "https://files.example/library/drone.mp4",
      }),
    ).toBe(true);
    await settled(t);
    const job = (await t.run((ctx) =>
      ctx.db
        .query("jobs")
        .filter((q) => q.eq(q.field("stepId"), "media-look"))
        .first(),
    ))!;
    expect(job.libraryItemId).toBe(itemId);
    await settled(t);

    const item = (await t.run((ctx) => ctx.db.get(itemId)))!;
    expect(item.look).toMatchObject({ status: "ready", brollLike: true });
    const frames = await t.run((ctx) =>
      ctx.db
        .query("libraryFrames")
        .withIndex("by_item", (q) => q.eq("itemId", itemId))
        .collect(),
    );
    expect(frames.map((frame) => frame.time)).toEqual([1, 5, 9]);

    const status = await maya.as.query(api.broll.status, { organizationId: team });
    expect(status).toMatchObject({ videos: 1, looked: 1, broll: 1, manager: true });
    expect(status.keys).toEqual({ pixabay: "none", pexels: "none" });

    // Marked as not B-Roll by hand, it is left out even though it looks like it.
    await maya.as.mutation(api.broll.setUse, { organizationId: team, itemId, use: "no" });
    expect((await maya.as.query(api.broll.status, { organizationId: team })).broll).toBe(0);
  });

  test("a team key is checked before it is saved, and only owners and admins can save one", async () => {
    const { team, maya, sam } = await setUp([brollNode()]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("key=good")
          ? new Response(JSON.stringify({ hits: [] }), { status: 200 })
          : new Response("[ERROR 400] Invalid or missing API key", { status: 400 }),
      ),
    );
    expect(
      await maya.as.action(api.broll.saveKey, {
        organizationId: team,
        site: "pixabay",
        key: "bad",
      }),
    ).toEqual({
      ok: false,
      detail: "Pixabay did not accept this key. Copy it again from your account.",
    });
    expect(
      await maya.as.action(api.broll.saveKey, {
        organizationId: team,
        site: "pixabay",
        key: "good",
      }),
    ).toEqual({ ok: true });
    expect((await maya.as.query(api.broll.status, { organizationId: team })).keys.pixabay).toBe(
      "team",
    );
    await expect(
      sam.as.action(api.broll.saveKey, { organizationId: team, site: "pixabay", key: "good" }),
    ).rejects.toThrow();
    // The built-in key, on our hosted dashboard, means nobody has to add one.
    process.env.PIXABAY_API_KEY = "built-in-key";
    expect((await sam.as.query(api.broll.status, { organizationId: team })).keys.pixabay).toBe(
      "built-in",
    );
  });
});
