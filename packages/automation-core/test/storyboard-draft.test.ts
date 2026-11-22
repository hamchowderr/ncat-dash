import { describe, expect, it } from "vitest";

import {
  CHAPTER_PAUSE,
  clipRef,
  draftStoryboard,
  opensTopic,
  readClipRef,
  readUploadRef,
  timeRangeOf,
  type Word,
} from "../src";

/** Words said one after another from `from`, a word every 0.4 s. */
function said(text: string, from: number, step = 0.4): Word[] {
  return text.split(" ").map((word, index) => ({
    text: word,
    start: from + index * step,
    end: from + index * step + step * 0.8,
  }));
}

const lines = (draft: ReturnType<typeof draftStoryboard>) =>
  draft.chapters.map((chapter) => chapter.takes.map((take) => take.line));

describe("a storyboard drafted from what was said", () => {
  it("gives every sentence a line with the stretch it is said in", () => {
    const words = [
      ...said("I have never known how to code.", 0),
      ...said("In 39 days we merged 881 changes.", 3.2),
    ];
    const draft = draftStoryboard(words, 60);
    expect(lines(draft)).toEqual([
      ["I have never known how to code.", "In 39 days we merged 881 changes."],
    ]);
    const [first, second] = draft.chapters[0]!.takes;
    expect(first!.start).toBe(0);
    expect(first!.end).toBeCloseTo(2.4 + 0.32 + 0.15, 2);
    expect(second!.start).toBeCloseTo(3.12, 2);
    // A clip holds only its own sentence, so the pause between lines is not in either.
    expect(first!.end).toBeLessThan(second!.start);
  });

  it("keeps only the last take of a line said again", () => {
    const words = [
      ...said("So the first thing you do", 0),
      ...said("So the first thing you do is open the folder.", 3),
      ...said("Then drop the video in.", 8),
    ];
    const draft = draftStoryboard(words);
    expect(lines(draft)).toEqual([
      ["So the first thing you do is open the folder.", "Then drop the video in."],
    ]);
    expect(draft.retakesDropped).toBe(1);
    expect(draft.chapters[0]!.takes[0]!.start).toBeCloseTo(2.92, 2);
  });

  it("starts a chapter after a long pause, named from its first line", () => {
    const words = [
      ...said("Welcome to the course.", 0),
      ...said("Setting up your workspace takes five minutes.", 2 + CHAPTER_PAUSE + 1),
    ];
    const draft = draftStoryboard(words);
    expect(draft.chapters.map((chapter) => chapter.title)).toEqual([
      "Welcome to the course",
      "Setting up your workspace takes five minutes",
    ]);
  });

  it("starts a chapter where a new part is announced, once a chapter has a few lines", () => {
    const words = [
      ...said("One line here.", 0),
      ...said("Next we look at folders.", 2),
      ...said("A second line.", 4),
      ...said("A third line.", 6),
      ...said("Step two is the upload.", 8),
      ...said("It takes a minute.", 10),
    ];
    const draft = draftStoryboard(words);
    // "Next" came after one line only, so it stays in the first chapter.
    expect(lines(draft)).toEqual([
      ["One line here.", "Next we look at folders.", "A second line.", "A third line."],
      ["Step two is the upload.", "It takes a minute."],
    ]);
    expect(draft.chapters[1]!.title).toBe("Step two is the upload");
  });

  it("names a chapter that opens on a short line from the line after it too", () => {
    const words = [
      ...said("A. B. C.", 0),
      ...said("Next.", 2 + CHAPTER_PAUSE + 1),
      ...said("We set up the folder for every creator you work with.", 9),
    ];
    const draft = draftStoryboard(words);
    expect(draft.chapters[1]!.title).toBe("Next, We set up the folder for every…");
  });

  it("never runs a clip past the end of the recording", () => {
    const draft = draftStoryboard(said("The end.", 0), 0.7);
    expect(draft.chapters[0]!.takes[0]!.end).toBe(0.7);
  });

  it("has nothing when nothing is said", () => {
    expect(draftStoryboard([]).chapters).toEqual([]);
  });

  it("stays within a storyboard's 400 lines on a very long recording", () => {
    const words = Array.from({ length: 900 }, (_, index) =>
      said(`Point ${index} matters.`, index * 2),
    ).flat();
    const draft = draftStoryboard(words);
    const total = draft.chapters.reduce((sum, chapter) => sum + chapter.takes.length, 0);
    expect(total).toBeLessThanOrEqual(400);
    expect(draft.chapters[0]!.takes[0]!.line).toBe(
      "Point 0 matters. Point 1 matters. Point 2 matters.",
    );
    expect(draft.retakesDropped).toBe(0);
  });

  it("knows the usual ways a new part is announced", () => {
    for (const opening of [
      ["next"],
      ["step", "two"],
      ["part", "3"],
      ["moving", "on"],
      ["lets", "talk", "about"],
      ["now", "lets"],
      ["finally"],
    ]) {
      expect(opensTopic(opening)).toBe(true);
    }
    for (const opening of [["the", "next"], ["step"], ["part", "of"], ["now"]]) {
      expect(opensTopic(opening)).toBe(false);
    }
  });
});

describe("a pointer to part of an upload", () => {
  it("names the upload and the stretch, and is not a whole-upload pointer", () => {
    const ref = clipRef("abc_123", 12.3456, 15.8);
    expect(ref).toBe("upload:abc_123#t=12.346,15.8");
    expect(readClipRef(ref)).toEqual({ uploadId: "abc_123", start: 12.346, end: 15.8 });
    expect(readUploadRef(ref)).toBeNull();
    expect(readClipRef("upload:abc_123")).toBeNull();
    expect(timeRangeOf("https://files.example/a.mp4#t=1,2.5")).toEqual({ start: 1, end: 2.5 });
    expect(timeRangeOf("https://files.example/a.mp4")).toBeNull();
  });
});
