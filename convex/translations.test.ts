import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";

/**
 * Translations: a library file's subtitles in another language, made once from the
 * transcript it already has, a batch of lines at a time, each line on its own times.
 */

const AGENT_URL = "https://agent.example";

type Sent = { url: string; body: { lines: string[]; language: string; before: string[] } };

/** A stand-in agent server that "translates" each line by putting the language before it. */
function fakeAgent(answer?: (body: Sent["body"], call: number) => Response) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Sent["body"];
      sent.push({ url, body });
      if (url !== `${AGENT_URL}/ncat/translate`) return new Response("not found", { status: 404 });
      if (answer) return answer(body, sent.length);
      return Response.json({
        answer: JSON.stringify(body.lines.map((line) => `[${body.language}] ${line}`)),
        model: "anthropic/claude-haiku-5-5",
        usage: { inputTokens: 1000, outputTokens: 500 },
      });
    }),
  );
  return sent;
}

beforeEach(() => {
  vi.useFakeTimers();
  process.env.AGENT_URL = AGENT_URL;
  process.env.MASTRA_JWT_SECRET = "a-shared-secret-for-the-agent-server";
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

/** Sentences of words, a word every 0.4 seconds, each ending a cue. */
function said(count: number) {
  const words: { t: string; s: number; e: number }[] = [];
  for (let line = 0; line < count; line++) {
    for (const [index, word] of ["We", "talked", "about", `topic${line}.`].entries()) {
      const s = line * 3 + index * 0.4;
      words.push({ t: word, s, e: s + 0.3 });
    }
  }
  return words;
}

async function setUp(lines = 3, transcript: "ready" | "working" = "ready") {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  const other = await addTeam(t, "Pine Studio");
  const olu = await addPerson(t, "Olu Bello", [other], "owner");
  const itemId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("libraryItems", {
      organizationId: team,
      shortId: "V1",
      kind: "video",
      source: "upload",
      title: "Cafe opening",
      url: "https://files.example/cafe.mp4",
      tags: [],
      searchText: "V1 Cafe opening",
      transcript: { status: transcript, at: 0 },
      createdBy: maya.id,
    });
    const words = said(lines);
    await ctx.db.insert("transcriptPieces", {
      organizationId: team,
      itemId: id,
      start: 0,
      end: lines * 3,
      text: words.map((word) => word.t).join(" "),
      words,
    });
    return id;
  });
  return { t, team, maya, olu, itemId };
}

describe("translating a file", () => {
  test("translates every line once, on the original lines' times", async () => {
    const sent = fakeAgent();
    const { t, maya, itemId } = await setUp(3);
    await maya.as.mutation(api.translations.start, { itemId, language: "es" });
    await settled(t);
    const [spanish] = await maya.as.query(api.translations.list, { itemId });
    expect(spanish).toMatchObject({ language: "es", name: "Spanish", status: "ready", done: 3 });
    expect(spanish!.cues.map((cue) => cue.text)).toEqual([
      "[Spanish] We talked about topic0.",
      "[Spanish] We talked about topic1.",
      "[Spanish] We talked about topic2.",
    ]);
    expect(spanish!.cues[1]!.start).toBe(3);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.lines).toHaveLength(3);

    // Asking again for the same language does not ask the model again.
    await maya.as.mutation(api.translations.start, { itemId, language: "es" });
    await settled(t, 5);
    expect(sent).toHaveLength(1);
    const kept = await t.run((ctx) => ctx.db.query("translations").collect());
    expect(kept).toHaveLength(1);
    expect(kept[0]!.aiSpent).toBeGreaterThan(0);
  });

  test("does a long file in batches, sending the lines just before each batch", async () => {
    const sent = fakeAgent();
    const { t, maya, itemId } = await setUp(250);
    await maya.as.mutation(api.translations.start, { itemId, language: "fr" });
    await settled(t);
    const [french] = await maya.as.query(api.translations.list, { itemId });
    expect(french).toMatchObject({ status: "ready", done: 250, total: 250 });
    expect(sent.length).toBeGreaterThan(1);
    expect(sent[0]!.body.before).toEqual([]);
    expect(sent[1]!.body.before).toHaveLength(3);
    const all = sent.flatMap((one) => one.body.lines);
    expect(all).toHaveLength(250);
  });

  test("asks a batch again when the answer cannot be read, then says it failed", async () => {
    const sent = fakeAgent(() => Response.json({ answer: "Sorry, I cannot.", model: "x" }));
    const { t, maya, itemId } = await setUp(2);
    await maya.as.mutation(api.translations.start, { itemId, language: "de" });
    await settled(t, 60);
    const [german] = await maya.as.query(api.translations.list, { itemId });
    expect(german!.status).toBe("failed");
    expect(german!.error).toContain("could not be read");
    expect(sent).toHaveLength(3);
  });

  test("carries on from the last finished batch when tried again", async () => {
    let fail = false;
    const sent = fakeAgent((body) =>
      fail
        ? new Response("down", { status: 502 })
        : Response.json({ answer: JSON.stringify(body.lines.map((line) => `ok ${line}`)) }),
    );
    const { t, maya, itemId } = await setUp(250);
    await maya.as.mutation(api.translations.start, { itemId, language: "it" });
    // The first batch is answered, then the agent goes down.
    await t.finishInProgressScheduledFunctions();
    vi.advanceTimersByTime(10);
    await t.finishInProgressScheduledFunctions();
    fail = true;
    await settled(t, 60);
    const [failed] = await maya.as.query(api.translations.list, { itemId });
    expect(failed!.status).toBe("failed");
    const doneBefore = failed!.done;
    expect(doneBefore).toBeGreaterThan(0);
    fail = false;
    const asked = sent.length;
    await maya.as.mutation(api.translations.start, { itemId, language: "it" });
    await settled(t);
    const [italian] = await maya.as.query(api.translations.list, { itemId });
    expect(italian).toMatchObject({ status: "ready", done: 250 });
    const again = sent.slice(asked).flatMap((one) => one.body.lines);
    expect(again).toHaveLength(250 - doneBefore);
  });

  test("says the agent is not set up, without asking anything", async () => {
    const sent = fakeAgent();
    delete process.env.AGENT_URL;
    const { t, maya, itemId } = await setUp(2);
    await maya.as.mutation(api.translations.start, { itemId, language: "ja" });
    await settled(t, 5);
    const [japanese] = await maya.as.query(api.translations.list, { itemId });
    expect(japanese!.status).toBe("failed");
    expect(japanese!.error).toContain("AGENT_URL");
    expect(sent).toHaveLength(0);
  });

  test("refuses a language not on the list, a file not transcribed yet, and another team", async () => {
    fakeAgent();
    const { maya, olu, itemId } = await setUp(2);
    await expect(
      maya.as.mutation(api.translations.start, { itemId, language: "klingon" }),
    ).rejects.toThrow(/Pick a language/);
    await expect(
      olu.as.mutation(api.translations.start, { itemId, language: "es" }),
    ).rejects.toThrow(/not on this team/);
    await expect(olu.as.query(api.translations.list, { itemId })).rejects.toThrow(
      /not on this team/,
    );
    const working = await setUp(2, "working");
    await expect(
      working.maya.as.mutation(api.translations.start, { itemId: working.itemId, language: "es" }),
    ).rejects.toThrow(/once what was said/);
  });
});

describe("after translating", () => {
  async function translated() {
    fakeAgent();
    const set = await setUp(2);
    await set.maya.as.mutation(api.translations.start, { itemId: set.itemId, language: "es" });
    await settled(set.t);
    const [spanish] = await set.maya.as.query(api.translations.list, { itemId: set.itemId });
    return { ...set, translationId: spanish!._id as Id<"translations"> };
  }

  test("a line can be corrected by hand and keeps its times", async () => {
    const { maya, itemId, translationId } = await translated();
    await maya.as.mutation(api.translations.fixLine, {
      translationId,
      index: 1,
      text: "  Hablamos del tema uno.  ",
    });
    const [spanish] = await maya.as.query(api.translations.list, { itemId });
    expect(spanish!.cues[1]).toMatchObject({ start: 3, text: "Hablamos del tema uno." });
    await expect(
      maya.as.mutation(api.translations.fixLine, { translationId, index: 9, text: "x" }),
    ).rejects.toThrow(/not here/);
  });

  test("a new transcript of the file drops its translations, and so does removing one", async () => {
    const { t, maya, itemId, translationId } = await translated();
    await maya.as.mutation(api.translations.remove, { translationId });
    expect(await maya.as.query(api.translations.list, { itemId })).toEqual([]);

    await maya.as.mutation(api.translations.start, { itemId, language: "es" });
    await settled(t);
    expect(await maya.as.query(api.translations.list, { itemId })).toHaveLength(1);
    await t.run(async (ctx) => {
      const { deletePieces } = await import("./lib/library");
      await deletePieces(ctx, itemId);
    });
    expect(await t.run((ctx) => ctx.db.query("translations").collect())).toEqual([]);
  });
});
