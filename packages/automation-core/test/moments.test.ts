import { describe, expect, it } from "vitest";
import {
  chapterPicksFrom,
  chapterSettings,
  clock,
  droppedWords,
  findPick,
  findQuote,
  momentPicksFrom,
  momentSettings,
  planChapters,
  planMoments,
  readModelJson,
  sentencesOf,
  showNotes,
  snapMoment,
  sourceKey,
  transcriptText,
  type Word,
  wordsFromSegments,
  youtubeChapters,
} from "../src";

/**
 * A transcript where each word takes 0.4 s with a 0.1 s gap, and each sentence is
 * followed by a 0.5 s pause. Returns the words, as the toolkit's segments would give them.
 */
function spoken(...sentences: string[]): Word[] {
  const words: Word[] = [];
  let at = 1;
  for (const sentence of sentences) {
    for (const text of sentence.split(" ")) {
      words.push({ text, start: at, end: at + 0.4 });
      at += 0.5;
    }
    at += 0.5;
  }
  return words;
}

const TALK = spoken(
  "Welcome back to the show.",
  "Today we talk about pricing.",
  "Most creators charge far too little for their work.",
  "Here is the one rule I follow every single time.",
  "Never quote a price on the first call.",
  "Thanks for listening.",
);

const settings = momentSettings({
  platform: "TikTok",
  minSeconds: 1,
  maxSeconds: 30,
  padding: 0.2,
});

describe("reading the toolkit's transcript", () => {
  it("takes every word with its times from segments made with word timestamps", () => {
    const words = wordsFromSegments([
      {
        text: " Hi there.",
        words: [
          { word: " Hi", start: 0.5, end: 0.8 },
          { word: " there.", start: 0.8, end: 1.2 },
        ],
      },
      {
        text: " Bye.",
        words: [
          { word: " Bye.", start: 2, end: 2.4 },
          { word: "", start: 3, end: 3 },
        ],
      },
      { text: "no words here" },
      null,
    ]);
    expect(words).toEqual([
      { text: "Hi", start: 0.5, end: 0.8 },
      { text: "there.", start: 0.8, end: 1.2 },
      { text: "Bye.", start: 2, end: 2.4 },
    ]);
    expect(wordsFromSegments("not a list")).toEqual([]);
  });

  it("splits it into sentences at full stops and at long pauses", () => {
    const words = [
      { text: "so", start: 0, end: 0.3 },
      { text: "yeah", start: 0.4, end: 0.7 },
      // a 2 s pause with no full stop still ends the sentence
      { text: "next", start: 2.7, end: 3 },
      { text: "thing.", start: 3.1, end: 3.4 },
      { text: "Done", start: 3.6, end: 3.9 },
    ];
    expect(sentencesOf(words)).toEqual([
      { first: 0, last: 1 },
      { first: 2, last: 3 },
      { first: 4, last: 4 },
    ]);
  });

  it("gives the model one sentence a line, each with its start time", () => {
    expect(transcriptText(TALK).split("\n").slice(0, 2)).toEqual([
      "[0:01] Welcome back to the show.",
      "[0:04] Today we talk about pricing.",
    ]);
  });

  it("matches a file however its link was signed", () => {
    expect(sourceKey("https://r2.example/b/talk.mp4?X-Amz-Signature=abc")).toBe(
      "https://r2.example/b/talk.mp4",
    );
  });
});

describe("finding a quote word for word", () => {
  it("finds it whatever its case and punctuation", () => {
    expect(findQuote(TALK, "today we talk about PRICING")).toEqual({ first: 5, last: 9 });
  });

  it("does not find a quote with a word changed, added or left out", () => {
    expect(findQuote(TALK, "Today we chat about pricing")).toBeNull();
    expect(findQuote(TALK, "Today we talk about the pricing")).toBeNull();
    expect(findQuote(TALK, "Today talk about pricing")).toBeNull();
    expect(findQuote(TALK, "   ")).toBeNull();
  });

  it("looks only after the word it is told to start from", () => {
    const twice = spoken("Go now.", "Go now.");
    expect(findQuote(twice, "go now")).toEqual({ first: 0, last: 1 });
    expect(findQuote(twice, "go now", 1)).toEqual({ first: 2, last: 3 });
  });
});

describe("snapping a clip's edges to the words", () => {
  const rule = findQuote(TALK, "the one rule I follow")!;

  it("grows to whole sentences and keeps the padding out of the next word", () => {
    const snapped = snapMoment(TALK, rule, { padding: 5, edges: "sentence", maxSeconds: 30 });
    // From "Here" to "time." (the sentence the quote is in), padded only as far as the
    // gaps to the words before and after.
    expect(TALK[snapped.first].text).toBe("Here");
    expect(TALK[snapped.last].text).toBe("time.");
    expect(snapped.start).toBe(TALK[snapped.first - 1].end);
    expect(snapped.end).toBe(TALK[snapped.last + 1].start);
  });

  it("keeps to the exact words with word edges, padded by what was asked", () => {
    const snapped = snapMoment(TALK, rule, { padding: 0.05, edges: "word", maxSeconds: 30 });
    expect(TALK[snapped.first].text).toBe("the");
    expect(TALK[snapped.last].text).toBe("follow");
    expect(snapped.start).toBeCloseTo(TALK[rule.first].start - 0.05, 3);
    expect(snapped.end).toBeCloseTo(TALK[rule.last].end + 0.05, 3);
  });

  it("does not grow past the longest clip allowed", () => {
    const snapped = snapMoment(TALK, rule, { padding: 0, edges: "sentence", maxSeconds: 3 });
    expect(snapped.first).toBe(rule.first);
    expect(snapped.last).toBe(rule.last);
  });

  it("never starts before the video or ends after it", () => {
    const opening = findQuote(TALK, "Welcome back")!;
    const snapped = snapMoment(TALK, opening, { padding: 2, edges: "word", maxSeconds: 30 });
    expect(snapped.start).toBe(0);
    const closing = findQuote(TALK, "for listening.")!;
    const videoEnds = TALK[TALK.length - 1].end + 0.5;
    const end = snapMoment(TALK, closing, { padding: 2, edges: "word", maxSeconds: 30 }, videoEnds);
    expect(end.end).toBe(videoEnds);
  });
});

describe("planning the moments", () => {
  const pick = (quote: string, title = "A title") => ({ quote, title, why: "It lands." });

  it("keeps picks found word for word, in the model's order, up to the count", () => {
    const plan = planMoments(
      TALK,
      [
        pick("Never quote a price on the first call.", "The one rule"),
        pick("Most creators charge far too little", "Charge more"),
        pick("Welcome back to the show."),
      ],
      { ...settings, count: 2 },
    );
    expect(plan.moments.map((moment) => moment.title)).toEqual(["The one rule", "Charge more"]);
    expect(plan.moments[1].text).toBe("Most creators charge far too little for their work.");
  });

  it("drops a pick that is not in the transcript word for word, and says so", () => {
    const plan = planMoments(
      TALK,
      [pick("Never ever quote a price"), pick("Thanks for listening.")],
      settings,
    );
    expect(plan.moments).toHaveLength(1);
    expect(plan.dropped.notInTranscript).toBe(1);
    expect(droppedWords(plan.dropped)).toBe(
      "1 pick was left out: 1 did not match the transcript word for word.",
    );
  });

  it("drops picks that come out too long or too short", () => {
    const plan = planMoments(TALK, [pick("Thanks for listening.")], {
      ...settings,
      minSeconds: 5,
    });
    expect(plan.moments).toHaveLength(0);
    expect(plan.dropped.wrongLength).toBe(1);
  });

  it("drops a pick that overlaps one already kept or one picked by an earlier run", () => {
    const rule = planMoments(TALK, [pick("Never quote a price on the first call.")], settings)
      .moments[0];
    const plan = planMoments(
      TALK,
      [pick("on the first call."), pick("Today we talk about pricing.")],
      settings,
      [{ start: rule.start, end: rule.end }],
    );
    expect(plan.moments.map((moment) => moment.text)).toEqual(["Today we talk about pricing."]);
    expect(plan.dropped.overlapping).toBe(1);
    expect(droppedWords({ notInTranscript: 1, wrongLength: 1, overlapping: 1 })).toBe(
      "3 picks were left out: 1 did not match the transcript word for word, 1 came out too long or too short and 1 overlapped another moment.",
    );
    expect(droppedWords({ notInTranscript: 0, wrongLength: 0, overlapping: 0 })).toBeNull();
  });
});

describe("picks marked by their first and last words", () => {
  // A long lesson: the moment worth posting is a 20-second stretch in the middle of it,
  // and its opening line is said again later on.
  const filler = Array.from({ length: 40 }, (_, i) => `Here is filler line number ${i} for now.`);
  const LESSON = spoken(
    ...filler.slice(0, 20),
    "So you see how it says main right here.",
    "A branch is just a copy of your work.",
    "You build the feature on the copy first.",
    "Then you open a pull request to merge it.",
    "Somebody checks it before it reaches production.",
    "That is why you never push straight to main.",
    ...filler.slice(20),
    "So you see how it says main right here.",
    "Thanks for coming.",
  );
  const lesson = momentSettings({ platform: "TikTok", minSeconds: 10, maxSeconds: 60 });
  const marked = {
    quote: "",
    start: "So you see how it says main",
    end: "never push straight to main.",
    title: "What a branch is",
    why: "It explains branches in one go.",
  };

  it("cuts from the first word of the start to the last word of the end", () => {
    const plan = planMoments(LESSON, [marked], lesson);
    expect(plan.moments).toHaveLength(1);
    const [moment] = plan.moments;
    expect(moment.text.startsWith("So you see how it says main right here.")).toBe(true);
    expect(moment.text.endsWith("That is why you never push straight to main.")).toBe(true);
    expect(moment.end - moment.start).toBeGreaterThan(10);
  });

  it("drops a moment quoted only by its opening line, as a long transcript used to get", () => {
    // What the model sent back on a 64-minute recording: the first sentence alone.
    const plan = planMoments(
      LESSON,
      [{ quote: "So you see how it says main right here.", title: "t", why: "w" }],
      lesson,
    );
    expect(plan.moments).toHaveLength(0);
    expect(plan.dropped.wrongLength).toBe(1);
  });

  it("uses the place where the start is followed by the end, when the start is said twice", () => {
    const found = findPick(LESSON, marked, 60);
    expect(found).not.toBeNull();
    expect(LESSON[found!.last].text).toBe("main.");
    expect(LESSON[found!.last].end - LESSON[found!.first].start).toBeLessThan(60);
  });

  it("does not find an end said only before the start", () => {
    expect(
      findPick(LESSON, { quote: "", start: "Thanks for coming.", end: "Here is filler line" }),
    ).toBeNull();
  });

  it("falls back to the whole quote when a pick gives no start and end", () => {
    expect(findPick(LESSON, { quote: "A branch is just a copy of your work." })).not.toBeNull();
  });
});

describe("the settings a team controls", () => {
  it("fills blanks with the usual values", () => {
    expect(momentSettings({ platform: "Instagram Reels" })).toEqual({
      platform: "Instagram Reels",
      count: 5,
      minSeconds: 15,
      maxSeconds: 60,
      topics: "",
      lookFor: "",
      padding: 0.25,
      edges: "sentence",
      skipPicked: true,
    });
  });

  it("never lets a clip be longer than the platform takes, or numbers go out of range", () => {
    const s = momentSettings({
      platform: "Instagram Stories",
      maxSeconds: 300,
      minSeconds: 500,
      count: 99,
      padding: -1,
      edges: "word",
      skipPicked: false,
    });
    expect(s).toMatchObject({
      maxSeconds: 60,
      minSeconds: 60,
      count: 20,
      padding: 0,
      edges: "word",
      skipPicked: false,
    });
    expect(chapterSettings({ count: "4", bullets: 10 })).toEqual({ count: 4, bullets: 6 });
    expect(chapterSettings({})).toEqual({ count: 0, bullets: 3 });
  });
});

describe("chapters", () => {
  const long = spoken(
    ...Array.from({ length: 8 }, (_, i) => `Part ${i + 1} begins with a few words here.`),
  );

  it("starts the first at 0:00 and each other at the start of its sentence", () => {
    const { chapters, dropped } = planChapters(
      long,
      [
        { title: "Intro", opening: "Part 1 begins", bullets: ["Hello", " "] },
        // opening from the middle of a sentence: the chapter starts where the sentence does
        { title: "The middle", opening: "4 begins with a few", bullets: ["A", "B", "C", "D"] },
        { title: "Made up", opening: "words that were never said", bullets: [] },
        { title: "Too close", opening: "Part 5 begins", bullets: [] },
        { title: "The end", opening: "Part 8 begins", bullets: [] },
      ],
      { count: 0, bullets: 3 },
    );
    expect(chapters.map((chapter) => [chapter.title, chapter.start])).toEqual([
      ["Intro", 0],
      ["The middle", long[findQuote(long, "Part 4")!.first].start],
      ["The end", long[findQuote(long, "Part 8")!.first].start],
    ]);
    expect(chapters[0].bullets).toEqual(["Hello"]);
    expect(chapters[1].bullets).toEqual(["A", "B", "C"]);
    expect(dropped).toBe(2);
    expect(youtubeChapters(chapters).split("\n")[0]).toBe("0:00 Intro");
    expect(showNotes(chapters, "Episode 4")).toContain("## 0:00 Intro\n- Hello\n");
    expect(showNotes(chapters, "Episode 4").startsWith("# Episode 4\n")).toBe(true);
  });

  it("stops at the most chapters asked for", () => {
    const { chapters } = planChapters(
      long,
      [
        { title: "One", opening: "Part 1", bullets: [] },
        { title: "Two", opening: "Part 4", bullets: [] },
        { title: "Three", opening: "Part 7", bullets: [] },
      ],
      { count: 2, bullets: 0 },
    );
    expect(chapters.map((chapter) => chapter.title)).toEqual(["One", "Two"]);
  });

  it("writes times the way YouTube reads them", () => {
    expect(clock(5)).toBe("0:05");
    expect(clock(754.9)).toBe("12:34");
    expect(clock(3723)).toBe("1:02:03");
  });
});

describe("reading the model's answer", () => {
  it("reads JSON on its own, in a code fence, or after a sentence", () => {
    expect(readModelJson('{"moments":[]}')).toEqual({ moments: [] });
    expect(readModelJson('Here you go:\n```json\n{"moments":[{"quote":"a"}]}\n```')).toEqual({
      moments: [{ quote: "a" }],
    });
    expect(readModelJson("no json at all")).toBeNull();
    // An answer, then a note and a corrected answer: the last one is the final word.
    expect(
      readModelJson(
        '{"moments":[{"quote":"a {b}"}]}\n\nCorrection: I need valid quotes. Final answer:\n\n{"moments":[{"quote":"c"}]}',
      ),
    ).toEqual({ moments: [{ quote: "c" }] });
    expect(readModelJson("{ broken")).toBeNull();
  });

  it("keeps only well-formed picks", () => {
    expect(
      momentPicksFrom({
        moments: [{ quote: "Never quote", title: "Rule" }, { title: "No quote" }, "junk"],
      }),
    ).toEqual([{ quote: "Never quote", title: "Rule", why: "" }]);
    expect(momentPicksFrom(null)).toEqual([]);
    expect(
      momentPicksFrom({ moments: [{ start: "So you see", end: "straight to main.", title: "t" }] }),
    ).toEqual([{ quote: "", start: "So you see", end: "straight to main.", title: "t", why: "" }]);
    expect(momentPicksFrom({ moments: [{ start: "only a start" }] })).toEqual([]);
    expect(
      chapterPicksFrom({ chapters: [{ title: "Intro", opening: "Hi", bullets: ["a", 3, ""] }] }),
    ).toEqual([{ title: "Intro", opening: "Hi", bullets: ["a"] }]);
  });
});
