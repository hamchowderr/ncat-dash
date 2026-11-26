import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addPerson, addTeam, backend } from "./test.setup";

/**
 * "Match takes": recordings picked by the person are matched with the storyboard's lines by
 * what was said, and the best take of each line goes in as its take of you.
 */

const SCRIPT = [
  "## Open",
  "[Full Screen] I have never known how to code.",
  "[Panel · Graphic] In 39 days we merged 881 changes.",
  "## Close",
  "[Full Graphic · Graphic · No voice] Thanks for watching.",
  "[Full Screen] See you next time.",
].join("\n");

/** Words said one after another from `from`, a word every 0.4 s, as transcript words. */
function said(text: string, from: number) {
  return text.split(" ").map((word, index) => ({
    t: word,
    s: from + index * 0.4,
    e: from + index * 0.4 + 0.32,
  }));
}

async function setUp() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  const olu = await addPerson(t, "Olu Bello", [await addTeam(t, "Pine Studio")], "owner");
  const projectId = await maya.as.mutation(api.projects.create, {
    organizationId: team,
    name: "Launch Video",
    package: "blank",
  });
  const storyboardId = await maya.as.mutation(api.storyboards.create, {
    projectId,
    script: SCRIPT,
  });
  const takes = async () =>
    (await maya.as.query(api.storyboards.get, { projectId }))!.chapters.flatMap(
      (chapter) => chapter.takes,
    );

  /** A recording with its transcript in, each piece said from its start. */
  const recording = (
    title: string,
    pieces: { start: number; text: string }[],
    ready = true,
  ): Promise<{ itemId: Id<"libraryItems">; uploadId: Id<"uploads"> }> =>
    t.run(async (ctx) => {
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
        details: { duration: 60 },
        transcript: ready ? { status: "ready", at: 1 } : { status: "working", at: 1 },
      });
      for (const piece of pieces) {
        const words = said(piece.text, piece.start);
        await ctx.db.insert("transcriptPieces", {
          organizationId: team,
          itemId,
          start: piece.start,
          end: words.at(-1)!.e,
          text: piece.text,
          words,
        });
      }
      return { itemId, uploadId };
    });
  return { t, team, maya, olu, storyboardId, takes, recording };
}

describe("matching recorded takes to the storyboard's lines", () => {
  test("puts the best take of each line in, across recordings, and names what is missing", async () => {
    const { maya, storyboardId, takes, recording } = await setUp();
    const first = await recording("monday.mp4", [
      { start: 0, text: "I have never known how to cook." },
      { start: 4, text: "I have never known how to code." },
    ]);
    const second = await recording("tuesday.mp4", [
      { start: 0, text: "In 39 days we merged 881 changes." },
    ]);
    const result = await maya.as.action(api.storyboardMatch.match, {
      storyboardId,
      libraryItemIds: [first.itemId, second.itemId],
    });
    // Line 1 was said twice and the second, right take is used; take 3 nobody says;
    // take 4 was not recorded yet.
    expect(result).toEqual({ matched: 2, picked: [1], missing: [4], notReady: [] });
    const [one, two, three, four] = await takes();
    expect(one!.files.you).toBe(`upload:${first.uploadId}#t=3.92,6.87`);
    expect(two!.files.you).toBe(`upload:${second.uploadId}#t=0,2.87`);
    expect(three!.files).toEqual({});
    expect(four!.files).toEqual({});
  });

  test("a line with its take in keeps it, unless asked to pick again", async () => {
    const { maya, storyboardId, takes, recording } = await setUp();
    const [one] = await takes();
    await maya.as.mutation(api.storyboards.setTakeFile, {
      takeId: one!._id,
      part: "you",
      url: "https://files.example/kept.mp4",
    });
    const { itemId, uploadId } = await recording("again.mp4", [
      { start: 0, text: "I have never known how to code." },
    ]);
    const kept = await maya.as.action(api.storyboardMatch.match, {
      storyboardId,
      libraryItemIds: [itemId],
    });
    expect(kept.matched).toBe(0);
    expect((await takes())[0]!.files.you).toBe("https://files.example/kept.mp4");
    await maya.as.action(api.storyboardMatch.match, {
      storyboardId,
      libraryItemIds: [itemId],
      replace: true,
    });
    expect((await takes())[0]!.files.you).toBe(`upload:${uploadId}#t=0,2.87`);
  });

  test("a recording still being transcribed is named, and another team's are not read", async () => {
    const { maya, olu, storyboardId, recording } = await setUp();
    const waiting = await recording("later.mp4", [], false);
    await expect(
      maya.as.action(api.storyboardMatch.match, {
        storyboardId,
        libraryItemIds: [waiting.itemId],
      }),
    ).rejects.toThrow(/still being transcribed/);
    const said = await recording("now.mp4", [{ start: 0, text: "See you next time." }]);
    expect(
      await maya.as.action(api.storyboardMatch.match, {
        storyboardId,
        libraryItemIds: [waiting.itemId, said.itemId],
      }),
    ).toMatchObject({ matched: 1, notReady: ["later.mp4"] });
    await expect(
      olu.as.action(api.storyboardMatch.match, { storyboardId, libraryItemIds: [said.itemId] }),
    ).rejects.toThrow();
  });
});
