import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/crypto";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

/**
 * Translate Subtitles: the step hears each video once, has its words translated into each
 * language picked (the same kept translations "Caption video" uses), and writes one SRT
 * file per video and language in the team's folder. The video carries on unchanged.
 */

const TOOLKIT = "https://toolkit.example";
const AGENT_URL = "https://agent.example";
const VIDEO = "https://files.example/uploads/cave.mp4";

// "So what we did." then, after a pause, "We explored the cave."
const SEGMENTS = [
  {
    start: 0,
    end: 1.6,
    text: "So what we did.",
    words: [
      { word: " So", start: 0, end: 0.3 },
      { word: " what", start: 0.4, end: 0.7 },
      { word: " we", start: 0.8, end: 1 },
      { word: " did.", start: 1.1, end: 1.6 },
    ],
  },
  {
    start: 3,
    end: 5,
    text: "We explored the cave.",
    words: [
      { word: " We", start: 3, end: 3.3 },
      { word: " explored", start: 3.4, end: 4 },
      { word: " the", start: 4.1, end: 4.3 },
      { word: " cave.", start: 4.4, end: 5 },
    ],
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.AGENT_URL;
  delete process.env.MASTRA_JWT_SECRET;
});

type Sent = { url: string; body: Record<string, unknown>; method: string };

/**
 * A stand-in toolkit, bucket and agent server. The agent "translates" each word into
 * "ES-<word>" and puts each line's words in reverse order, the way another language may.
 */
function stubs(answer?: () => Response) {
  const sent: Sent[] = [];
  const stored = new Map<string, string>();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const raw = String(init?.body ?? "");
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      body = {};
    }
    sent.push({ url, body, method });
    if (url === `${TOOLKIT}/v1/storage/sign`) {
      const key = String(body.key);
      return Response.json({
        response: { url: `https://bucket.example/${key}?method=${String(body.method)}` },
      });
    }
    if (url.startsWith("https://bucket.example/") && method === "PUT") {
      stored.set(decodeURIComponent(new URL(url).pathname.slice(1)), raw);
      return new Response(null, { status: 200 });
    }
    if (url === `${AGENT_URL}/ncat/translate-words`) {
      if (answer) return answer();
      const lines = body.lines as string[][];
      const translated = lines.map((words) =>
        words.map((word, at) => [`ES-${word}`, [at]] as const).reverse(),
      );
      return Response.json({
        answer: JSON.stringify(translated),
        model: "anthropic/claude-haiku-5-5",
        usage: { inputTokens: 1000, outputTokens: 500 },
      });
    }
    return new Response(JSON.stringify({ code: 202, job_id: "tk-1" }), { status: 202 });
  });
  return { sent, stored };
}

async function setUp(input: Record<string, unknown>, storage = true) {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
  process.env.AGENT_URL = AGENT_URL;
  process.env.MASTRA_JWT_SECRET = "a-shared-secret-for-the-agent-server";
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
      ...(storage
        ? {
            storage: {
              bucket: "media",
              endpoint: "https://s3.example",
              publicUrl: "https://files.example",
            },
          }
        : {}),
    });
    return ctx.db.insert("automations", {
      organizationId: team,
      name: "Podcast subtitles",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes: [{ id: "subtitles_1", kind: "subtitles", input, position: { x: 0, y: 0 } }],
      edges: [],
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
        { file_url: VIDEO, file_name: "Cave Episode.mp4" },
        maya.id,
      );
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });
  const stepOf = (runId: Id<"runs">) =>
    t.run(async (ctx) => {
      const step = (await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .first())!;
      const jobs = await Promise.all(step.jobIds.map((id) => ctx.db.get(id)));
      const run = (await ctx.db.get(runId))!;
      return { step, run, jobs: jobs.filter((job) => job !== null) };
    });
  // Hears the video: the toolkit's transcript comes back and its words are kept.
  const hear = async (runId: Id<"runs">) => {
    const hearing = await stepOf(runId);
    expect(hearing.step.stage).toBe("hear");
    await t.mutation(internal.jobs.finish, {
      jobId: hearing.jobs[0]!._id,
      ok: true,
      result: { segments: SEGMENTS },
    });
    await t.action(internal.disclosure.hear, { runStepId: hearing.step._id });
  };
  return { t, team, maya, start, stepOf, hear };
}

const asks = (sent: Sent[]) =>
  sent.filter((one) => one.url === `${AGENT_URL}/ncat/translate-words`);

describe("Translate Subtitles", () => {
  test("hears the video once, then writes an SRT file in each language", async () => {
    const { t, team, start, stepOf, hear } = await setUp({ languages: ["es", "fr"] });
    const { sent, stored } = stubs();
    const runId = await start();

    const hearing = await stepOf(runId);
    expect(hearing.jobs.map((job) => job.stepId)).toEqual(["media-transcribe"]);
    expect(hearing.jobs[0]!.input).toMatchObject({ media_url: VIDEO, word_timestamps: true });
    await hear(runId);

    const translating = await stepOf(runId);
    expect(translating.step.stage).toBe("translate");
    expect(translating.step.subtitles).toEqual([
      { source: VIDEO, language: "es", name: "Cave Episode.es.srt" },
      { source: VIDEO, language: "fr", name: "Cave Episode.fr.srt" },
    ]);
    await t.action(internal.subtitleTranslation.translate, { runStepId: translating.step._id });

    expect(asks(sent).map((one) => one.body.language)).toEqual(["Spanish", "French"]);
    const key = `teams/${team}/Subtitles/Podcast subtitles/Cave Episode.es.srt`;
    const spanish = stored.get(key);
    expect(spanish).toBeDefined();
    // Each cue keeps its words and their times; the second line starts at 3 s.
    expect(spanish).toContain("1\n00:00:00,000 --> 00:00:01,600\nES-did. ES-we ES-what ES-So\n");
    expect(spanish).toContain("2\n00:00:03,000 --> 00:00:05,000\n");
    expect(stored.has(`teams/${team}/Subtitles/Podcast subtitles/Cave Episode.fr.srt`)).toBe(true);

    const done = await stepOf(runId);
    expect(done.step.status).toBe("done");
    expect(done.run.status).toBe("done");
    // The video carries on unchanged.
    expect(done.step.outputs).toEqual([VIDEO]);
    expect(done.step.subtitles![0]).toEqual({
      source: VIDEO,
      language: "es",
      name: "Cave Episode.es.srt",
      key: "Subtitles/Podcast subtitles/Cave Episode.es.srt",
      link: `https://files.example/teams/${team}/Subtitles/Podcast%20subtitles/Cave%20Episode.es.srt`,
    });
    expect(done.step.aiSpent).toBeGreaterThan(0);
  });

  test("a video already translated into a language is not asked again", async () => {
    const { t, start, stepOf, hear } = await setUp({ languages: ["es"] });
    const { sent } = stubs();
    const first = await start();
    await hear(first);
    await t.action(internal.subtitleTranslation.translate, {
      runStepId: (await stepOf(first)).step._id,
    });
    expect(asks(sent)).toHaveLength(1);

    // The second run neither hears nor translates: it goes straight to writing.
    const second = await start();
    const again = await stepOf(second);
    expect(again.step.stage).toBe("translate");
    expect(again.jobs).toHaveLength(0);
    await t.action(internal.subtitleTranslation.translate, { runStepId: again.step._id });
    expect(asks(sent)).toHaveLength(1);
    expect((await stepOf(second)).step.status).toBe("done");
  });

  test("a video with no speech gets no files, and the run page says so", async () => {
    const { t, start, stepOf } = await setUp({ languages: ["es"] });
    const { sent, stored } = stubs();
    const runId = await start();
    const hearing = await stepOf(runId);
    await t.mutation(internal.jobs.finish, {
      jobId: hearing.jobs[0]!._id,
      ok: true,
      result: { segments: [] },
    });
    await t.action(internal.disclosure.hear, { runStepId: hearing.step._id });
    const translating = await stepOf(runId);
    // Not heard again, though no words were kept.
    expect(translating.step.stage).toBe("translate");
    await t.action(internal.subtitleTranslation.translate, { runStepId: translating.step._id });
    const done = await stepOf(runId);
    expect(done.step.status).toBe("done");
    expect(done.step.pickNote).toBe("No speech was heard in 1 video, so it has no subtitles.");
    expect(done.step.subtitles).toEqual([
      { source: VIDEO, language: "es", name: "Cave Episode.es.srt" },
    ]);
    expect(asks(sent)).toHaveLength(0);
    expect(stored.size).toBe(0);
  });

  test("fails plainly without a language, or without storage", async () => {
    const none = await setUp({ languages: [] });
    stubs();
    const empty = await none.stepOf(await none.start());
    expect(empty.step.status).toBe("failed");
    expect(empty.step.error).toBe("Pick at least one language for the subtitles.");

    const bare = await setUp({ languages: ["es"] }, false);
    stubs();
    const runId = await bare.start();
    await bare.hear(runId);
    await bare.t.action(internal.subtitleTranslation.translate, {
      runStepId: (await bare.stepOf(runId)).step._id,
    });
    const failed = await bare.stepOf(runId);
    expect(failed.step.status).toBe("failed");
    expect(failed.step.error).toMatch(/your toolkit has none set up/);
  });
});
