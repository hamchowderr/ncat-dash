import { describe, expect, test } from "vitest";

import { LESSON_STORYBOARD } from "../e2e/fixtures/lesson-storyboard";
import { api } from "./_generated/api";
import {
  aboutLength,
  partsForScene,
  readSceneAnswer,
  readScript,
  statusOf,
  writeScript,
} from "./lib/storyboard";
import { addPerson, addTeam, backend } from "./test.setup";

async function lesson(script: string | undefined = LESSON_STORYBOARD) {
  const t = backend();
  const team = await addTeam(t, "Otaku");
  const owner = await addPerson(t, "Chowderr", [team], "owner");
  const member = await addPerson(t, "Dev Patel", [team]);
  const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
  const projectId = await member.as.mutation(api.projects.create, {
    organizationId: team,
    name: "Part 1: AnyPress",
    package: "blank",
  });
  const storyboardId = await member.as.mutation(api.storyboards.create, {
    projectId,
    script,
    source: "From the page AI-Assisted Development, Part 1",
    cuts: [{ what: "Full lesson", where: "YouTube · 16:9 · about 16 min" }],
  });
  const board = async () => (await member.as.query(api.storyboards.get, { projectId }))!;
  return { t, team, owner, member, outsider, projectId, storyboardId, board };
}

describe("reading a storyboard written as text", () => {
  test("chapters start at ## lines and each tagged line is a take you say", () => {
    const script = readScript(
      [
        "## 1. Cold open",
        "[Full Screen · You] I've never known how to code.",
        "[Panel · Graphic] This is how the work is set up.",
        "",
        "## Rules",
        "L14. [Circle · Page recording] Three of the rules.",
        "- A line with no tag at all.",
        "[Full Graphic · Graphic · No voice] 6 October: Claude reads the plugins.",
        "[Centre · Your screen · Graphic] Separate threads run side by side.",
      ].join("\n"),
    );
    expect(script.chapters.map((chapter) => chapter.title)).toEqual(["Cold open", "Rules"]);
    expect(script.chapters[0].takes).toEqual([
      { line: "I've never known how to code.", scene: "full", parts: ["you"] },
      { line: "This is how the work is set up.", scene: "panel", parts: ["you", "graphic"] },
    ]);
    expect(script.chapters[1].takes).toEqual([
      { line: "Three of the rules.", scene: "circle", parts: ["you", "recording"] },
      { line: "A line with no tag at all.", scene: "full", parts: ["you"] },
      { line: "6 October: Claude reads the plugins.", scene: "graphic", parts: ["graphic"] },
      {
        line: "Separate threads run side by side.",
        scene: "centre",
        parts: ["you", "graphic", "screen"],
      },
    ]);
  });

  test("lines before any heading go in a first chapter, and empty chapters are dropped", () => {
    const script = readScript("Hello there.\n## Nothing here\n## Second\nOne more line.");
    expect(script.chapters.map((chapter) => [chapter.title, chapter.takes.length])).toEqual([
      ["Chapter 1", 1],
      ["Second", 1],
    ]);
  });

  test("writing it back gives text that reads the same", () => {
    const script = readScript(LESSON_STORYBOARD);
    expect(script.chapters).toHaveLength(15);
    expect(readScript(writeScript(script))).toEqual(script);
  });

  test("a take's status names what is still missing, yours first", () => {
    expect(statusOf(["you"], {})).toEqual({
      label: "Waiting for your take",
      tone: "waiting",
      missing: ["you"],
    });
    expect(statusOf(["you", "graphic", "screen"], { you: "https://f/x.mp4" }).label).toBe(
      "Needs your screen",
    );
    expect(statusOf(["you", "graphic"], { you: "https://f/x.mp4" })).toMatchObject({
      label: "Needs a graphic",
      tone: "todo",
    });
    expect(statusOf(["you"], { you: "https://f/x.mp4" }).label).toBe("Take in");
    expect(
      statusOf(["you", "recording"], { you: "https://f/a.mp4", recording: "https://f/b.mp4" }),
    ).toMatchObject({ label: "Ready", tone: "done" });
  });

  test("lengths read the way people say them", () => {
    expect(aboutLength(20)).toBe("about 20 s");
    expect(aboutLength(16 * 60 + 10)).toBe("about 16 min");
  });
});

describe("a storyboard", () => {
  test("lays out the lesson's chapters and numbers its takes through the whole video", async () => {
    const { board } = await lesson();
    const loaded = await board();
    expect(loaded.chapters).toHaveLength(15);
    expect(loaded.takeCount).toBe(59);
    expect(loaded.chapters[0]).toMatchObject({ title: "Cold open", ready: false });
    expect(loaded.chapters[1].takes.map((take) => take.number)).toEqual([3, 4, 5]);
    expect(loaded.chapters.at(-1)!.takes.at(-1)!.number).toBe(59);
    expect(loaded.totals.you).toEqual({ done: 0, all: 59 });
    expect(loaded.totals.screen.all).toBeGreaterThan(0);
    expect(loaded.source).toBe("From the page AI-Assisted Development, Part 1");
    expect(loaded.cuts).toEqual([{ what: "Full lesson", where: "YouTube · 16:9 · about 16 min" }]);
    expect(loaded.length).toMatch(/^about \d+ min$/);
  });

  test("without a script starts with one empty chapter, and a project has only one", async () => {
    const { member, projectId, board } = await lesson("");
    const loaded = await board();
    expect(loaded.chapters.map((chapter) => [chapter.title, chapter.takes.length])).toEqual([
      ["Chapter 1", 0],
    ]);
    await expect(member.as.mutation(api.storyboards.create, { projectId })).rejects.toThrow(
      /already/,
    );
  });

  test("is only for its team", async () => {
    const { outsider, projectId, storyboardId, board } = await lesson();
    expect(await outsider.as.query(api.storyboards.get, { projectId })).toBeNull();
    expect(await outsider.as.query(api.storyboards.script, { storyboardId })).toBeNull();
    const take = (await board()).chapters[0].takes[0];
    await expect(
      outsider.as.mutation(api.storyboards.updateTake, { takeId: take._id, line: "Hacked" }),
    ).rejects.toThrow();
    await expect(
      outsider.as.mutation(api.storyboards.create, { projectId: (await board()).projectId! }),
    ).rejects.toThrow();
  });

  test("a take's line, scene and parts can be changed, and taking a part off drops its file", async () => {
    const { member, board } = await lesson();
    const take = (await board()).chapters[0].takes[1];
    await member.as.mutation(api.storyboards.setTakeFile, {
      takeId: take._id,
      part: "graphic",
      url: "https://files.example/setup.png",
    });
    expect((await board()).chapters[0].takes[1].status.label).toBe("Waiting for your take");
    await member.as.mutation(api.storyboards.updateTake, {
      takeId: take._id,
      line: "  The whole setup,   in one picture. ",
      scene: "graphic",
      parts: ["graphic"],
    });
    let changed = (await board()).chapters[0].takes[1];
    expect(changed).toMatchObject({
      line: "The whole setup, in one picture.",
      scene: "graphic",
      parts: ["graphic"],
      files: { graphic: "https://files.example/setup.png" },
      status: { label: "Graphic ready", tone: "done" },
    });
    await member.as.mutation(api.storyboards.updateTake, { takeId: take._id, parts: ["you"] });
    changed = (await board()).chapters[0].takes[1];
    expect(changed.files).toEqual({});
    await expect(
      member.as.mutation(api.storyboards.updateTake, { takeId: take._id, line: "   " }),
    ).rejects.toThrow(/line/);
  });

  test("files go into the parts a take uses, as links or the team's uploads", async () => {
    const { member, board } = await lesson();
    const take = (await board()).chapters[0].takes[0];
    await expect(
      member.as.mutation(api.storyboards.setTakeFile, {
        takeId: take._id,
        part: "screen",
        url: "https://files.example/x.mp4",
      }),
    ).rejects.toThrow(/does not use/);
    await expect(
      member.as.mutation(api.storyboards.setTakeFile, {
        takeId: take._id,
        part: "you",
        url: "not a link",
      }),
    ).rejects.toThrow(/link/);
    await member.as.mutation(api.storyboards.setTakeFile, {
      takeId: take._id,
      part: "you",
      url: "upload:k17abc",
    });
    let loaded = await board();
    expect(loaded.chapters[0].takes[0].status.label).toBe("Take in");
    expect(loaded.totals.you).toEqual({ done: 1, all: 59 });
    await member.as.mutation(api.storyboards.setTakeFile, {
      takeId: take._id,
      part: "you",
      url: null,
    });
    loaded = await board();
    expect(loaded.totals.you.done).toBe(0);
  });

  test("a chapter is ready once every take in it has all its parts", async () => {
    const { member, board } = await lesson();
    const chapter = (await board()).chapters[0];
    for (const take of chapter.takes) {
      for (const part of take.parts) {
        await member.as.mutation(api.storyboards.setTakeFile, {
          takeId: take._id,
          part,
          url: `https://files.example/${take.number}-${part}.mp4`,
        });
      }
    }
    expect((await board()).chapters[0].ready).toBe(true);
  });

  test("takes can be added, moved across chapters and removed", async () => {
    const { member, board } = await lesson();
    const first = (await board()).chapters[0];
    const added = await member.as.mutation(api.storyboards.addTake, {
      chapterId: first._id,
      line: "A new opening line.",
      afterTakeId: first.takes[0]._id,
    });
    let loaded = await board();
    expect(loaded.chapters[0].takes.map((take) => take.line)[1]).toBe("A new opening line.");
    expect(loaded.chapters[1].takes[0].number).toBe(4);

    // The last take of a chapter moves down into the start of the next one.
    const last = loaded.chapters[0].takes.at(-1)!;
    await member.as.mutation(api.storyboards.moveTake, { takeId: last._id, direction: "down" });
    loaded = await board();
    expect(loaded.chapters[0].takes).toHaveLength(2);
    expect(loaded.chapters[1].takes[0]._id).toBe(last._id);
    // And back up again.
    await member.as.mutation(api.storyboards.moveTake, { takeId: last._id, direction: "up" });
    loaded = await board();
    expect(loaded.chapters[0].takes.at(-1)!._id).toBe(last._id);
    // Within a chapter.
    await member.as.mutation(api.storyboards.moveTake, { takeId: added, direction: "up" });
    loaded = await board();
    expect(loaded.chapters[0].takes[0]._id).toBe(added);

    await member.as.mutation(api.storyboards.removeTake, { takeId: added });
    loaded = await board();
    expect(loaded.takeCount).toBe(59);
    expect(loaded.chapters[0].takes[0].number).toBe(1);
  });

  test("chapters can be added, renamed, moved and removed, but the last one stays", async () => {
    const { member, storyboardId, board } = await lesson("Only line.");
    const second = await member.as.mutation(api.storyboards.addChapter, { storyboardId });
    let loaded = await board();
    expect(loaded.chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Chapter 2"]);
    await member.as.mutation(api.storyboards.renameChapter, { chapterId: second, title: "Close" });
    await member.as.mutation(api.storyboards.moveChapter, { chapterId: second, direction: "up" });
    loaded = await board();
    expect(loaded.chapters.map((chapter) => chapter.title)).toEqual(["Close", "Chapter 1"]);
    await member.as.mutation(api.storyboards.removeChapter, {
      chapterId: loaded.chapters[1]._id,
    });
    loaded = await board();
    expect(loaded.takeCount).toBe(0);
    await expect(
      member.as.mutation(api.storyboards.removeChapter, { chapterId: second }),
    ).rejects.toThrow(/at least one/);
  });

  test("rewriting the script keeps the files of lines that did not change", async () => {
    const { member, storyboardId, board } = await lesson();
    const take = (await board()).chapters[0].takes[0];
    await member.as.mutation(api.storyboards.setTakeFile, {
      takeId: take._id,
      part: "you",
      url: "https://files.example/cold-open.mp4",
    });
    const text = (await member.as.query(api.storyboards.script, { storyboardId }))!;
    expect(readScript(text)).toEqual(readScript(LESSON_STORYBOARD));
    const edited = text.replace(
      "## Cold open",
      "## Cold open\n[Full Screen] A brand new first line.",
    );
    expect(
      await member.as.mutation(api.storyboards.writeFromScript, { storyboardId, script: edited }),
    ).toEqual({ chapters: 15, takes: 60 });
    const loaded = await board();
    expect(loaded.chapters[0].takes[0]).toMatchObject({
      line: "A brand new first line.",
      files: {},
    });
    expect(loaded.chapters[0].takes[1]).toMatchObject({
      line: take.line,
      files: { you: "https://files.example/cold-open.mp4" },
    });
    await expect(
      member.as.mutation(api.storyboards.writeFromScript, { storyboardId, script: "## Empty" }),
    ).rejects.toThrow(/at least one line/);
  });

  test("its shape, source and cuts can be changed", async () => {
    const { member, storyboardId, board } = await lesson();
    await member.as.mutation(api.storyboards.setDetails, {
      storyboardId,
      aspect: "9:16",
      source: null,
      cuts: [
        { what: " Short lessons ", where: "YouTube · 16:9 · 3 to 8 min" },
        { what: "", where: "dropped" },
      ],
    });
    expect(await board()).toMatchObject({
      aspect: "9:16",
      source: null,
      cuts: [{ what: "Short lessons", where: "YouTube · 16:9 · 3 to 8 min" }],
    });
  });

  test("cuts are added to the end of the list and taken off by place", async () => {
    const { member, storyboardId, board } = await lesson();
    await member.as.mutation(api.storyboards.addCut, {
      storyboardId,
      what: "Ask your AI prompts",
      where: "Shorts, Reels, TikTok · 9:16",
    });
    expect((await board()).cuts.map((cut) => cut.what)).toEqual([
      "Full lesson",
      "Ask your AI prompts",
    ]);
    await expect(
      member.as.mutation(api.storyboards.addCut, { storyboardId, what: "  ", where: "" }),
    ).rejects.toThrow(/Name the cut/);
    await member.as.mutation(api.storyboards.removeCut, { storyboardId, index: 0 });
    expect((await board()).cuts).toEqual([
      { what: "Ask your AI prompts", where: "Shorts, Reels, TikTok · 9:16" },
    ]);
  });

  test("only managers delete it, and deleting the project deletes it too", async () => {
    const { t, owner, member, projectId, storyboardId } = await lesson();
    await expect(member.as.mutation(api.storyboards.remove, { storyboardId })).rejects.toThrow();
    await owner.as.mutation(api.projects.remove, { projectId });
    const left = await t.run(async (ctx) => ({
      boards: await ctx.db.query("storyboards").collect(),
      chapters: await ctx.db.query("storyboardChapters").collect(),
      takes: await ctx.db.query("storyboardTakes").collect(),
    }));
    expect(left).toEqual({ boards: [], chapters: [], takes: [] });
  });
});

describe("reading the answer to Suggest scenes", () => {
  test("keeps known scenes for lines there are, and names chapters by place", () => {
    const read = readSceneAnswer(
      'Sure: {"chapters":[{"title":"1. Why"},{"title":""},{"title":"Extra"}],' +
        '"scenes":[{"n":1,"scene":"Full Graphic"},{"n":"2","scene":"center"},{"n":7,"scene":"panel"},{"n":3,"scene":"zoom"}]}',
      2,
      3,
    );
    expect([...read.scenes]).toEqual([
      [1, "graphic"],
      [2, "centre"],
    ]);
    expect([...read.titles]).toEqual([[0, "Why"]]);
    expect(readSceneAnswer("no json here", 2, 3).scenes.size).toBe(0);
  });

  test("a scene other than Full Screen asks for a graphic", () => {
    expect(partsForScene("panel", ["you"])).toEqual(["you", "graphic"]);
    expect(partsForScene("full", ["you"])).toEqual(["you"]);
    expect(partsForScene("circle", ["you", "screen"])).toEqual(["you", "screen"]);
  });
});
