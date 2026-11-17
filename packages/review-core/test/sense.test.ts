import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  measureCode,
  pacingOf,
  readMeasurements,
  senseFrom,
  transcriptNear,
  windowAround,
} from "../src/index";

describe("the stretch around a moment", () => {
  it("centres on the moment", () => {
    expect(windowAround(10, 6, 60)).toEqual({ start: 7, length: 6 });
  });
  it("stays inside the clip at its start and its end", () => {
    expect(windowAround(1, 6, 60)).toEqual({ start: 0, length: 6 });
    expect(windowAround(59, 6, 60)).toEqual({ start: 54, length: 6 });
  });
  it("is shorter than asked when the clip is", () => {
    expect(windowAround(2, 6, 4)).toEqual({ start: 0, length: 4 });
  });
  it("trusts the moment when the clip's length is not known", () => {
    expect(windowAround(20, 30, null)).toEqual({ start: 5, length: 30 });
  });
});

describe("pacing", () => {
  it("counts the cuts, the average shot and the shot the moment is in", () => {
    expect(pacingOf([4, 9, 30], 40, 6)).toEqual({
      cuts: 3,
      averageShot: 10,
      shot: { start: 4, end: 9 },
      cutsNear: [4, 9],
    });
  });
  it("one long take is one shot from start to end", () => {
    expect(pacingOf([], 12, 5)).toEqual({
      cuts: 0,
      averageShot: 12,
      shot: { start: 0, end: 12 },
      cutsNear: [],
    });
  });
});

describe("reading what the toolkit sent back", () => {
  it("keeps the numbers and drops anything else", () => {
    expect(
      readMeasurements({
        duration: 8,
        cuts: [4, "x", 2],
        loudness: -21.9,
        loudnessAtMoment: null,
        silences: [{ start: 3, end: 4.5 }, { start: "no" }, { start: 7, end: null }],
        hasAudio: true,
      }),
    ).toEqual({
      duration: 8,
      cuts: [2, 4],
      loudness: -21.9,
      loudnessAtMoment: null,
      silences: [
        { start: 3, end: 4.5 },
        { start: 7, end: null },
      ],
      hasAudio: true,
    });
  });
  it("cuts it could not look through in time stay unknown, not zero", () => {
    const measured = readMeasurements({
      duration: 3600,
      cuts: null,
      loudness: -18,
      loudnessAtMoment: null,
      silences: [],
      hasAudio: true,
    });
    expect(measured?.cuts).toBeNull();
    expect(senseFrom(measured, 10, null, null).pacing).toBeNull();
  });
  it("is null for something that is not a measurement", () => {
    expect(readMeasurements("Traceback: …")).toBeNull();
    expect(readMeasurements({ duration: 3 })).toBeNull();
  });
  it("puts the transcript on the clip's own clock", () => {
    expect(
      transcriptNear(
        [
          { start: 0.5, end: 2, text: " Welcome back. " },
          { start: 3, text: "" },
          { start: "x", text: "no" },
        ],
        12,
      ),
    ).toEqual([{ at: 12.5, text: "Welcome back." }]);
    expect(transcriptNear(null, 0)).toEqual([]);
  });
  it("names only the quiet gaps near the moment, and the one it is in", () => {
    const sense = senseFrom(
      {
        duration: 120,
        cuts: [],
        loudness: -16,
        loudnessAtMoment: -40,
        silences: [
          { start: 2, end: 3 },
          { start: 58, end: 63 },
          { start: 100, end: 101 },
        ],
        hasAudio: true,
      },
      60,
      { start: 57, length: 6 },
      null,
    );
    expect(sense.sound?.quietNear).toEqual([{ start: 58, end: 63 }]);
    expect(sense.frames).toEqual({ from: 57, every: 0.5, count: 12 });
  });
});

// The measuring script runs as the toolkit runs it: wrapped in its function template by
// /v1/code/execute/python, on a real clip, with the FFmpeg the toolkit has.
describe("the measuring script, on a real clip", () => {
  let dir: string;
  let clip: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "review-sense-"));
    clip = join(dir, "clip.mp4");
    // Two shots (a cut at 4s), sound with a quiet gap from 3s to 4.5s.
    execFileSync("ffmpeg", [
      ...["-loglevel", "error", "-y"],
      ...["-f", "lavfi", "-i", "testsrc2=s=320x180:d=4"],
      ...["-f", "lavfi", "-i", "smptebars=s=320x180:d=4"],
      ...["-f", "lavfi", "-i", "sine=f=440:d=3"],
      ...["-f", "lavfi", "-i", "anullsrc=d=1.5"],
      ...["-f", "lavfi", "-i", "sine=f=660:d=3.5"],
      "-filter_complex",
      "[0:v][1:v]concat=n=2:v=1:a=0[v];[2:a][3:a][4:a]concat=n=3:v=0:a=1[a]",
      ...["-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-c:a", "aac", "-shortest", clip],
    ]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function runAsToolkit(code: string) {
    const indented = code
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n");
    const script = join(dir, "run.py");
    writeFileSync(
      script,
      `import json, sys\ndef execute_code():\n${indented}\nprint(json.dumps(execute_code()))\n`,
    );
    return JSON.parse(execFileSync("python3", [script], { encoding: "utf8" }));
  }

  it("finds the cut, the loudness and the quiet gap", () => {
    const measured = readMeasurements(runAsToolkit(measureCode(clip, 2)));
    expect(measured).not.toBeNull();
    expect(measured?.duration).toBeCloseTo(8, 0);
    expect(measured?.hasAudio).toBe(true);
    expect(measured?.cuts).toHaveLength(1);
    expect(measured?.cuts?.[0]).toBeCloseTo(4, 0);
    expect(measured?.loudness).toBeLessThan(0);
    expect(measured?.loudnessAtMoment).toBeLessThan(0);
    expect(measured?.silences).toHaveLength(1);
    expect(measured?.silences[0].start).toBeCloseTo(3, 0);
    expect(measured?.silences[0].end).toBeCloseTo(4.5, 0);
  });

  it("an address with quotes in it stays one string", () => {
    const measured = readMeasurements(runAsToolkit(measureCode(`${clip}"; import os #`, 1)));
    expect(measured).toMatchObject({ duration: null, cuts: [], hasAudio: false });
  });
});
