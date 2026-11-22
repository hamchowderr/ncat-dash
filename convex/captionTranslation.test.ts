import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/crypto";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

/**
 * "Caption video" with a caption language: the step hears the video, has its words
 * translated with each translated word paired to the spoken words it stands for, draws the
 * caption file in the team's look and burns it in. A video is translated into a language
 * once; a second run of it asks nothing again.
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
      stored.set(new URL(url).pathname.slice(1), raw);
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

async function setUp(input: Record<string, unknown>) {
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
      storage: { bucket: "media", endpoint: null, publicUrl: null },
    });
    return ctx.db.insert("automations", {
      organizationId: team,
      name: "Spanish captions",
      enabled: true,
      trigger: { kind: "webhook" },
      nodes: [
        { id: "caption_1", kind: "step", stepId: "video-caption", input, position: { x: 0, y: 0 } },
      ],
      edges: [],
      hookToken: "token",
      nextRunAt: null,
      createdBy: maya.id,
      updatedAt: Date.now(),
    });
  });
  const start = (trigger: Record<string, unknown>) =>
    t.run(async (ctx) => {
      const automation = (await ctx.db.get(automationId))!;
      const started = await startRun(ctx, automation, "webhook", trigger, maya.id);
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });
  const caption = (runId: Id<"runs">) =>
    t.run(async (ctx) => {
      const step = (await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .first())!;
      const jobs = await Promise.all(step.jobIds.map((id) => ctx.db.get(id)));
      return { step, jobs: jobs.filter((job) => job !== null) };
    });
  return { t, team, maya, start, caption };
}

const TRIGGER = { file_url: VIDEO, details: { width: 1080, height: 1920 } };

describe("captions in another language", () => {
  test("hears the video, translates and times its words, then burns them in", async () => {
    const { t, team, maya, start, caption } = await setUp({ caption_language: "es" });
    const { sent, stored } = stubs();
    const runId = await start(TRIGGER);

    // First the video's words.
    const hearing = await caption(runId);
    expect(hearing.step.stage).toBe("hear");
    expect(hearing.jobs.map((job) => job.stepId)).toEqual(["media-transcribe"]);
    expect(hearing.jobs[0].input).toMatchObject({ media_url: VIDEO, word_timestamps: true });
    await t.mutation(internal.jobs.finish, {
      jobId: hearing.jobs[0]._id,
      ok: true,
      result: { segments: SEGMENTS },
    });
    await t.action(internal.disclosure.hear, { runStepId: hearing.step._id });

    // Then the translation, with the vertical video's built-in style and size.
    const translating = await caption(runId);
    expect(translating.step.stage).toBe("translate");
    expect(translating.step.captionPlan).toEqual([
      expect.objectContaining({ video: VIDEO, language: "es", width: 1080, height: 1920 }),
    ]);
    expect(translating.step.captionPlan![0].look).toMatchObject({
      style: "highlight",
      all_caps: true,
      word_color: "#F2B33D",
    });
    await t.action(internal.captionTranslation.translate, { runStepId: translating.step._id });

    const asked = sent.filter((one) => one.url === `${AGENT_URL}/ncat/translate-words`);
    expect(asked).toHaveLength(1);
    expect(asked[0].body).toMatchObject({
      organizationId: team,
      language: "Spanish",
      noSpaces: false,
      lines: [
        ["So", "what", "we", "did."],
        ["We", "explored", "the", "cave."],
      ],
    });

    // The caption file is in the team's bucket, drawn in the team's look.
    const [key, file] = [...stored.entries()][0]!;
    expect(key).toMatch(/captions\/translated\/[0-9a-f-]{36}\.ass$/);
    expect(file).toContain("PlayResX: 1080\nPlayResY: 1920");
    expect(file).toContain("ES-CAVE. ES-THE ES-EXPLORED ES-WE");
    expect(file).toContain("{\\c&H003DB3F2}ES-CAVE.");
    // The second line starts when it was said, after the pause.
    expect(file).toContain("Dialogue: 0,0:00:03.00,0:00:05.00");

    // Then the burn, with the toolkit's link to the file.
    const burning = await caption(runId);
    expect(burning.step.stage).toBe("render");
    expect(burning.jobs.map((job) => job.stepId)).toEqual(["ffmpeg-compose"]);
    const burn = burning.jobs[0].input as {
      inputs: { file_url: string }[];
      filters: { filter: string }[];
    };
    expect(burn.inputs).toEqual([{ file_url: VIDEO }]);
    expect(burn.filters[0].filter).toBe(
      `[0:v]ass='https://bucket.example/${key}?method=GET',setsar=1[v]`,
    );
    await t.mutation(internal.jobs.finish, {
      jobId: burning.jobs[0]._id,
      ok: true,
      result: { file_url: "https://files.example/out/cave-es.mp4" },
    });
    const done = await caption(runId);
    expect(done.step.status).toBe("done");
    expect(done.step.outputs).toEqual(["https://files.example/out/cave-es.mp4"]);

    // What it cost is on the run, and the translation is kept.
    const run = await maya.as.query(api.runs.get, { runId });
    expect(run!.aiSpent).toBeGreaterThan(0);
    const kept = await t.run((ctx) => ctx.db.query("captionTranslations").collect());
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ organizationId: team, language: "es" });
    expect(kept[0].lines[1].map((word) => word.t)).toEqual([
      "ES-cave.",
      "ES-the",
      "ES-explored",
      "ES-We",
    ]);
  });

  test("a video translated before is neither heard nor translated again", async () => {
    const { t, start, caption } = await setUp({ caption_language: "es" });
    const { sent } = stubs();
    const first = await start(TRIGGER);
    const hearing = await caption(first);
    await t.mutation(internal.jobs.finish, {
      jobId: hearing.jobs[0]._id,
      ok: true,
      result: { segments: SEGMENTS },
    });
    await t.action(internal.disclosure.hear, { runStepId: hearing.step._id });
    await t.action(internal.captionTranslation.translate, {
      runStepId: (await caption(first)).step._id,
    });

    const second = await start(TRIGGER);
    const again = await caption(second);
    expect(again.step.stage).toBe("translate");
    await t.action(internal.captionTranslation.translate, { runStepId: again.step._id });
    expect(sent.filter((one) => one.url.includes("/ncat/translate-words"))).toHaveLength(1);
    expect((await caption(second)).step.stage).toBe("render");
  });

  test("reads the video's size first when it is not known", async () => {
    const { t, start, caption } = await setUp({ caption_language: "ja" });
    stubs();
    const runId = await start({ file_url: VIDEO });
    const hearing = await caption(runId);
    await t.mutation(internal.jobs.finish, {
      jobId: hearing.jobs[0]._id,
      ok: true,
      result: { segments: SEGMENTS },
    });
    await t.action(internal.disclosure.hear, { runStepId: hearing.step._id });
    const reading = await caption(runId);
    expect(reading.step.stage).toBe("size");
    await t.mutation(internal.jobs.finish, {
      jobId: reading.jobs[0]._id,
      ok: true,
      result: { width: 1920, height: 1080, duration: 5 },
    });
    // Heard already: straight on to translating, at the size just read.
    const translating = await caption(runId);
    expect(translating.step.stage).toBe("translate");
    expect(translating.step.captionPlan![0]).toMatchObject({
      language: "ja",
      width: 1920,
      height: 1080,
    });
  });

  test("fails with a plain reason when the agent's answer cannot be read", async () => {
    const { t, start, caption } = await setUp({ caption_language: "es" });
    const { sent } = stubs(() => Response.json({ answer: "Sorry, no.", usage: {} }));
    const runId = await start(TRIGGER);
    const hearing = await caption(runId);
    await t.mutation(internal.jobs.finish, {
      jobId: hearing.jobs[0]._id,
      ok: true,
      result: { segments: SEGMENTS },
    });
    await t.action(internal.disclosure.hear, { runStepId: hearing.step._id });
    await t.action(internal.captionTranslation.translate, {
      runStepId: (await caption(runId)).step._id,
    });
    expect(sent.filter((one) => one.url.includes("/ncat/translate-words"))).toHaveLength(3);
    const { step } = await caption(runId);
    expect(step.status).toBe("failed");
    expect(step.error).toContain("did not translate the captions into Spanish");
  });

  test("a step with no caption language is captioned by the toolkit as before", async () => {
    const { start, caption } = await setUp({});
    stubs();
    const runId = await start(TRIGGER);
    const { step, jobs } = await caption(runId);
    expect(step.stage).toBe("listen");
    expect(jobs[0].stepId).toBe("media-generate-ass");
    expect(jobs[0].input).not.toHaveProperty("caption_language");
  });
});
