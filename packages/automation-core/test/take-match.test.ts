import { describe, expect, it } from "vitest";

import { closeness, matchTakes, type Word } from "../src";

/** Words said one after another from `from`, a word every 0.4 s. */
function said(text: string, from: number, step = 0.4): Word[] {
  return text.split(" ").map((word, index) => ({
    text: word,
    start: from + index * step,
    end: from + index * step + step * 0.8,
  }));
}

const LINES = [
  "I have never known how to code.",
  "In 39 days we merged 881 changes.",
  "Here is how the work is set up.",
];

describe("matching takes to lines by what was said", () => {
  it("finds each line in the recordings, wherever and in whatever order it was said", () => {
    const first = [...said("Here is how the work is set up.", 0)];
    const second = [
      ...said("I have never known how to code.", 0),
      ...said("In 39 days we merged 881 changes.", 5),
    ];
    const matched = matchTakes(LINES, [
      { id: "a", words: first },
      { id: "b", words: second },
    ]);
    expect(matched.map(({ line, recording, takes }) => ({ line, recording, takes }))).toEqual([
      { line: 0, recording: "b", takes: 1 },
      { line: 1, recording: "b", takes: 1 },
      { line: 2, recording: "a", takes: 1 },
    ]);
    expect(matched[1]!.start).toBeCloseTo(4.92, 2);
    expect(matched[1]!.score).toBe(1);
  });

  it("of several takes of a line, keeps the closest, and the later one when about as close", () => {
    const words = [
      // A slip, then the line again in full, then once more just as well.
      ...said("I have never known how to cook.", 0),
      ...said("I have never known how to code.", 4),
      ...said("I have never known how to code.", 8),
      ...said("In 39 days we merged 881 changes.", 12),
    ];
    const matched = matchTakes(LINES.slice(0, 2), [{ id: "a", words }]);
    expect(matched[0]).toMatchObject({ line: 0, takes: 3, score: 1 });
    expect(matched[0]!.start).toBeCloseTo(7.92, 2);
  });

  it("a take full of ums loses to a clean one", () => {
    const words = [
      ...said("I have never um known uh how to code.", 0),
      ...said("I have never known how to code.", 6),
    ];
    const later = matchTakes([LINES[0]!], [{ id: "a", words }]);
    expect(later[0]!.start).toBeCloseTo(5.92, 2);
    // Said the other way round, the clean take is still the one kept.
    const earlier = matchTakes(
      [LINES[0]!],
      [
        {
          id: "a",
          words: [
            ...said("I have never known how to code.", 0),
            ...said("I have never um known uh um how to code.", 6),
          ],
        },
      ],
    );
    expect(earlier[0]!.start).toBe(0);
  });

  it("a line said as two sentences is matched as one take", () => {
    const words = said("This is the plan. We start on Monday.", 0);
    const matched = matchTakes(["This is the plan. We start on Monday."], [{ id: "a", words }]);
    expect(matched).toEqual([expect.objectContaining({ line: 0, start: 0, score: 1, takes: 1 })]);
    expect(matched[0]!.end).toBeCloseTo(2.8 + 0.32 + 0.15, 2);
  });

  it("leaves out lines nobody said, and never gives one stretch to two lines", () => {
    const words = said("I have never known how to code.", 0);
    const matched = matchTakes(
      ["I have never known how to code.", "I have never known how to code!", "Something else."],
      [{ id: "a", words, length: 2 }],
    );
    expect(matched).toHaveLength(1);
    expect(matched[0]).toMatchObject({ line: 0, end: 2 });
  });

  it("closeness is the share of words said in the same order", () => {
    expect(closeness(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
    expect(closeness(["a", "b", "c", "d"], ["a", "x", "c", "d"])).toBe(0.75);
    expect(closeness([], ["a"])).toBe(0);
  });
});
