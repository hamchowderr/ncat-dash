import { describe, expect, it } from "vitest";

import {
  FOOTAGE_DEFAULTS,
  type CheckedFile,
  type FootageMeasure,
  footageMessage,
  footageNote,
  footageProblems,
  footageSettings,
  footageSummary,
  footageShapeOf,
} from "../src";

const GOOD: FootageMeasure = {
  duration: 24,
  has_video: true,
  has_audio: true,
  width: 1080,
  height: 1920,
  fps: 30,
  black: [],
  frozen: [],
  loudness_lufs: -18,
  peak_db: -2,
  peak_count: 1,
  samples: 1_000_000,
};
const kinds = (
  measure: FootageMeasure | null,
  role: "file" | "body" | "hook" = "body",
  input = {},
) => footageProblems(measure, footageSettings(input), role).map((problem) => problem.kind);

describe("footage check rules", () => {
  it("passes clean vertical footage", () => {
    expect(kinds(GOOD)).toEqual([]);
  });

  it("flags the wrong shape and says what is needed", () => {
    const problems = footageProblems(
      { ...GOOD, width: 1920, height: 1080 },
      FOOTAGE_DEFAULTS,
      "body",
    );
    expect(problems.map((p) => p.kind)).toEqual(["shape"]);
    expect(problems[0].says).toBe("It is landscape (16:9) (1920×1080); vertical (9:16) is needed.");
    expect(kinds({ ...GOOD, width: 1920, height: 1080 }, "body", { shape: "horizontal" })).toEqual(
      [],
    );
    expect(kinds({ ...GOOD, width: 1920, height: 1080 }, "body", { shape: "any" })).toEqual([]);
    expect(footageShapeOf(1080, 1080)).toBe("square");
    expect(footageShapeOf(1080, 1150)).toBe("square");
  });

  it("flags too few pixels on the short side", () => {
    expect(kinds({ ...GOOD, width: 360, height: 640 })).toEqual(["resolution"]);
    expect(kinds({ ...GOOD, width: 720, height: 1280 })).toEqual([]);
    expect(kinds({ ...GOOD, width: 720, height: 1280 }, "body", { minShortSide: 1080 })).toEqual([
      "resolution",
    ]);
    expect(kinds({ ...GOOD, width: 360, height: 640 }, "body", { minShortSide: 0 })).toEqual([]);
  });

  it("flags missing, silent, quiet and clipped sound", () => {
    expect(kinds({ ...GOOD, has_audio: false })).toEqual(["no-sound"]);
    expect(kinds({ ...GOOD, loudness_lufs: null })).toEqual(["quiet"]);
    expect(kinds({ ...GOOD, loudness_lufs: -48 })).toEqual(["quiet"]);
    expect(kinds({ ...GOOD, loudness_lufs: -48 }, "body", { quietBelow: -50 })).toEqual([]);
    expect(kinds({ ...GOOD, peak_db: 0, peak_count: 799 })).toEqual(["clipped"]);
    // Touching full scale once or twice is not clipping.
    expect(kinds({ ...GOOD, peak_db: 0, peak_count: 2 })).toEqual([]);
  });

  it("flags black stretches over a second, not a short fade", () => {
    expect(kinds({ ...GOOD, black: [{ start: 0, end: 0.6 }] })).toEqual([]);
    const problems = footageProblems(
      { ...GOOD, black: [{ start: 0, end: 2 }] },
      FOOTAGE_DEFAULTS,
      "body",
    );
    expect(problems[0]).toEqual({
      kind: "black",
      says: "The picture is black for 2 s, from 0:00.",
    });
  });

  it("flags a frozen picture, but not one that is only black", () => {
    expect(
      kinds({ ...GOOD, black: [{ start: 0, end: 2 }], frozen: [{ start: 0, end: 2 }] }),
    ).toEqual(["black"]);
    const problems = footageProblems(
      { ...GOOD, frozen: [{ start: 64, end: 67.5 }] },
      FOOTAGE_DEFAULTS,
      "body",
    );
    expect(problems[0]).toEqual({ kind: "frozen", says: "The picture freezes for 3.5 s at 1:04." });
  });

  it("holds a body to the body length and a hook to the take length", () => {
    expect(kinds({ ...GOOD, duration: 3 }, "body")).toEqual(["short"]);
    expect(kinds({ ...GOOD, duration: 3 }, "hook")).toEqual([]);
    expect(kinds({ ...GOOD, duration: 0.6 }, "hook")).toEqual(["short"]);
  });

  it("calls a file it could not read a problem", () => {
    expect(kinds(null)).toEqual(["unreadable"]);
  });

  it("reads settings, keeping usual values for anything wrong", () => {
    expect(footageSettings({})).toEqual(FOOTAGE_DEFAULTS);
    expect(footageSettings({ shape: "round", minShortSide: "x", whenFound: "tell" })).toEqual({
      ...FOOTAGE_DEFAULTS,
      whenFound: "tell",
    });
    expect(footageSettings({ quietBelow: -200 }).quietBelow).toBe(-70);
  });
});

describe("what the team and the creator are told", () => {
  const files: CheckedFile[] = [
    { url: "a", name: "body.mp4", role: "body", problems: [] },
    {
      url: "b",
      name: "take2.mp4",
      role: "hook",
      problems: [
        { kind: "quiet", says: "The sound is very quiet (-48 LUFS; -35 or louder is needed)." },
      ],
    },
  ];

  it("sums up the check", () => {
    expect(footageSummary(files)).toBe("1 of 2 files need another look before editing.");
    expect(footageSummary([files[0]])).toBe("The footage is fine to edit.");
    expect(footageSummary([files[0], files[0]])).toBe("All 2 files are fine to edit.");
  });

  it("lists each problem file for the alert", () => {
    expect(footageMessage(files, true, "Jane")).toBe(
      "1 of 2 files need another look before editing from Jane. Editing has not started.\ntake2.mp4 (hook): The sound is very quiet (-48 LUFS; -35 or louder is needed).",
    );
    expect(footageMessage(files, false)).toContain("Editing went ahead anyway.");
  });

  it("writes a note the creator can act on", () => {
    const note = footageNote(files, true, new Date("2026-11-21T06:00:00Z"));
    expect(note).toContain("Footage check, 2026-11-21 06:00 UTC");
    expect(note).toContain("need to be filmed again or fixed before editing can start");
    expect(note).toContain("- take2.mp4 (hook)\n    The sound is very quiet");
    expect(note).not.toContain("body.mp4");
    expect(footageNote([files[0]], true, new Date(0))).toContain("Every file passed: body.mp4.");
  });
});
