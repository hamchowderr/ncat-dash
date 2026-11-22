import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { readHookCall, sameSecret, signCallback } from "./lib/hooks";
import { addPerson, addTeam, backend } from "./test.setup";

type Node = Doc<"automations">["nodes"][number];

// Turned off, so a run needs no toolkit: it hands its files straight on and is done.
const offStep: Node = {
  id: "trim",
  kind: "step",
  stepId: "video-trim",
  input: {},
  position: { x: 0, y: 0 },
  off: true,
};

const TOKEN = "a-long-secret-hook-token";
const FILE = "https://files.example/in/interview.mp4";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function setUp(enabled = true) {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const automationId = await t.run((ctx) =>
    ctx.db.insert("automations", {
      organizationId: team,
      name: "From n8n",
      enabled,
      trigger: { kind: "webhook" },
      nodes: [offStep],
      edges: [],
      hookToken: TOKEN,
      nextRunAt: null,
      createdBy: maya.id,
      updatedAt: Date.now(),
    }),
  );
  const call = (
    body: unknown,
    headers: Record<string, string> = {},
    query = `?id=${automationId}&token=${TOKEN}`,
  ) =>
    t.fetch(`/automations/hook${query}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const runs = () =>
    t.run((ctx) =>
      ctx.db
        .query("runs")
        .withIndex("by_automation", (q) => q.eq("automationId", automationId))
        .collect(),
    );
  return { t, automationId, call, runs };
}

describe("the webhook address", () => {
  test("starts a run with the file and answers with where to read how it went", async () => {
    const { call, runs } = await setUp();
    const response = await call({ file_url: FILE, title: "Episode 4" });
    expect(response.status).toBe(202);
    const answer = (await response.json()) as { run_id: string; status_url: string };
    const [run] = await runs();
    expect(answer.run_id).toBe(run._id);
    expect(answer.status_url).toContain(`/automations/hook/run?`);
    expect(answer.status_url).toContain(`run=${run._id}`);
    expect(run.trigger).toEqual({ file_url: FILE, body: { file_url: FILE, title: "Episode 4" } });
  });

  test("takes the token in a header instead of the address", async () => {
    const { automationId, call, runs } = await setUp();
    const byHeader = await call({}, { "x-takewon-token": TOKEN }, `?id=${automationId}`);
    expect(byHeader.status).toBe(202);
    const byBearer = await call({}, { authorization: `Bearer ${TOKEN}` }, `?id=${automationId}`);
    expect(byBearer.status).toBe(202);
    const wrong = await call({}, { "x-takewon-token": "not-it" }, `?id=${automationId}`);
    expect(wrong.status).toBe(403);
    expect(await runs()).toHaveLength(2);
  });

  test("the same call sent again with its Idempotency-Key starts no second run", async () => {
    const { call, runs } = await setUp();
    const first = await call({ file_url: FILE }, { "idempotency-key": "episode-4" });
    const again = await call({ file_url: FILE }, { "idempotency-key": "episode-4" });
    expect(first.status).toBe(202);
    expect(again.status).toBe(200);
    const [a, b] = (await Promise.all([first.json(), again.json()])) as {
      run_id: string;
      repeat?: boolean;
    }[];
    expect(b).toMatchObject({ run_id: a.run_id, repeat: true });
    expect(await runs()).toHaveLength(1);
    // Another key is another call.
    expect((await call({}, { "idempotency-key": "episode-5" })).status).toBe(202);
    expect(await runs()).toHaveLength(2);
  });

  test("a key older than a day starts a new run", async () => {
    const { t, call, runs } = await setUp();
    await call({}, { "idempotency-key": "weekly" });
    await t.run(async (ctx) => {
      const kept = (await ctx.db.query("hookCalls").first())!;
      await ctx.db.patch(kept._id, { at: Date.now() - 25 * 60 * 60 * 1000 });
    });
    expect((await call({}, { "idempotency-key": "weekly" })).status).toBe(202);
    expect(await runs()).toHaveLength(2);
    await t.mutation(internal.hooks.forgetOldCalls, {});
    expect(await t.run((ctx) => ctx.db.query("hookCalls").collect())).toHaveLength(1);
  });

  test("hands several files to the run", async () => {
    const { call, runs } = await setUp();
    const files = [FILE, "https://files.example/in/broll.mp4"];
    expect((await call({ files })).status).toBe(202);
    const [run] = await runs();
    expect(run.trigger).toMatchObject({ file_url: FILE, files });
  });

  test("says plainly what is wrong with a call it cannot use", async () => {
    const { call, runs } = await setUp();
    const notLinks = await call({ files: ["not a link"] });
    expect(notLinks.status).toBe(422);
    expect(await notLinks.text()).toBe("This is not a link: not a link");
    const badCallback = await call({ callback_url: "ftp://example.com" });
    expect(badCallback.status).toBe(422);
    expect(await runs()).toHaveLength(0);
  });

  test("a switched-off automation starts nothing", async () => {
    const { call } = await setUp(false);
    expect((await call({})).status).toBe(409);
  });
});

describe("how the run went", () => {
  test("its status address says how it went and gives its files, with the token only", async () => {
    const { t, automationId, call } = await setUp();
    const { status_url: statusUrl } = (await (await call({ file_url: FILE })).json()) as {
      status_url: string;
    };
    const path = new URL(statusUrl).pathname + new URL(statusUrl).search;
    const read = await t.fetch(path, { headers: { "x-takewon-token": TOKEN } });
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      automation_id: automationId,
      automation: "From n8n",
      status: "done",
      error: null,
      files: [FILE],
    });
    expect((await t.fetch(path, { headers: { "x-takewon-token": "nope" } })).status).toBe(403);
    expect((await t.fetch(path)).status).toBe(400);
  });

  test("its end is posted, signed, to the callback_url", async () => {
    vi.useFakeTimers();
    const posted: { url: string; body: string; signature: string | null }[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      posted.push({
        url: String(input),
        body: String(init?.body),
        signature: new Headers(init?.headers).get("x-takewon-signature"),
      });
      return new Response(null, { status: 204 });
    });
    const { t, call } = await setUp();
    await call({ file_url: FILE, callback_url: "https://n8n.example/webhook/done" });
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe("https://n8n.example/webhook/done");
    expect(JSON.parse(posted[0].body)).toMatchObject({ status: "done", files: [FILE] });
    expect(posted[0].signature).toBe(`sha256=${await signCallback(posted[0].body, TOKEN)}`);
  });

  test("a callback address that does not answer is tried again, then left", async () => {
    vi.useFakeTimers();
    let tries = 0;
    vi.stubGlobal("fetch", async () => {
      tries++;
      return new Response("down", { status: 503 });
    });
    const { t, call } = await setUp();
    await call({ callback_url: "https://n8n.example/webhook/done" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // The first post and three more tries.
    expect(tries).toBe(4);
  });
});

describe("reading a call", () => {
  test("takes file_url, or url, and leaves out what is not a link", () => {
    expect(readHookCall({ url: FILE })).toEqual({ ok: true, call: { fileUrl: FILE } });
    expect(readHookCall({ file_url: "nope" })).toEqual({ ok: true, call: {} });
  });

  test("compares secrets whatever their length", () => {
    expect(sameSecret(TOKEN, TOKEN)).toBe(true);
    expect(sameSecret("", TOKEN)).toBe(false);
    expect(sameSecret(`${TOKEN}x`, TOKEN)).toBe(false);
    expect(sameSecret(TOKEN.slice(0, -1), TOKEN)).toBe(false);
  });
});

export type { Id };
