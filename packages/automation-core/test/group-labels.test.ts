import { describe, expect, it } from "vitest";
import { GROUP_LABELS } from "../src";

describe("the editor's step groups", () => {
  it("are named in plain words, never after the tool underneath", () => {
    expect(Object.values(GROUP_LABELS).filter((label) => /ffmpeg/i.test(label))).toEqual([]);
    expect(GROUP_LABELS.ffmpeg).toBe("Custom edits");
  });
});
