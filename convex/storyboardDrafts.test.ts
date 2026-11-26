import { afterEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";

/** Words said one after another from `from`, a word every 0.4 s, as a transcript keeps them. */
const said = (text: string, from: number) =>
  text.split(" ").map((t, index) => ({ t, s: from + index * 0.4, e: from + index * 0.4 + 0.32 }));

const RECORDING = [
  { start: 0, text: "Welcome to the course." },
  { start: 2.5, text: "So the first thing you do" },
  { start: 5.5, text: "So the first thing you do is open the folder." },
  { start: 15, text: "Step two is the upload." },
  { start: 17.5, text: "It takes a minute." },
];

async function studio() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  const olu = await addPerson(t, "Olu Bello", [await addTeam(t, "Pine Studio")], "owner");

  /** An upload with its transcript in, the words of RECORDING said in it. */
  const transcribed = async (title: string, extra: Record<string, unknown> = {}) =>
    await t.run(async (ctx) => {
      const uploadId = await ctx.db.insert("uploads", {
        organizationId: team,
        key: `uploads/${title}`,
        fileName: title,
        contentType: "video/mp4",
        size: 10,
        status: "ready",
        createdBy: maya.id,
      });
      const itemId = await ctx.db.insert("libraryItems", {
        organizationId: team,
        kind: "video",
        source: "upload",
        title,
        key: `uploads/${title}`,
        uploadId,
        shortId: title,
        tags: [],
        searchText: title,
        createdBy: maya.id,
        details: { duration: 30, width: 1080, height: 1920 },
        transcript: { status: "ready", at: 1 },
        ...extra,
      });
      for (const piece of RECORDING) {
        const words = said(piece.text, piece.start);
        await ctx.db.insert("transcriptPieces", {
          organizationId: team,
          itemId,
          start: piece.start,
          end: words[words.length - 1]!.e,
          text: piece.text,
          words,
        });
      }
      return { itemId, uploadId };
    });

  const draft = (libraryItemId: Id<"libraryItems">) =>
    maya.as.query(api.storyboards.forUpload, { libraryItemId });
  return { t, team, maya, olu, transcribed, draft };
}

describe("every upload gets a storyboard drafted from what was said", () => {
  test("a line per sentence with its own clip, the retake left out, chapters, Full Screen", async () => {
    const { t, maya, transcribed, draft } = await studio();
    const { itemId, uploadId } = await transcribed("lesson.mp4");
    // The file's page says the storyboard is still being drafted, then that it is in.
    expect(await maya.as.query(api.library.get, { itemId })).toMatchObject({
      storyboardDrafted: false,
    });
    await t.mutation(internal.storyboards.draftForUpload, { itemId });
    expect(await maya.as.query(api.library.get, { itemId })).toMatchObject({
      storyboardDrafted: true,
    });

    const board = (await draft(itemId))!;
    expect(board.libraryItemId).toBe(itemId);
    expect(board.projectId).toBeNull();
    expect(board.aspect).toBe("9:16");
    expect(board.source).toBe("Drafted from lesson.mp4");
    expect(board.chapters.map((chapter) => chapter.title)).toEqual([
      "Welcome to the course",
      "Step two is the upload",
    ]);
    const takes = board.chapters.flatMap((chapter) => chapter.takes);
    expect(takes.map((take) => take.line)).toEqual([
      "Welcome to the course.",
      "So the first thing you do is open the folder.",
      "Step two is the upload.",
      "It takes a minute.",
    ]);
    expect(takes.every((take) => take.scene === "full")).toBe(true);
    expect(takes.map((take) => take.number)).toEqual([1, 2, 3, 4]);
    // Each line plays just its own stretch of the upload, so the take is already in.
    expect(takes[1]!.files.you).toBe(`upload:${uploadId}#t=5.42,9.57`);
    expect(takes.every((take) => take.status.tone === "done")).toBe(true);
  });

  test("starts once the transcript is saved, and an upload keeps the draft it has", async () => {
    vi.useFakeTimers();
    try {
      const { t, team, maya, transcribed, draft } = await studio();
      const { itemId } = await transcribed("call.mp4", { transcript: undefined });
      const jobId = await t.run(async (ctx) => {
        const connectionId = await ctx.db.insert("toolkitConnections", {
          organizationId: team,
          baseUrl: "https://toolkit.example",
          apiKeyCipher: "x",
          apiKeyHint: "abcd",
          status: "ok",
          buildNumber: null,
          lastCheckedAt: 0,
          lastError: null,
          createdBy: maya.id,
        });
        const jobId = await ctx.db.insert("jobs", {
          organizationId: team,
          connectionId,
          stepId: "media-transcribe",
          input: {},
          status: "running",
          webhookToken: "token",
          toolkitJobId: null,
          outputs: [],
          error: null,
          createdBy: maya.id,
          startedAt: null,
          finishedAt: null,
        });
        await ctx.db.patch(itemId, { transcript: { status: "working", jobId, at: 1 } });
        return jobId;
      });
      expect(await draft(itemId)).toBeNull();
      await t.mutation(internal.library.saveTranscript, {
        itemId,
        jobId,
        ok: true,
        pieces: [
          { start: 0, end: 1.5, text: "Hello and welcome.", words: said("Hello and welcome.", 0) },
        ],
      });
      await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10));
      const board = (await draft(itemId))!;
      expect(board.chapters[0]!.takes.map((take) => take.line)).toEqual(["Hello and welcome."]);

      // Drafting again on its own leaves the team's changes alone.
      await maya.as.mutation(api.storyboards.renameChapter, {
        chapterId: board.chapters[0]!._id,
        title: "Opening",
      });
      await t.mutation(internal.storyboards.draftForUpload, { itemId });
      expect((await draft(itemId))!.chapters[0]!.title).toBe("Opening");
    } finally {
      vi.useRealTimers();
    }
  });

  test("can be drafted again from the transcript, in place of the one there", async () => {
    const { t, maya, transcribed, draft } = await studio();
    const { itemId } = await transcribed("lesson.mp4");
    await t.mutation(internal.storyboards.draftForUpload, { itemId });
    const before = (await draft(itemId))!;
    await maya.as.mutation(api.storyboards.renameChapter, {
      chapterId: before.chapters[0]!._id,
      title: "Opening",
    });
    await maya.as.mutation(api.storyboards.draftAgain, { libraryItemId: itemId });
    expect((await draft(itemId))!.chapters[0]!.title).toBe("Welcome to the course");
  });

  test("uploads transcribed before drafts existed catch up, once", async () => {
    vi.useFakeTimers();
    try {
      const { t, team, maya, transcribed, draft } = await studio();
      const one = await transcribed("one.mp4");
      const two = await transcribed("two.mp4");
      const waiting = await transcribed("three.mp4", { transcript: { status: "working", at: 1 } });
      expect(await maya.as.mutation(api.storyboards.catchUpDrafts, { organizationId: team })).toBe(
        2,
      );
      await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1_000));
      expect(await draft(one.itemId)).not.toBeNull();
      expect(await draft(two.itemId)).not.toBeNull();
      expect(await draft(waiting.itemId)).toBeNull();
      expect(await maya.as.mutation(api.storyboards.catchUpDrafts, { organizationId: team })).toBe(
        0,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test("goes with the upload when the upload is removed", async () => {
    const { t, maya, transcribed } = await studio();
    const { itemId } = await transcribed("lesson.mp4");
    await t.mutation(internal.storyboards.draftForUpload, { itemId });
    await maya.as.mutation(api.library.remove, { itemId });
    const left = await t.run(async (ctx) => ({
      boards: await ctx.db.query("storyboards").collect(),
      takes: await ctx.db.query("storyboardTakes").collect(),
    }));
    expect(left).toEqual({ boards: [], takes: [] });
  });

  test("another team cannot read it or catch it up", async () => {
    const { t, team, olu, transcribed } = await studio();
    const { itemId } = await transcribed("lesson.mp4");
    await t.mutation(internal.storyboards.draftForUpload, { itemId });
    expect(await olu.as.query(api.storyboards.forUpload, { libraryItemId: itemId })).toBeNull();
    expect(await olu.as.query(api.storyboards.uploadDrafts, { organizationId: team })).toEqual([]);
    await expect(
      olu.as.mutation(api.storyboards.catchUpDrafts, { organizationId: team }),
    ).rejects.toThrow();
    await expect(
      olu.as.mutation(api.storyboards.draftAgain, { libraryItemId: itemId }),
    ).rejects.toThrow();
  });
});

describe("a project gathers the drafts of several uploads", () => {
  test("their chapters join the project's storyboard in turn, with their clips", async () => {
    const { t, team, maya, olu, transcribed } = await studio();
    const first = await transcribed("part one.mp4");
    const second = await transcribed("part two.mp4");
    for (const one of [first, second]) {
      await t.mutation(internal.storyboards.draftForUpload, { itemId: one.itemId });
    }
    const projectId = await maya.as.mutation(api.projects.create, {
      organizationId: team,
      name: "The course",
      package: "blank",
    });
    expect(
      (await maya.as.query(api.storyboards.uploadDrafts, { organizationId: team })).map(
        (draft) => draft.title,
      ),
    ).toEqual(["part two.mp4", "part one.mp4"]);

    expect(
      await maya.as.mutation(api.storyboards.gatherUploadDraft, {
        projectId,
        libraryItemId: first.itemId,
      }),
    ).toEqual({ chapters: 2, takes: 4 });
    await maya.as.mutation(api.storyboards.gatherUploadDraft, {
      projectId,
      libraryItemId: second.itemId,
    });
    const board = (await maya.as.query(api.storyboards.get, { projectId }))!;
    expect(board.aspect).toBe("9:16");
    expect(board.source).toBe("Gathered from part one.mp4");
    expect(board.chapters).toHaveLength(4);
    expect(board.takeCount).toBe(8);
    expect(board.chapters[2]!.takes[0]!.files.you).toContain(`upload:${second.uploadId}#t=`);
    expect(board.chapters.flatMap((chapter) => chapter.takes).map((take) => take.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);

    await expect(
      olu.as.mutation(api.storyboards.gatherUploadDraft, {
        projectId,
        libraryItemId: first.itemId,
      }),
    ).rejects.toThrow();
  });

  test("an empty storyboard just started gives its blank chapter up to the draft", async () => {
    const { t, team, maya, transcribed } = await studio();
    const { itemId } = await transcribed("lesson.mp4");
    await t.mutation(internal.storyboards.draftForUpload, { itemId });
    const projectId = await maya.as.mutation(api.projects.create, {
      organizationId: team,
      name: "The course",
      package: "blank",
    });
    await maya.as.mutation(api.storyboards.create, { projectId });
    await maya.as.mutation(api.storyboards.gatherUploadDraft, { projectId, libraryItemId: itemId });
    const board = (await maya.as.query(api.storyboards.get, { projectId }))!;
    expect(board.chapters.map((chapter) => chapter.title)).toEqual([
      "Welcome to the course",
      "Step two is the upload",
    ]);
  });
});

describe("suggesting scenes", () => {
  const AGENT_URL = "https://agent.example";

  function agentAnswers(answer: unknown, status = 200) {
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) !== `${AGENT_URL}/ncat/scenes`) return new Response("", { status: 404 });
        sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify(answer), { status });
      }),
    );
    return sent;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AGENT_URL;
    delete process.env.MASTRA_JWT_SECRET;
  });

  async function drafted() {
    const studied = await studio();
    const { itemId } = await studied.transcribed("lesson.mp4");
    const storyboardId = (await studied.t.mutation(internal.storyboards.draftForUpload, {
      itemId,
    }))!;
    return { ...studied, itemId, storyboardId };
  }

  test("asks once with the numbered lines and puts in the scenes and names it can read", async () => {
    process.env.AGENT_URL = AGENT_URL;
    process.env.MASTRA_JWT_SECRET = "a-shared-secret-for-the-agent-server";
    const { maya, itemId, storyboardId, draft } = await drafted();
    const sent = agentAnswers({
      answer:
        "Here you go:\n```json\n" +
        JSON.stringify({
          chapters: [{ title: "Why this course" }, { title: "Chapter 2: Uploading" }],
          scenes: [
            { n: 2, scene: "Panel" },
            { n: 3, scene: "graphic" },
            { n: 99, scene: "panel" },
            { n: 4, scene: "spinning cube" },
          ],
        }) +
        "\n```",
    });
    expect(await maya.as.action(api.storyboards.suggestScenes, { storyboardId })).toEqual({
      scenes: 2,
      titles: 2,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      name: "Drafted from lesson.mp4",
      aspect: "9:16",
      chapters: [
        {
          title: "Welcome to the course",
          lines: [
            { n: 1, line: "Welcome to the course." },
            { n: 2, line: "So the first thing you do is open the folder." },
          ],
        },
        { title: "Step two is the upload" },
      ],
    });
    const board = (await draft(itemId))!;
    expect(board.chapters.map((chapter) => chapter.title)).toEqual([
      "Why this course",
      "Uploading",
    ]);
    const takes = board.chapters.flatMap((chapter) => chapter.takes);
    expect(takes.map((take) => take.scene)).toEqual(["full", "panel", "graphic", "full"]);
    // A scene other than Full Screen needs a graphic; the take's clip stays.
    expect(takes[1]!.parts).toEqual(["you", "graphic"]);
    expect(takes[1]!.status.label).toBe("Needs a graphic");
    expect(takes[1]!.files.you).toContain("#t=");
  });

  test("follows the brief of the video it was drafted from", async () => {
    process.env.AGENT_URL = AGENT_URL;
    process.env.MASTRA_JWT_SECRET = "a-shared-secret-for-the-agent-server";
    const { maya, itemId, storyboardId } = await drafted();
    const sent = agentAnswers({ answer: JSON.stringify({ chapters: [], scenes: [] }) });
    await maya.as.action(api.storyboards.suggestScenes, { storyboardId });
    expect(sent[0]).not.toHaveProperty("brief");
    await maya.as.mutation(api.library.setBrief, { itemId, brief: "Mostly screen, little face." });
    await maya.as.action(api.storyboards.suggestScenes, { storyboardId });
    expect(sent[1]?.brief).toBe("Mostly screen, little face.");
  });

  test("says plainly when the agent is not set up or does not answer", async () => {
    const { maya, storyboardId } = await drafted();
    await expect(maya.as.action(api.storyboards.suggestScenes, { storyboardId })).rejects.toThrow(
      /AGENT_URL/,
    );
    process.env.AGENT_URL = AGENT_URL;
    process.env.MASTRA_JWT_SECRET = "a-shared-secret-for-the-agent-server";
    agentAnswers({ error: "The model did not answer." }, 502);
    await expect(maya.as.action(api.storyboards.suggestScenes, { storyboardId })).rejects.toThrow(
      /did not answer/,
    );
  });

  test("another team cannot ask", async () => {
    process.env.AGENT_URL = AGENT_URL;
    process.env.MASTRA_JWT_SECRET = "a-shared-secret-for-the-agent-server";
    const { olu, storyboardId } = await drafted();
    const sent = agentAnswers({ answer: "{}" });
    await expect(olu.as.action(api.storyboards.suggestScenes, { storyboardId })).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });
});
