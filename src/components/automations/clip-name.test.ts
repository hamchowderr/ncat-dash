import { describe, expect, test } from "vitest";

import { clipName } from "./editor-export";

const made = "https://files.example/ca4934e3-5b1f-4c3e-9a77-0d2f1b6e8a10_output_0.mp4";

describe("saved clip names", () => {
  test("use the readable name, keeping the file's ending and the order", () => {
    expect(clipName(made, 0, { [made]: "Space interviews clip 1" })).toBe(
      "01 Space interviews clip 1.mp4",
    );
  });

  test("keep the file's own name when there is no readable one", () => {
    expect(clipName("https://files.example/intro%20cut.mp4", 9)).toBe("10 intro cut.mp4");
  });

  test("never put a slash or colon in a file name", () => {
    expect(clipName(made, 1, { [made]: "Q&A: part 1/2" })).toBe("02 Q&A_ part 1_2.mp4");
  });
});
