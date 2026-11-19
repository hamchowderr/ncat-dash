import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/crypto";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

const TOOLKIT = "https://toolkit.example";
const AGENT_URL = "https://agent.example";
const FILE = "https://files.example/uploads/podcast.mp4?X-Amz-Signature=first";
const WORDS_FILE = "https://files.example/out/podcast-words.json";

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
  "Welcome back to the show.",
  "Today we talk about pricing your creative work.",
  "Most creators charge far too little for what they do and it hurts them.",
  "Here is the one rule I follow every single time a client asks.",
  "Never quote a price on the first call because you do not know the job yet.",
  "Instead you ask what success looks like for them in six months.",
  "Thanks for listening and see you next week.",
];
const SEGMENTS = segmentsOf(SENTENCES);

type Sent = { url: string; body: Record<string, unknown> };

/** Where a /v1/ffmpeg/compose request starts its clip, from its -ss option. */
function clipStart(body: Record<string, unknown>): number {
  const inputs = body.inputs as { options?: { option: string; argument?: unknown }[] }[];
  const seek = inputs?.[0]?.options?.find((one) => one.option === "-ss");
  return Number(seek?.argument ?? 0);
}

const clipUrl = (start: number) => `https://files.example/out/moment-at-${start}.mp4`;

/**
 * A stand-in toolkit that answers each job straight away, and a stand-in agent server
 * whose answers come from `answer` in turn, one per question.
 */
function fakeServers(
  answers: unknown[],
  batches?: (path: string, body: Record<string, unknown>) => Response,
) {
  const sent: Sent[] = [];
  let asked = 0;
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
        return done({ duration: 40, width: 1920, height: 1080, fps: 30, has_audio: true });
      }
      if (url.endsWith("/v1/media/transcribe")) {
        return done({ text: null, srt: null, segments: null, segments_url: WORDS_FILE });
      }
      if (url.endsWith("/v1/ffmpeg/compose")) {
        // Named by where the clip starts, so the name does not depend on which job is sent first.
        return done([{ file_url: clipUrl(clipStart(body)) }]);
      }
      if (url.startsWith(`${AGENT_URL}/ncat/moments/batch`)) {
        return batches
          ? batches(url.slice(AGENT_URL.length), body)
          : new Response(JSON.stringify({ error: "cannot batch" }), { status: 409 });
      }
      if (url === `${AGENT_URL}/ncat/moments`) {
        const answer = answers[Math.min(asked++, answers.length - 1)];
        return new Response(JSON.stringify(typeof answer === "string" ? { answer } : answer), {
          status: 200,
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
  delete process.env.AGENT_URL;
  delete process.env.MASTRA_JWT_SECRET;
});

/**
 * Lets the scheduled work play out a second at a time, so each job is sent long before the
 * time it would be given up on, as on a real deployment.
 */
async function settled(t: ReturnType<typeof backend>, seconds = 60) {
  for (let second = 0; second < seconds; second++) {
    vi.advanceTimersByTime(1000);
    await t.finishInProgressScheduledFunctions();
  }
}

type Node = { id: string; kind: string; stepId?: string; input: Record<string, unknown> };

async function setUp(nodes: Node[], agent = true) {
  process.env.CONNECTIONS_SECRET ??= "a-test-secret-that-is-long-enough-1234";
  process.env.CONVEX_SITE_URL = "https://dash.example";
  if (agent) {
    process.env.AGENT_URL = AGENT_URL;
    process.env.MASTRA_JWT_SECRET = "a-shared-secret-for-the-agent-server";
  }
  const apiKeyCipher = await encryptSecret("toolkit-key");
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
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
    await ctx.db.insert("teamSettings", {
      organizationId: team,
      maxParallelJobs: 4,
      agent: { model: null, houseRules: "Never all capitals.", platforms: [] },
    } as never);
    return await ctx.db.insert("automations", {
      organizationId: team,
      name: "Podcast clips",
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
  // A run a person started, or with `byTrigger`, one nobody is watching.
  const start = (file = FILE, byTrigger = false) =>
    t.run(async (ctx) => {
      const automation = (await ctx.db.get(automationId))!;
      const started = await startRun(
        ctx,
        automation,
        "webhook",
        { file_url: file },
        byTrigger ? null : maya.id,
      );
      if (!started.ok) throw new Error(started.message);
      return started.runId;
    });
  const runOf = (runId: Id<"runs">) => maya.as.query(api.runs.get, { runId });
  return { t, team, maya, start, runOf };
}

const momentsNode = (input: Record<string, unknown> = {}): Node => ({
  id: "moments",
  kind: "moments",
  input: { platform: "TikTok", count: 2, minSeconds: 3, maxSeconds: 30, ...input },
});

const answerWith = (...quotes: string[]) =>
  JSON.stringify({
    moments: quotes.map((quote, index) => ({ quote, title: `Moment ${index + 1}`, why: "Lands." })),
  });

describe("Best moments", () => {
  test("transcribes with word timings, asks the model, and cuts each moment on whole sentences", async () => {
    const sent = fakeServers([
      answerWith(
        "Never quote a price on the first call",
        "this was never said in the show",
        "Most creators charge far too little",
      ),
    ]);
    const { t, start, runOf } = await setUp([momentsNode({ padding: 0.2 })]);
    const runId = await start();
    await settled(t);

    const run = (await runOf(runId))!;
    expect(run.status).toBe("done");
    const step = run.steps.find((one) => one.nodeId === "moments")!;
    expect(step.moments?.map((moment) => moment.title)).toEqual(["Moment 1", "Moment 3"]);
    // The quote was part of a sentence: the clip has the whole sentence.
    expect(step.moments?.[0].text).toBe(SENTENCES[4]);
    expect(step.pickNote).toBe(
      "1 pick was left out: 1 did not match the transcript word for word.",
    );
    // One clip per moment, in the order of the moments.
    expect(step.outputs).toEqual(step.moments!.map((one) => clipUrl(one.start)));

    // The transcript was asked for with each word's timing, as a file.
    const transcribe = sent.find((one) => one.url.endsWith("/v1/media/transcribe"))!;
    expect(transcribe.body).toMatchObject({
      word_timestamps: true,
      include_segments: true,
      response_type: "cloud",
    });
    // The model got the transcript with times, the settings and the house rules.
    const question = sent.find((one) => one.url === `${AGENT_URL}/ncat/moments`)!;
    expect(question.body).toMatchObject({
      kind: "moments",
      settings: { count: 2, minSeconds: 3, maxSeconds: 30, platform: "TikTok" },
      houseRules: "Never all capitals.",
      avoid: [],
    });
    expect(String(question.body.transcript)).toContain("[0:01] Welcome back to the show.");
    // The team goes with it, so its own Anthropic key is used when it has one.
    expect(typeof question.body.organizationId).toBe("string");

    // Each cut starts in the gap before the sentence's first word and ends in the gap after
    // its last, never inside a word.
    const cuts = sent.filter((one) => one.url.endsWith("/v1/ffmpeg/compose"));
    expect(cuts).toHaveLength(2);
    const words = SEGMENTS.flatMap((segment) => segment.words);
    const first = words.findIndex((word) => word.word === " Never");
    const moment = step.moments![0];
    expect(moment.start).toBeCloseTo(words[first].start - 0.2, 3);
    expect(moment.start).toBeGreaterThanOrEqual(words[first - 1].end);
    expect(run.hasCuts).toBe(true);
  });

  test("finding more on the same video skips what was picked and does not transcribe it again", async () => {
    const sent = fakeServers([
      answerWith("Never quote a price on the first call", "Most creators charge far too little"),
      answerWith(
        "Never quote a price on the first call",
        "Instead you ask what success looks like",
        "Here is the one rule I follow",
      ),
    ]);
    const { t, start, runOf, maya } = await setUp([momentsNode()]);
    const first = await start();
    await settled(t);
    // Find more moments runs it again, with a fresh link to the same file.
    const again = await maya.as.mutation(api.runs.runAgain, { runId: first });
    await settled(t);

    const run = (await runOf(again))!;
    expect(run.status).toBe("done");
    const step = run.steps.find((one) => one.nodeId === "moments")!;
    expect(step.moments?.map((moment) => moment.text)).toEqual([SENTENCES[5], SENTENCES[3]]);
    expect(step.pickNote).toBe("1 pick was left out: 1 overlapped another moment.");
    expect(sent.filter((one) => one.url.endsWith("/v1/media/transcribe"))).toHaveLength(1);
    const questions = sent.filter((one) => one.url === `${AGENT_URL}/ncat/moments`);
    expect((questions[1].body.avoid as unknown[]).length).toBe(2);
  });

  test("a fresh signed link to the same file still counts as the same video", async () => {
    const sent = fakeServers([answerWith("Never quote a price on the first call")]);
    const { t, start } = await setUp([momentsNode()]);
    await start();
    await settled(t);
    await start("https://files.example/uploads/podcast.mp4?X-Amz-Signature=second");
    await settled(t);
    expect(sent.filter((one) => one.url.endsWith("/v1/media/transcribe"))).toHaveLength(1);
  });

  test("fails in plain words when no pick could be used", async () => {
    fakeServers([answerWith("words that were never said at all")]);
    const { t, start, runOf } = await setUp([momentsNode()]);
    const runId = await start();
    await settled(t);
    const run = (await runOf(runId))!;
    expect(run.status).toBe("failed");
    expect(run.steps[0].error).toBe(
      "No moment could be used. 1 pick was left out: 1 did not match the transcript word for word. Moments already picked from this video are skipped.",
    );
  });

  test("says what to set when the agent is not set up", async () => {
    fakeServers([]);
    const { t, start, runOf } = await setUp([momentsNode()], false);
    const runId = await start();
    await settled(t);
    const run = (await runOf(runId))!;
    expect(run.status).toBe("failed");
    expect(run.steps[0].error).toMatch(/AGENT_URL and MASTRA_JWT_SECRET/);
  });

  test("needs a platform before it starts", async () => {
    fakeServers([]);
    const { t, start, runOf } = await setUp([{ id: "moments", kind: "moments", input: {} }]);
    const runId = await start();
    await settled(t);
    expect((await runOf(runId))!.steps[0].error).toBe("Pick a platform for the clips.");
  });

  test("hands its moments to Follow the speaker in the video's own shape", async () => {
    const sent = fakeServers([answerWith("Never quote a price on the first call")]);
    const { t, start } = await setUp([
      momentsNode(),
      { id: "follow_1", kind: "step", stepId: "video-reframe", input: {} },
    ]);
    await start();
    await settled(t);
    const cut = sent.find((one) => one.url.endsWith("/v1/ffmpeg/compose"))!;
    expect(JSON.stringify(cut.body)).not.toContain("1080:1920");
  });
});

describe("Chapters and show notes", () => {
  test("places each chapter at the start of a sentence and hands the video on", async () => {
    fakeServers([
      JSON.stringify({
        chapters: [
          { title: "Welcome", opening: "Welcome back to the show", bullets: ["Hello"] },
          {
            title: "The rule",
            opening: "the one rule I follow",
            bullets: ["No price on call one"],
          },
          { title: "Invented", opening: "nobody said this", bullets: [] },
        ],
      }),
    ]);
    const { t, start, runOf } = await setUp([
      { id: "chapters", kind: "chapters", input: { bullets: 2 } },
    ]);
    const runId = await start();
    await settled(t);
    const run = (await runOf(runId))!;
    expect(run.status).toBe("done");
    const step = run.steps[0];
    const words = SEGMENTS.flatMap((segment) => segment.words);
    const here = words.find((word) => word.word === " Here")!;
    expect(step.chapters?.map((chapter) => [chapter.title, chapter.start])).toEqual([
      ["Welcome", 0],
      ["The rule", here.start],
    ]);
    expect(step.pickNote).toMatch(/^1 chapter was left out/);
    expect(step.outputs).toEqual([FILE]);
  });
});

describe("what a pick costs", () => {
  const chaptersAnswer = JSON.stringify({
    chapters: [{ title: "Welcome", opening: "Welcome back to the show", bullets: [] }],
  });
  const chaptersNode: Node = { id: "chapters", kind: "chapters", input: { bullets: 0 } };
  const live = (sent: Sent[]) => sent.filter((one) => one.url === `${AGENT_URL}/ncat/moments`);

  test("the same question again is answered from the saved answer, not the model", async () => {
    const sent = fakeServers([chaptersAnswer]);
    const { t, start, runOf } = await setUp([chaptersNode]);
    await start();
    await settled(t);
    const again = await start("https://files.example/uploads/podcast.mp4?X-Amz-Signature=second");
    await settled(t);
    expect((await runOf(again))!.status).toBe("done");
    expect(live(sent)).toHaveLength(1);
  });

  test("different settings are a different question", async () => {
    const sent = fakeServers([chaptersAnswer]);
    const { t, start, team } = await setUp([chaptersNode]);
    await start();
    await settled(t);
    await t.run(async (ctx) => {
      const settings = (await ctx.db.query("teamSettings").first())!;
      await ctx.db.patch(settings._id, {
        agent: { model: null, houseRules: "Short titles.", platforms: [] },
      } as never);
      expect(settings.organizationId).toBe(team);
    });
    await start();
    await settled(t);
    expect(live(sent)).toHaveLength(2);
  });

  test("a run nobody is watching sends its questions as one batch and picks once answered", async () => {
    let checks = 0;
    let submitted: { id: string }[] = [];
    const sent = fakeServers([], (path, body) => {
      if (path === "/ncat/moments/batch") {
        submitted = body.requests as { id: string }[];
        return new Response(JSON.stringify({ batchId: "msgbatch_1" }), { status: 200 });
      }
      expect(body).toEqual({ batchId: "msgbatch_1", organizationId: expect.any(String) });
      checks++;
      return new Response(
        JSON.stringify(
          checks < 2
            ? { pending: true }
            : { answers: submitted.map(({ id }) => ({ id, answer: chaptersAnswer })) },
        ),
        { status: 200 },
      );
    });
    const { t, start, runOf } = await setUp([chaptersNode]);
    const runId = await start(FILE, true);
    await settled(t, 30);
    expect((await runOf(runId))!.status).toBe("running");
    await settled(t, 240);

    const run = (await runOf(runId))!;
    expect(run.status).toBe("done");
    expect(run.steps[0].chapters?.map((chapter) => chapter.title)).toEqual(["Welcome"]);
    expect(submitted).toHaveLength(1);
    expect(checks).toBe(2);
    expect(live(sent)).toHaveLength(0);
    // Nothing is left waiting.
    expect(await t.run((ctx) => ctx.db.query("pickBatches").collect())).toEqual([]);
  });

  test("asks straight away when the agent server cannot batch", async () => {
    const sent = fakeServers([chaptersAnswer]);
    const { t, start, runOf } = await setUp([chaptersNode]);
    const runId = await start(FILE, true);
    await settled(t);
    expect((await runOf(runId))!.status).toBe("done");
    expect(live(sent)).toHaveLength(1);
  });

  test("a question the batch could not answer is asked the usual way", async () => {
    const sent = fakeServers([chaptersAnswer], (path, body) =>
      path === "/ncat/moments/batch"
        ? new Response(JSON.stringify({ batchId: "msgbatch_2" }), { status: 200 })
        : new Response(
            JSON.stringify({
              answers: [{ id: String(body.batchId), error: "errored" }],
            }),
            { status: 200 },
          ),
    );
    const { t, start, runOf } = await setUp([chaptersNode]);
    const runId = await start(FILE, true);
    await settled(t, 120);
    expect((await runOf(runId))!.status).toBe("done");
    expect(live(sent)).toHaveLength(1);
  });

  test("a run a person started is never batched", async () => {
    let batched = 0;
    const sent = fakeServers([chaptersAnswer], () => {
      batched++;
      return new Response(JSON.stringify({ batchId: "msgbatch_3" }), { status: 200 });
    });
    const { t, start } = await setUp([chaptersNode]);
    await start();
    await settled(t);
    expect(batched).toBe(0);
    expect(live(sent)).toHaveLength(1);
  });
});
