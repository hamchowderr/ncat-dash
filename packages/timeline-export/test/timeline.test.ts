import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type CutList,
  type CutSource,
  clipsCutList,
  cutCues,
  editorFiles,
  fcp7Xml,
  fcpXml,
  fileNameOf,
  formatSrt,
  framePieces,
  frameTime,
  isCuttingStep,
  keptPieces,
  parseSrt,
  parseTime,
  rateOf,
  stepTimelines,
} from "../src";

const source = (fps: number, more: Partial<CutSource> = {}): CutSource => ({
  url: "https://files.example.com/team/Episode%2012%20%26%20more.mp4?X-Amz-Signature=abc",
  fps,
  width: 1920,
  height: 1080,
  duration: 600,
  hasAudio: true,
  audioChannels: 2,
  audioSampleRate: 48000,
  ...more,
});

/** A recording with three kept parts, as cutting silences leaves it. */
const silences = (fps: number): CutList => ({
  name: "Episode 12",
  timelines: [
    {
      name: "Episode 12 without pauses",
      source: source(fps),
      pieces: [
        { start: 0, seconds: 12.5 },
        { start: 14.2, seconds: 30.31 },
        { start: 50, seconds: 8 },
      ],
    },
  ],
});

describe("frame rates", () => {
  it("tells NTSC rates from whole ones", () => {
    expect(rateOf(23.976)).toEqual({ timebase: 24, ntsc: true });
    expect(rateOf(24)).toEqual({ timebase: 24, ntsc: false });
    expect(rateOf(25)).toEqual({ timebase: 25, ntsc: false });
    expect(rateOf(29.97002997)).toEqual({ timebase: 30, ntsc: true });
    expect(rateOf(30)).toEqual({ timebase: 30, ntsc: false });
    expect(rateOf(59.94)).toEqual({ timebase: 60, ntsc: true });
    expect(rateOf(60)).toEqual({ timebase: 60, ntsc: false });
  });

  it("writes time as whole fractions of a second", () => {
    expect(frameTime(0, rateOf(29.97))).toBe("0s");
    expect(frameTime(1, rateOf(29.97))).toBe("1001/30000s");
    expect(frameTime(30000, rateOf(29.97))).toBe("1001s");
    expect(frameTime(1, rateOf(25))).toBe("1/25s");
    expect(frameTime(50, rateOf(25))).toBe("2s");
  });
});

describe("pieces in frames", () => {
  it("lays pieces back to back with no gap or overlap", () => {
    const pieces = framePieces(silences(25).timelines[0]);
    expect(pieces).toEqual([
      { in: 0, out: 313, at: 0 },
      { in: 355, out: 1113, at: 313 },
      { in: 1250, out: 1450, at: 1071 },
    ]);
  });

  it("never reaches past the end of the recording and drops empty pieces", () => {
    const pieces = framePieces({
      name: "x",
      source: source(30, { duration: 10 }),
      pieces: [
        { start: 8, seconds: 5 },
        { start: 9.99, seconds: 0.001 },
        { start: 20, seconds: 3 },
      ],
    });
    expect(pieces).toEqual([{ in: 240, out: 300, at: 0 }]);
  });
});

describe("file names", () => {
  it("takes the name from a signed link", () => {
    expect(fileNameOf(source(30).url)).toBe("Episode 12 & more.mp4");
  });
});

describe("the files", () => {
  it("escapes names and never leaks the signed link", () => {
    for (const text of [fcp7Xml(silences(30)), fcpXml(silences(30))]) {
      expect(text).toContain("Episode 12 &amp; more");
      expect(text).toContain("Episode%2012%20%26%20more.mp4");
      expect(text).not.toContain("X-Amz-Signature");
      expect(text).not.toContain("files.example.com");
    }
  });

  it("gives a vertical clip a vertical timeline", () => {
    const list = clipsCutList(
      "Episode 12",
      [
        { source: "a", part: 1, parts: 2, start: 0, seconds: 50 },
        { source: "a", part: 2, parts: 2, start: 50, seconds: 40 },
        { source: "missing", part: 1, parts: 1, start: 0, seconds: 10 },
      ],
      { a: source(29.97) },
      { width: 1080, height: 1920 },
    );
    expect(list.timelines.map((timeline) => timeline.name)).toEqual([
      "Episode 12 & more 1 of 2",
      "Episode 12 & more 2 of 2",
    ]);
    expect(fcp7Xml(list)).toContain("<width>1080</width><height>1920</height>");
    expect(fcpXml(list)).toContain('width="1080" height="1920"');
  });

  it("leaves sound out for a silent recording", () => {
    const list: CutList = {
      name: "Silent",
      timelines: [
        {
          name: "Silent",
          source: source(30, { hasAudio: false }),
          pieces: [{ start: 1, seconds: 2 }],
        },
      ],
    };
    expect(fcp7Xml(list)).not.toContain("<sourcetrack>");
    expect(fcpXml(list)).not.toContain("hasAudio");
  });
});

describe("files per editor", () => {
  it("gives each editor the file it opens, and a note on opening it", () => {
    const names = (editors: Parameters<typeof editorFiles>[1]) =>
      editorFiles(silences(30), editors).map((file) => file.name);
    expect(names(["premiere", "resolve", "finalcut", "capcut"])).toEqual([
      "Episode 12.xml",
      "Episode 12.fcpxml",
      "How to open.txt",
    ]);
    expect(names(["resolve"])).toEqual(["Episode 12.xml", "How to open.txt"]);
    expect(names(["finalcut"])).toEqual(["Episode 12.fcpxml", "How to open.txt"]);
    // CapCut opens no timeline, so on its own there is nothing to hand over.
    expect(names(["capcut"])).toEqual([]);
    expect(names([])).toEqual([]);
  });

  it("names the recording to keep beside the timeline, and makes file names safe", () => {
    const files = editorFiles({ ...silences(30), name: 'Ep 12: "final" / v2' }, ["premiere"]);
    expect(files[0].name).toBe("Ep 12 final v2.xml");
    expect(files[0].editors).toEqual(["Premiere Pro"]);
    expect(files[1].text).toContain("Episode 12 & more.mp4");
    expect(files[1].text).toContain("Premiere Pro: File > Import");
    expect(files[1].text).not.toContain("Final Cut Pro:");
  });
});

describe("captions", () => {
  const srt =
    "1\n00:00:01,000 --> 00:00:03,500\nHello there\n\n2\n00:00:13,000 --> 00:00:15,000\nCut away\n\n3\n00:00:20,000 --> 00:00:22,000\nSecond part\nline two\n";

  it("reads and writes SRT", () => {
    const cues = parseSrt(srt);
    expect(cues).toHaveLength(3);
    expect(cues[2]).toEqual({ start: 20, end: 22, text: "Second part\nline two" });
    expect(formatSrt(cues)).toBe(srt);
  });

  it("moves captions to where their words sit after the cuts", () => {
    const moved = cutCues(parseSrt(srt), [
      { start: 0, seconds: 3 },
      { start: 19, seconds: 5 },
    ]);
    expect(moved).toEqual([
      { start: 1, end: 3, text: "Hello there" },
      { start: 4, end: 6, text: "Second part\nline two" },
    ]);
  });
});

const hasXmllint = spawnSync("xmllint", ["--version"]).status === 0;
const hasOtio =
  spawnSync("python3", ["-c", "import opentimelineio, otio_fcp_adapter"]).status === 0;
const hasOtioFcpx =
  hasOtio && spawnSync("python3", ["-c", "import otio_fcpx_xml_adapter"]).status === 0;
const RATES = [23.976, 25, 29.97, 30, 60];

describe("the toolkit's cutting steps", () => {
  const recording = source(25, { url: "https://files.example.com/team/Episode%2012.mp4?sig=abc" });

  it("reads times the way the toolkit takes them", () => {
    expect(parseTime("00:01:30")).toBe(90);
    expect(parseTime("01:30.5")).toBe(90.5);
    expect(parseTime("90")).toBe(90);
    expect(parseTime(12.25)).toBe(12.25);
    expect(parseTime("1:02:03.250")).toBe(3723.25);
    expect(parseTime("soon")).toBeNull();
    expect(parseTime(-1)).toBeNull();
    expect(parseTime(undefined)).toBeNull();
  });

  it("knows which steps cut", () => {
    expect(isCuttingStep("video-trim")).toBe(true);
    expect(isCuttingStep("video-caption")).toBe(false);
  });

  it("keeps what is left once parts are removed", () => {
    expect(
      keptPieces(
        [
          { start: "00:00:50", end: "00:01:00" },
          { start: "00:00:10", end: "00:00:20" },
          { start: "00:00:15", end: "00:00:25" },
          { start: "later", end: "00:02:00" },
        ],
        120,
      ),
    ).toEqual([
      { start: 0, seconds: 10 },
      { start: 25, seconds: 25 },
      { start: 60, seconds: 60 },
    ]);
    expect(keptPieces([{ start: "0", end: "999" }], 120)).toEqual([]);
    expect(keptPieces([], 120)).toEqual([{ start: 0, seconds: 120 }]);
  });

  it("gives Trim one timeline with the kept part", () => {
    expect(stepTimelines("video-trim", { start: "00:00:05", end: "00:00:20" }, recording)).toEqual([
      { name: "Episode 12 trimmed", source: recording, pieces: [{ start: 5, seconds: 15 }] },
    ]);
    // A missing end means the end of the recording.
    expect(stepTimelines("video-trim", { start: "00:09:00" }, recording)[0].pieces).toEqual([
      { start: 540, seconds: 60 },
    ]);
    expect(stepTimelines("video-trim", { start: "x" }, recording)).toEqual([]);
  });

  it("gives Cut one timeline and Split one per part", () => {
    const cut = stepTimelines(
      "video-cut",
      { cuts: [{ start: "00:01:00", end: "00:02:00" }] },
      recording,
    );
    expect(cut).toHaveLength(1);
    expect(cut[0].name).toBe("Episode 12 cut");
    expect(cut[0].pieces).toEqual([
      { start: 0, seconds: 60 },
      { start: 120, seconds: 480 },
    ]);
    const split = stepTimelines(
      "video-split",
      {
        splits: [
          { start: "00:00:00", end: "00:05:00" },
          { start: "00:05:00", end: "00:10:00" },
        ],
      },
      recording,
    );
    expect(split.map((timeline) => timeline.name)).toEqual([
      "Episode 12 1 of 2",
      "Episode 12 2 of 2",
    ]);
    expect(split[1].pieces).toEqual([{ start: 300, seconds: 300 }]);
    expect(stepTimelines("video-split", {}, recording)).toEqual([]);
  });

  it("opens in other tools like any other cut list", () => {
    const list = {
      name: "Trim and split",
      timelines: stepTimelines("video-cut", { cuts: [{ start: "10", end: "20" }] }, recording),
    };
    expect(fcp7Xml(list)).toContain("<name>Episode 12 cut</name>");
    expect(fcpXml(list)).toContain('name="Episode 12 cut"');
  });
});

describe("caption files per timeline", () => {
  const list = silences(25);
  const url = list.timelines[0].source.url;
  const cues = [
    { start: 1, end: 3, text: "Hello" },
    { start: 13, end: 14, text: "In a pause" },
    { start: 15, end: 17, text: "Back again" },
  ];

  it("adds one captions file per timeline, timed to the cut", () => {
    const files = editorFiles(list, ["premiere"], { [url]: cues });
    expect(files.map((file) => file.name)).toEqual([
      "Episode 12.xml",
      "Episode 12 without pauses.srt",
      "How to open.txt",
    ]);
    const captions = files[1];
    expect(captions.captions).toBe(true);
    const moved = parseSrt(captions.text);
    expect(moved.map((cue) => cue.text)).toEqual(["Hello", "Back again"]);
    // "Back again" starts 0.8s into the second piece, which now sits at 12.5s.
    expect(moved[1].start).toBeCloseTo(13.3, 2);
    expect(files[2].text).toContain("4. Import the .srt file");
  });

  it("adds none when the recording has no captions", () => {
    const files = editorFiles(list, ["premiere"], { "https://elsewhere.example.com/a.mp4": cues });
    expect(files.some((file) => file.captions)).toBe(false);
    expect(files.at(-1)?.text).not.toContain("4. Import");
  });

  it("keeps caption file names apart", () => {
    const twice = { name: "Twice", timelines: [list.timelines[0], list.timelines[0]] };
    const names = editorFiles(twice, ["finalcut"], { [url]: cues }).map((file) => file.name);
    expect(names).toContain("Episode 12 without pauses.srt");
    expect(names).toContain("Episode 12 without pauses 2.srt");
  });
});

describe("read back by other tools", () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "timeline-"));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const write = (name: string, text: string) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    return file;
  };
  const readBack = (file: string, adapter: string) =>
    JSON.parse(
      execFileSync(
        "python3",
        [path.join(path.dirname(fileURLToPath(import.meta.url)), "read_back.py"), file, adapter],
        { encoding: "utf8" },
      ),
    ) as {
      name: string;
      video: {
        in: number;
        frames: number;
        at: number;
        rate: number;
        atRate: number;
        file: string | null;
      }[][];
      audio: { in: number; frames: number; at: number }[][];
    }[];

  it.skipIf(!hasXmllint)("is well-formed XML", () => {
    for (const fps of RATES) {
      execFileSync("xmllint", ["--noout", write(`a-${fps}.xml`, fcp7Xml(silences(fps)))]);
      execFileSync("xmllint", ["--noout", write(`a-${fps}.fcpxml`, fcpXml(silences(fps)))]);
    }
  });

  it.skipIf(!hasOtio)("Final Cut 7 XML holds the same cuts when OpenTimelineIO reads it", () => {
    for (const fps of RATES) {
      const list = silences(fps);
      const expected = framePieces(list.timelines[0]);
      const [timeline] = readBack(write(`b-${fps}.xml`, fcp7Xml(list)), "fcp_xml");
      expect(timeline.name).toBe("Episode 12 without pauses");
      expect(timeline.video).toHaveLength(1);
      expect(timeline.audio).toHaveLength(2);
      const cuts = (clips: { in: number; frames: number; at: number }[]) =>
        clips.map((clip) => ({ in: clip.in, out: clip.in + clip.frames, at: clip.at }));
      expect(cuts(timeline.video[0])).toEqual(expected);
      expect(cuts(timeline.audio[0])).toEqual(expected);
      expect(cuts(timeline.audio[1])).toEqual(expected);
      expect(timeline.video[0][0].file).toContain("Episode%2012%20%26%20more.mp4");
    }
  });

  it.skipIf(!hasOtio)("Final Cut 7 XML holds every clip timeline", () => {
    const list = clipsCutList(
      "Episode 12",
      [
        { source: "a", part: 1, parts: 2, start: 0, seconds: 50 },
        { source: "a", part: 2, parts: 2, start: 50, seconds: 40 },
      ],
      { a: source(29.97) },
    );
    const timelines = readBack(write("clips.xml", fcp7Xml(list)), "fcp_xml");
    expect(timelines.map((timeline) => timeline.name)).toEqual([
      "Episode 12 & more 1 of 2",
      "Episode 12 & more 2 of 2",
    ]);
    expect(timelines[1].video[0][0]).toMatchObject({ in: 1499, frames: 1198, at: 0 });
  });

  it.skipIf(!hasOtioFcpx)("FCPXML holds the same cuts when OpenTimelineIO reads it", () => {
    for (const fps of RATES) {
      const list = silences(fps);
      const expected = framePieces(list.timelines[0]);
      const [timeline] = readBack(write(`c-${fps}.fcpxml`, fcpXml(list)), "fcpx_xml");
      expect(timeline.name).toBe("Episode 12 without pauses");
      const clips = timeline.video[0];
      expect(clips).toHaveLength(expected.length);
      // This reader rounds an NTSC rate down to a whole number (23.976 becomes 23), so its
      // frame counts are compared as seconds, to within one of its frames.
      const rate = rateOf(fps);
      const real = rate.ntsc ? (rate.timebase * 1000) / 1001 : rate.timebase;
      clips.forEach((clip, index) => {
        const slack = rate.ntsc ? 1 / clip.rate + 1e-6 : 1e-6;
        expect(Math.abs(clip.in / clip.rate - expected[index].in / real)).toBeLessThanOrEqual(
          slack,
        );
        expect(
          Math.abs(clip.frames / clip.rate - (expected[index].out - expected[index].in) / real),
        ).toBeLessThanOrEqual(slack);
        // Its timeline positions at NTSC rates mix two rates, so those are checked at
        // whole rates only.
        if (!rate.ntsc) expect(clip.at).toBe(expected[index].at);
      });
    }
  });
});
