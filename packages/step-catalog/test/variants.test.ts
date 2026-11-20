import { execFile, execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clockSeconds,
  endBefore,
  type FileFacts,
  getStep,
  lengthCut,
  type MediaFacts,
  mergePieces,
  parseLengths,
  parseStarts,
  readFacts,
  readPauses,
  shapeCode,
  snapToPause,
  startCode,
  StepSetupError,
  takesOf,
  BODY_ONLY,
  variantCodes,
  variantCuts,
  variantRecipes,
} from "../src";

type Option = { option: string; argument?: string | number };
type ComposeRequest = {
  inputs: { file_url: string; options?: Option[] }[];
  filters: { filter: string }[];
  outputs: { options: Option[] }[];
};

const BASE = "https://files.example.com/";
const at = (file: string) => `${BASE}${file}`;

// The samples made in beforeAll. base.mp4 is a 12 s vertical "ad" whose sound goes quiet
// from 2.8 to 3.4 s (after the hook) and from 8.6 to 9.2 s (before the call to action).
const BASE_PAUSES = [
  { start: 2.8, end: 3.4 },
  { start: 8.6, end: 9.2 },
];
const FACTS: Record<string, MediaFacts> = {
  "base.mp4": {
    duration: 12,
    width: 1080,
    height: 1920,
    fps: 30,
    hasAudio: true,
    hasVideo: true,
    pauses: BASE_PAUSES,
  },
  "hook2.mp4": { duration: 2.5, width: 720, height: 1280, fps: 30, hasAudio: true, hasVideo: true },
  "hook3.mp4": { duration: 3, width: 1280, height: 720, fps: 25, hasAudio: false, hasVideo: true },
  "cta2.mp4": { duration: 2, width: 1080, height: 1920, fps: 30, hasAudio: true, hasVideo: true },
  "song.mp3": { duration: 40, hasAudio: true, hasVideo: false },
};

const SAMPLE: Record<string, Record<string, unknown>> = {
  "recipe-hook-variants": {
    video_url: at("base.mp4"),
    hook_2_url: at("hook2.mp4"),
    hook_3_url: at("hook3.mp4"),
    ending_2_url: at("cta2.mp4"),
    ending_seconds: 3,
  },
  "recipe-length-cuts": { video_url: at("base.mp4"), lengths: "6, 10, 30" },
  "recipe-opening-lines": {
    video_url: at("base.mp4"),
    line_1: "Stop scrolling: this changed my mornings",
    line_2: "I wish I knew this at 20",
  },
  "recipe-song-teasers": { media_url: at("song.mp3"), length: 8 },
};

function factsFor(id: string, input: Record<string, unknown>): FileFacts {
  const facts: FileFacts = {};
  for (const field of getStep(id)!.readsFirst ?? []) {
    const value = input[field];
    if (typeof value === "string") facts[field] = FACTS[value.slice(BASE.length)];
  }
  return facts;
}

function build(id: string, extra: Record<string, unknown> = {}) {
  const step = getStep(id)!;
  const input = step.input.parse({ ...SAMPLE[id], ...extra }) as Record<string, unknown>;
  return {
    request: step.toRequest!(input, factsFor(id, input)) as ComposeRequest,
    labels: step.outputLabels!(input, 0),
  };
}

describe("variant steps", () => {
  it("are all in the catalog, with a sample, and build what compose accepts", () => {
    expect(variantRecipes.map((step) => step.id)).toEqual(Object.keys(SAMPLE));
    const compose = getStep("ffmpeg-compose")!;
    for (const step of variantRecipes) {
      expect(getStep(step.id)).toBe(step);
      const { request, labels } = build(step.id);
      expect(() => compose.input.strict().parse(request), step.id).not.toThrow();
      // One code for every file made, so each one is named for what is in it.
      expect(labels, step.id).toHaveLength(request.outputs.length);
    }
  });

  it("names every hook and ending pairing", () => {
    expect(variantCodes(3, 2)).toEqual([
      "h01_c01",
      "h01_c02",
      "h02_c01",
      "h02_c02",
      "h03_c01",
      "h03_c02",
    ]);
    expect(build("recipe-hook-variants").labels).toEqual(variantCodes(3, 2));
    expect(build("recipe-hook-variants", { ending_2_url: undefined }).labels).toEqual([
      "h01_c01",
      "h02_c01",
      "h03_c01",
    ]);
  });

  it("swaps takes in where the base cut pauses, not mid-word", () => {
    expect(
      variantCuts({
        duration: 12,
        openingSeconds: 3,
        endingSeconds: 3,
        hasOtherEndings: true,
        pauses: BASE_PAUSES,
      }),
    ).toEqual({ openingEnd: 3, endingStart: 9 });
    // No pause near: the seconds as set; no other endings: the middle runs to the end.
    expect(
      variantCuts({ duration: 12, openingSeconds: 5, endingSeconds: 3, hasOtherEndings: false }),
    ).toEqual({ openingEnd: 5, endingStart: 12 });
    expect(() =>
      variantCuts({ duration: 4, openingSeconds: 3, endingSeconds: 3, hasOtherEndings: true }),
    ).toThrow(StepSetupError);
  });

  it("puts every take around a base cut that is only the body", () => {
    const body = {
      base_cut: BODY_ONLY,
      hook_1_url: at("hook2.mp4"),
      hook_2_url: at("hook3.mp4"),
      hook_3_url: undefined,
      ending_1_url: at("cta2.mp4"),
      ending_2_url: undefined,
    };
    const { request, labels } = build("recipe-hook-variants", body);
    // Two hooks, one ending: h01 and h02, each with the one ending take.
    expect(labels).toEqual(["h01_c01", "h02_c01"]);
    expect(request.outputs).toHaveLength(2);
    expect(request.inputs.map((input) => input.file_url)).toEqual([
      at("base.mp4"),
      at("hook2.mp4"),
      at("hook3.mp4"),
      at("cta2.mp4"),
    ]);
    // The whole body is used: nothing of it is trimmed off as a hook or an ending.
    expect(request.filters.some(({ filter }) => filter.startsWith("[v0x0]trim"))).toBe(false);
    // No ending takes: the body's own end closes each video.
    expect(build("recipe-hook-variants", { ...body, ending_1_url: undefined }).labels).toEqual([
      "h01_c01",
      "h02_c01",
    ]);
    // Takes 2 on still count with a base cut that has its own hook, but take 1 does not.
    expect(takesOf({ hook_1_url: at("a"), hook_2_url: at("b") })).toEqual({
      bodyOnly: false,
      hooks: ["hook_2_url"],
      endings: [],
    });
    const step = getStep("recipe-hook-variants")!;
    const only = step.input.parse({ video_url: at("base.mp4"), base_cut: BODY_ONLY });
    expect(() => step.toRequest!(only, { video_url: FACTS["base.mp4"] })).toThrow(/hook take/);
  });

  it("needs another take and the base cut's size and length", () => {
    const step = getStep("recipe-hook-variants")!;
    const only = step.input.parse({ video_url: at("base.mp4") });
    expect(() => step.toRequest!(only, { video_url: FACTS["base.mp4"] })).toThrow(/other hook/);
    const input = step.input.parse(SAMPLE["recipe-hook-variants"]);
    expect(() => step.toRequest!(input, {})).toThrow(/length could not be read/);
  });

  it("joins pieces of the same take into one stretch", () => {
    expect(
      mergePieces([{ input: 0, start: 0, end: 3 }, { input: 0, start: 3, end: 9 }, { input: 1 }]),
    ).toEqual([{ input: 0, start: 0, end: 9 }, { input: 1 }]);
  });

  it("snaps to the nearest pause within reach", () => {
    expect(snapToPause(3, BASE_PAUSES)).toBe(3);
    expect(snapToPause(2, BASE_PAUSES)).toBeCloseTo(3.1);
    expect(snapToPause(6, BASE_PAUSES)).toBe(6);
    expect(snapToPause(6, undefined)).toBe(6);
    expect(endBefore(10, BASE_PAUSES)).toBeCloseTo(8.85);
    expect(endBefore(3, BASE_PAUSES)).toBe(3);
    expect(endBefore(20, BASE_PAUSES)).toBe(20);
  });

  it("cuts each length from the start, ending in a pause", () => {
    expect(lengthCut({ duration: 12, target: 10, keepEnding: 0, pauses: BASE_PAUSES })).toEqual([
      { start: 0, end: 8.85 },
    ]);
    // Already short enough: kept whole.
    expect(lengthCut({ duration: 12, target: 30, keepEnding: 0 })).toEqual([{ start: 0, end: 12 }]);
  });

  it("keeps the call to action on the end of a cut", () => {
    // 6 s with the last 3 kept: speech starts again at 9 s, so 3 s of it, plus the start
    // up to 3 s, which falls in the first pause.
    const parts = lengthCut({ duration: 12, target: 6, keepEnding: 3, pauses: BASE_PAUSES });
    expect(parts).toEqual([
      { start: 0, end: 3 },
      { start: 9, end: 12 },
    ]);
    const total = parts.reduce((sum, part) => sum + part.end - part.start, 0);
    expect(total).toBeLessThanOrEqual(6);
  });

  it("reads lengths and starts as people write them", () => {
    expect(parseLengths("60, 15,6, 15, 2")).toEqual([6, 15, 60]);
    expect(parseStarts("0:45, 1:30, 12")).toEqual([45, 90, 12]);
    expect(parseStarts(" ")).toEqual([]);
    expect(startCode(45)).toBe("from0m45s");
    expect(startCode(92.5)).toBe("from1m32s");
    expect(build("recipe-length-cuts").labels).toEqual(["6s", "10s", "30s"]);
    expect(build("recipe-song-teasers", { starts: "0:05, 0:20" }).labels).toEqual([
      "from0m05s",
      "from0m20s",
    ]);
    expect(build("recipe-opening-lines").labels).toEqual(["t01", "t02"]);
    expect(() =>
      getStep("recipe-length-cuts")!.input.parse({ video_url: at("a"), lengths: "a" }),
    ).toThrow();
  });

  it("codes each ad shape the way buyers name them", () => {
    expect(shapeCode(1080, 1920)).toBe("9x16");
    expect(shapeCode(1080, 1350)).toBe("4x5");
    expect(shapeCode(1920, 1080)).toBe("16x9");
    expect(getStep("recipe-blur-fill")!.outputLabels!({ width: 1080, height: 1080 }, 1)).toEqual([
      "1x1",
    ]);
    expect(getStep("recipe-blur-fill")!.labelsFollow).toBe(true);
    expect(getStep("video-caption")!.labelsFollow).toBe(true);
  });

  it("reads only the start of a long video when no ending is kept", () => {
    const { request } = build("recipe-length-cuts", { lengths: "6" });
    expect(request.inputs[0].options).toEqual([{ option: "-t", argument: "7" }]);
    expect(
      build("recipe-length-cuts", { ending_seconds: 3 }).request.inputs[0].options,
    ).toBeUndefined();
  });
});

describe("reading pauses", () => {
  it("turns the toolkit's silence answer into seconds", () => {
    expect(clockSeconds("00:01:02.500")).toBe(62.5);
    expect(clockSeconds(4)).toBe(4);
    expect(
      readPauses([
        { start: "00:00:08.600", end: "00:00:09.200", duration: 0.6 },
        { start: "00:00:02.800", end: "00:00:03.400", duration: 0.6 },
        { start: "bad", end: "00:00:01" },
      ]),
    ).toEqual([
      { start: 2.8, end: 3.4 },
      { start: 8.6, end: 9.2 },
    ]);
  });

  it("asks the toolkit for pauses after the length, only for steps that cut in them", async () => {
    const asked: string[] = [];
    const fetch = (async (address: string) => {
      asked.push(new URL(address).pathname);
      const response = address.endsWith("/v1/media/metadata")
        ? { duration: 12, width: 1080, height: 1920, has_audio: true, has_video: true }
        : [{ start: "00:00:02.800", end: "00:00:03.400", duration: 0.6 }];
      return new Response(JSON.stringify({ code: 200, response }));
    }) as typeof globalThis.fetch;
    const connection = { baseUrl: "https://toolkit.example.com", apiKey: "k" };
    const facts = await readFacts(
      connection,
      getStep("recipe-length-cuts")!,
      { video_url: at("base.mp4") },
      { fetch },
    );
    expect(asked).toEqual(["/v1/media/metadata", "/v1/media/silence"]);
    expect(facts.video_url?.pauses).toEqual([{ start: 2.8, end: 3.4 }]);

    asked.length = 0;
    await readFacts(
      connection,
      getStep("recipe-opening-lines")!,
      { video_url: at("a.mp4") },
      { fetch },
    );
    expect(asked).toEqual(["/v1/media/metadata"]);
  });
});

const runFile = promisify(execFile);
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

/** Each variant step on a real FFmpeg, built the way the toolkit's compose route builds it. */
describe.skipIf(!hasFfmpeg)("variant steps on a real FFmpeg", () => {
  let dir = "";
  const ffmpeg = (args: string[]) =>
    runFile("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { timeout: 180_000 });
  const probe = (file: string, entries: string, stream = "v:0") =>
    execFileSync("ffprobe", [
      ...["-v", "error", "-select_streams", stream],
      ...["-show_entries", entries, "-of", "csv=p=0:s=x", file],
    ])
      .toString()
      .trim();
  const length = (file: string) =>
    Number(
      execFileSync("ffprobe", [
        ...["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      ]).toString(),
    );

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "variants-"));
    // A tone that goes quiet in the two pauses, as speech would.
    await ffmpeg([
      ...["-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=12"],
      ...["-f", "lavfi", "-i", "sine=frequency=300:duration=12"],
      ...["-af", "volume=enable='between(t,2.8,3.4)+between(t,8.6,9.2)':volume=0"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac"],
      path.join(dir, "base.mp4"),
    ]);
    const clip = (name: string, size: string, rate: number, seconds: number, sound: boolean) =>
      ffmpeg([
        ...["-f", "lavfi", "-i", `testsrc=size=${size}:rate=${rate}:duration=${seconds}`],
        ...(sound ? ["-f", "lavfi", "-i", `sine=frequency=500:duration=${seconds}`] : []),
        ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"],
        ...(sound ? ["-c:a", "aac"] : ["-an"]),
        path.join(dir, name),
      ]);
    await clip("hook2.mp4", "720x1280", 30, 2.5, true);
    await clip("hook3.mp4", "1280x720", 25, 3, false);
    await clip("cta2.mp4", "1080x1920", 30, 2, true);
    await ffmpeg([
      ...["-f", "lavfi", "-i", "sine=frequency=220:duration=40"],
      path.join(dir, "song.mp3"),
    ]);
  }, 120_000);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  async function run(request: ComposeRequest, name: string): Promise<string[]> {
    const args: string[] = [];
    for (const input of request.inputs) {
      for (const item of input.options ?? []) {
        args.push(item.option);
        if (item.argument !== undefined) args.push(String(item.argument));
      }
      args.push("-i", path.join(dir, input.file_url.slice(BASE.length)));
    }
    if (request.filters.length > 0) {
      args.push("-filter_complex", request.filters.map((item) => item.filter).join(";"));
    }
    const outputs = request.outputs.map((output, index) => {
      for (const item of output.options) {
        args.push(item.option);
        if (item.argument !== undefined) args.push(String(item.argument));
      }
      const format = String(output.options.find((item) => item.option === "-f")?.argument);
      const file = path.join(dir, `${name}-${index}.${format === "mp3" ? "mp3" : "mp4"}`);
      args.push(file);
      return file;
    });
    await ffmpeg(args);
    return outputs;
  }

  it("makes every hook and ending pairing at the base cut's size", async () => {
    const files = await run(build("recipe-hook-variants").request, "variants");
    expect(files).toHaveLength(6);
    // Base hook (0 to 3 s) + middle (3 to 9 s) + base ending (9 to 12 s) is the base.
    expect(length(files[0])).toBeCloseTo(12, 0);
    // The 2.5 s hook in place of the 3 s one, then the 2 s ending in place of 3 s.
    expect(length(files[3])).toBeCloseTo(2.5 + 6 + 2, 0);
    // The silent, wide hook is fitted into the vertical frame, and has quiet under it.
    expect(length(files[4])).toBeCloseTo(3 + 6 + 3, 0);
    for (const file of files) {
      expect(probe(file, "stream=width,height")).toBe("1080x1920");
      expect(probe(file, "stream=codec_type", "a")).toBe("audio");
    }
  }, 180_000);

  it("puts each hook take in front of the whole body, then each ending", async () => {
    const files = await run(
      build("recipe-hook-variants", {
        base_cut: BODY_ONLY,
        hook_1_url: at("hook2.mp4"),
        hook_2_url: at("hook3.mp4"),
        hook_3_url: undefined,
        ending_1_url: at("cta2.mp4"),
        ending_2_url: undefined,
      }).request,
      "body-only",
    );
    expect(files).toHaveLength(2);
    // 2.5 s hook + the whole 12 s body + 2 s ending; then the 3 s silent, wide hook.
    expect(length(files[0])).toBeCloseTo(2.5 + 12 + 2, 0);
    expect(length(files[1])).toBeCloseTo(3 + 12 + 2, 0);
    for (const file of files) expect(probe(file, "stream=width,height")).toBe("1080x1920");
  }, 180_000);

  it("cuts each length, never longer than asked", async () => {
    const files = await run(build("recipe-length-cuts").request, "lengths");
    expect(files).toHaveLength(3);
    expect(length(files[0])).toBeLessThanOrEqual(6.1);
    // 10 s ends in the pause at 8.6 s rather than mid-word.
    expect(length(files[1])).toBeCloseTo(8.85, 0);
    // 30 s: the 12 s video is kept whole.
    expect(length(files[2])).toBeCloseTo(12, 0);
    const [withEnding] = await run(
      build("recipe-length-cuts", { lengths: "6", ending_seconds: 3 }).request,
      "lengths-ending",
    );
    expect(length(withEnding)).toBeCloseTo(6, 0);
  }, 180_000);

  it("writes one opening line on each copy", async () => {
    const files = await run(build("recipe-opening-lines").request, "lines");
    expect(files).toHaveLength(2);
    for (const file of files) expect(length(file)).toBeCloseTo(12, 0);
    // The line is there at the start and gone after its seconds.
    const frame = (file: string, at: string) =>
      execFileSync("ffmpeg", [
        ...["-hide_banner", "-loglevel", "error", "-ss", at, "-i", file],
        ...["-frames:v", "1", "-vf", "scale=108:192"],
        ...["-f", "rawvideo", "-pix_fmt", "gray", "-"],
      ]);
    const difference = (a: Buffer, b: Buffer) => {
      let total = 0;
      for (let index = 0; index < a.length; index++) total += Math.abs(a[index] - b[index]);
      return total / a.length;
    };
    const source = path.join(dir, "base.mp4");
    expect(difference(frame(files[0], "1"), frame(files[1], "1"))).toBeGreaterThan(1);
    expect(difference(frame(files[0], "1"), frame(source, "1"))).toBeGreaterThan(1);
    expect(difference(frame(files[0], "6"), frame(source, "6"))).toBeLessThan(1);
  }, 180_000);

  it("cuts teasers from a song as MP3s of the length asked", async () => {
    const files = await run(build("recipe-song-teasers").request, "teasers");
    expect(files).toHaveLength(3);
    for (const file of files) {
      expect(file.endsWith(".mp3")).toBe(true);
      expect(length(file)).toBeCloseTo(8, 0);
    }
  }, 180_000);
});
