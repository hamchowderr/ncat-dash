import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getStep } from "@ncat-dash/step-catalog";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BUILT_IN_STYLES,
  clipRequest,
  durationOf,
  type Frame,
  formatLimit,
  frameName,
  frameSize,
  getPlatform,
  parseSilences,
  planClips,
  PLATFORMS,
  tooShortFor,
} from "../src";

const total = (plan: { seconds: number }[]) => plan.reduce((sum, clip) => sum + clip.seconds, 0);

describe("planClips", () => {
  it("makes one clip of a video that already fits", () => {
    expect(planClips(42.5, [], 60)).toEqual([{ part: 1, parts: 1, start: 0, seconds: 42.5 }]);
  });

  it("makes the fewest clips that fit and cuts evenly when there are no pauses", () => {
    const plan = planClips(150, [], 60);
    expect(plan.map((clip) => clip.seconds)).toEqual([50, 50, 50]);
    expect(plan.map((clip) => clip.start)).toEqual([0, 50, 100]);
    expect(plan.every((clip) => clip.parts === 3)).toBe(true);
  });

  it("moves a cut to the middle of the nearest pause", () => {
    const plan = planClips(
      150,
      [
        { start: 46, end: 47 },
        { start: 103, end: 105 },
      ],
      60,
    );
    expect(plan.map((clip) => clip.start)).toEqual([0, 46.5, 104]);
  });

  it("ignores a pause that would leave more than the later clips can hold", () => {
    // Cutting at 10 would leave 110 seconds for one clip of at most 60.
    const plan = planClips(120, [{ start: 9.5, end: 10.5 }], 60);
    expect(plan.map((clip) => clip.start)).toEqual([0, 60]);
  });

  it("never goes over the limit and covers the whole video", () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let run = 0; run < 300; run++) {
      const duration = 1 + random() * 4000;
      const max = [60, 90, 140, 180, 300, 900][Math.floor(random() * 6)];
      const silences = Array.from({ length: Math.floor(random() * 60) }, () => {
        const start = random() * duration;
        return { start, end: start + 0.3 + random() * 2 };
      });
      const plan = planClips(duration, silences, max);
      expect(plan.length).toBe(Math.ceil(duration / max - 1e-9));
      for (const [index, clip] of plan.entries()) {
        expect(clip.seconds).toBeLessThanOrEqual(max);
        expect(clip.seconds).toBeGreaterThan(0);
        if (index > 0) {
          const before = plan[index - 1];
          expect(Math.abs(before.start + before.seconds - clip.start)).toBeLessThan(0.03);
        }
      }
      expect(Math.abs(total(plan) - duration)).toBeLessThan(0.02 * plan.length + 0.01);
    }
  });

  it("returns nothing for a video with no length", () => {
    expect(planClips(0, [], 60)).toEqual([]);
    expect(planClips(Number.NaN, [], 60)).toEqual([]);
  });
});

describe("reading toolkit results", () => {
  it("reads the length from a metadata result", () => {
    expect(durationOf({ duration: 12.5, width: 1920 })).toBe(12.5);
    expect(durationOf({ duration: "754.2" })).toBe(754.2);
    expect(durationOf({})).toBeNull();
    expect(durationOf(null)).toBeNull();
  });

  it("reads pauses whether the toolkit sends numbers or text", () => {
    expect(
      parseSilences([
        { start: "5.0", end: "6.2", duration: 1.2 },
        { start: 1, end: 2 },
        { start: "x", end: 3 },
      ]),
    ).toEqual([
      { start: 1, end: 2 },
      { start: 5, end: 6.2 },
    ]);
    expect(parseSilences("no silence")).toEqual([]);
  });
});

describe("platforms", () => {
  it("keeps Social Clips' twelve platforms and adds the feeds and YouTube", () => {
    expect(PLATFORMS).toHaveLength(15);
    expect(getPlatform("TikTok")).toMatchObject({ maxSeconds: 180, frame: "9:16" });
    expect(getPlatform("X")).toMatchObject({ maxSeconds: 140, frame: "original" });
    expect(getPlatform("Instagram feed")).toMatchObject({ frame: "4:5" });
    expect(getPlatform("Facebook feed")).toMatchObject({ frame: "4:5" });
    expect(getPlatform("YouTube")).toMatchObject({ maxSeconds: 900, frame: "16:9" });
    expect(getPlatform("Myspace")).toBeUndefined();
    expect(formatLimit(60)).toBe("60 s");
    expect(formatLimit(180)).toBe("3 min");
    expect(formatLimit(140)).toBe("2 min 20 s");
  });
});

describe("shapes and lengths", () => {
  it("makes each shape at its size", () => {
    expect(frameSize("9:16")).toEqual({ width: 1080, height: 1920 });
    expect(frameSize("4:5")).toEqual({ width: 1080, height: 1350 });
    expect(frameSize("1:1")).toEqual({ width: 1080, height: 1080 });
    expect(frameSize("16:9")).toEqual({ width: 1920, height: 1080 });
    expect(frameSize("original")).toBeNull();
    expect(frameName("4:5")).toBe("Portrait 4:5");
  });

  it("says when a video is too short for a platform", () => {
    expect(tooShortFor(getPlatform("Pinterest")!, 2.5)).toBe(
      "The video is 2.5 s long; Pinterest needs at least 4 s.",
    );
    expect(tooShortFor(getPlatform("Pinterest")!, 4)).toBeNull();
    expect(tooShortFor(getPlatform("TikTok")!, 1)).toBeNull();
  });
});

describe("clipRequest", () => {
  const compose = getStep("ffmpeg-compose")!;
  const caption = getStep("video-caption")!;

  it.each(["9:16", "4:5", "1:1", "16:9", "original"] as const)(
    "builds a %s request the toolkit accepts",
    (frame) => {
      const request = clipRequest(
        "https://files.example.com/a.mp4",
        { start: 3, seconds: 9 },
        frame,
      );
      expect(() => compose.input.strict().parse(request)).not.toThrow();
    },
  );

  it("builds a scaled-down request the toolkit accepts", () => {
    const request = clipRequest(
      "https://files.example.com/a.mp4",
      { start: 3, seconds: 9 },
      "original",
      { width: 1280, height: 1024 },
    );
    expect(() => compose.input.strict().parse(request)).not.toThrow();
  });

  it("has built-in caption looks the toolkit accepts", () => {
    for (const style of BUILT_IN_STYLES) {
      expect(() =>
        caption.input.strict().parse({
          video_url: "https://files.example.com/clip.mp4",
          settings: style.look,
        }),
      ).not.toThrow();
    }
  });
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

/** Makes real clips, building the command the way the toolkit's compose route does. */
describe.skipIf(!hasFfmpeg)("clips on a real FFmpeg", () => {
  let dir = "";
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "clips-"));
    execFileSync("ffmpeg", [
      ...["-hide_banner", "-loglevel", "error", "-y"],
      ...["-f", "lavfi", "-i", "testsrc=size=1280x720:rate=10:duration=6"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:duration=6"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac"],
      path.join(dir, "wide.mp4"),
    ]);
    execFileSync("ffmpeg", [
      ...["-hide_banner", "-loglevel", "error", "-y"],
      ...["-f", "lavfi", "-i", "testsrc=size=640x360:rate=10:duration=3"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"],
      path.join(dir, "silent.mp4"),
    ]);
  }, 60_000);
  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  type Option = { option: string; argument?: string | number };
  function make(
    source: string,
    frame: Frame,
    name: string,
    box?: { width: number; height: number },
  ) {
    const request = clipRequest(
      "https://files.example.com/x.mp4",
      { start: 1.5, seconds: 2 },
      frame,
      box,
    ) as {
      inputs: { options: Option[] }[];
      filters?: { filter: string }[];
      outputs: { options: Option[] }[];
    };
    const flat = (options: Option[]) =>
      options.flatMap((item) =>
        item.argument === undefined ? [item.option] : [item.option, String(item.argument)],
      );
    const output = path.join(dir, name);
    execFileSync("ffmpeg", [
      ...["-hide_banner", "-loglevel", "error", "-y"],
      ...flat(request.inputs[0].options),
      ...["-i", path.join(dir, source)],
      ...(request.filters
        ? ["-filter_complex", request.filters.map((item) => item.filter).join(";")]
        : []),
      ...flat(request.outputs[0].options),
      output,
    ]);
    const probe = JSON.parse(
      execFileSync("ffprobe", [
        ...["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", output],
      ]).toString(),
    ) as {
      format: { duration: string };
      streams: { codec_type: string; width?: number; height?: number }[];
    };
    const video = probe.streams.find((stream) => stream.codec_type === "video")!;
    return {
      width: video.width,
      height: video.height,
      seconds: Number(probe.format.duration),
      hasSound: probe.streams.some((stream) => stream.codec_type === "audio"),
    };
  }

  it("makes a vertical clip of the right length with its sound", () => {
    const clip = make("wide.mp4", "9:16", "vertical.mp4");
    expect(clip).toMatchObject({ width: 1080, height: 1920, hasSound: true });
    expect(clip.seconds).toBeGreaterThan(1.8);
    expect(clip.seconds).toBeLessThan(2.3);
  }, 60_000);

  it("keeps the video's own shape for platforms that take it", () => {
    const clip = make("wide.mp4", "original", "original.mp4");
    expect(clip).toMatchObject({ width: 1280, height: 720, hasSound: true });
    expect(clip.seconds).toBeGreaterThan(1.8);
    expect(clip.seconds).toBeLessThan(2.3);
  }, 60_000);

  it.each([
    ["4:5", 1080, 1350],
    ["1:1", 1080, 1080],
    ["16:9", 1920, 1080],
  ] as const)(
    "makes a %s clip at its size",
    (frame, width, height) => {
      const clip = make("wide.mp4", frame, `${width}x${height}.mp4`);
      expect(clip).toMatchObject({ width, height, hasSound: true });
    },
    60_000,
  );

  it("scales a video down to fit a platform's largest picture, keeping its shape", () => {
    execFileSync("ffmpeg", [
      ...["-hide_banner", "-loglevel", "error", "-y"],
      ...["-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=10:duration=4"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"],
      path.join(dir, "full-hd.mp4"),
    ]);
    const big = make("full-hd.mp4", "original", "x-big.mp4", { width: 1280, height: 1024 });
    expect(big).toMatchObject({ width: 1280, height: 720 });
    // Smaller than the box: left as it is.
    const small = make("wide.mp4", "original", "x-small.mp4", { width: 1280, height: 1024 });
    expect(small).toMatchObject({ width: 1280, height: 720 });
    const tiny = make("silent.mp4", "original", "x-tiny.mp4", { width: 1280, height: 1024 });
    expect(tiny).toMatchObject({ width: 640, height: 360 });
  }, 60_000);

  it("still makes a vertical clip from a video with no sound", () => {
    const clip = make("silent.mp4", "9:16", "silent-vertical.mp4");
    expect(clip).toMatchObject({ width: 1080, height: 1920, hasSound: false });
  }, 60_000);
});

describe("clips setup", () => {
  it("round-trips every combination of choices through the steps", async () => {
    const { clipsGraph, graphProblem, readClipsSetup } = await import("../src");
    for (const captions of [true, false]) {
      for (const approve of [true, false]) {
        const setup = { platform: "TikTok" as const, captions, approve };
        const graph = clipsGraph(setup);
        expect(graphProblem(graph.nodes, graph.edges)).toBeNull();
        expect(readClipsSetup(graph.nodes, graph.edges)).toEqual(setup);
      }
    }
  });

  it("does not claim an automation that was reshaped on the canvas", async () => {
    const { clipsGraph, readClipsSetup } = await import("../src");
    const graph = clipsGraph({ platform: "X", captions: true, approve: false });
    expect(readClipsSetup([...graph.nodes].reverse(), [])).toBeNull();
    expect(
      readClipsSetup(
        [...graph.nodes, { id: "extra", kind: "approval", input: {}, position: { x: 0, y: 0 } }],
        graph.edges,
      ),
    ).toBeNull();
    expect(readClipsSetup([], [])).toBeNull();
  });
});
