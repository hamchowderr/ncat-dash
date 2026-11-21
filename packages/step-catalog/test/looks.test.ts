import { execFile, execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contactSheetRequest,
  frameLookOf,
  getStep,
  gradeFilter,
  lookFilter,
  NEUTRAL_FRAME,
  SAVED_LOOK_STEP,
  StepSetupError,
} from "../src";

const step = getStep(SAVED_LOOK_STEP)!;

describe("Match A Saved Look", () => {
  it("is a step people can add, under recipes", () => {
    expect(step.title).toBe("Match A Saved Look");
    expect(step.category).toBe("recipe");
    expect(step.primaryInput).toBe("video_url");
  });

  it("puts the video into the look the dashboard filled in", () => {
    const look = {
      shape: "square",
      fill: "bars",
      brightness: 0.05,
      contrast: 1.2,
      saturation: 1.3,
      warmth: 0.4,
    };
    const request = step.toRequest!(
      { video_url: "https://files.example/in.mp4", look: JSON.stringify(look) },
      {},
    ) as { inputs: { file_url: string }[]; filters: { filter: string }[] };
    expect(request.inputs[0].file_url).toBe("https://files.example/in.mp4");
    expect(request.filters[0].filter).toBe(
      "[0:v]scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2:color=black,eq=brightness=0.05:contrast=1.2:saturation=1.3,colorbalance=rm=0.06:bm=-0.06,setsar=1,format=yuv420p[v]",
    );
  });

  it("says plainly when there is no look to use", () => {
    expect(() => step.toRequest!({ video_url: "https://f.example/a.mp4", look: "" }, {})).toThrow(
      StepSetupError,
    );
    expect(() =>
      step.toRequest!({ video_url: "https://f.example/a.mp4", look: "Cafe Reels" }, {}),
    ).toThrow('There is no saved look called "Cafe Reels".');
  });
});

describe("reading a look", () => {
  it("keeps every number in range and every choice one of its own", () => {
    expect(
      frameLookOf({
        shape: "tall;rm -rf",
        fill: "zoom",
        brightness: 4,
        contrast: "1.25",
        saturation: -3,
        warmth: Number.NaN,
      }),
    ).toEqual({
      shape: "vertical",
      fill: "crop",
      brightness: 0.3,
      contrast: 1.25,
      saturation: 0,
      warmth: 0,
    });
  });

  it("leaves the colour alone for a neutral look", () => {
    expect(gradeFilter(NEUTRAL_FRAME)).toBe("");
    expect(lookFilter(NEUTRAL_FRAME)).toBe(
      "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=yuv420p[v]",
    );
  });

  it("cools with less red and more blue", () => {
    expect(gradeFilter({ ...NEUTRAL_FRAME, warmth: -1 })).toBe("colorbalance=rm=-0.15:bm=0.15");
  });
});

const runFile = promisify(execFile);
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe.skipIf(!hasFfmpeg)("looks on a real FFmpeg", () => {
  let dir = "";
  const ffmpeg = (args: string[]) =>
    runFile("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { timeout: 120_000 });
  const size = (file: string) =>
    execFileSync("ffprobe", [
      ...["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height"],
      ...["-of", "csv=p=0:s=x", file],
    ])
      .toString()
      .trim();

  /** The command the toolkit builds from a compose request (ffmpeg_compose.py). */
  async function run(request: Record<string, unknown>, out: string) {
    const r = request as {
      inputs: { file_url: string; options?: { option: string; argument?: unknown }[] }[];
      filters: { filter: string }[];
      outputs: { options: { option: string; argument?: unknown }[] }[];
    };
    const args: string[] = [];
    for (const input of r.inputs) {
      for (const one of input.options ?? []) {
        args.push(one.option);
        if (one.argument !== undefined) args.push(String(one.argument));
      }
      args.push("-i", input.file_url);
    }
    args.push("-filter_complex", r.filters.map((one) => one.filter).join(";"));
    for (const one of r.outputs[0].options) {
      args.push(one.option);
      if (one.argument !== undefined) args.push(String(one.argument));
    }
    args.push(path.join(dir, out));
    await ffmpeg(args);
    return path.join(dir, out);
  }

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "looks-"));
    await ffmpeg([
      ...["-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=25:duration=4"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:duration=4"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac"],
      path.join(dir, "wide.mp4"),
    ]);
  }, 60_000);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("puts a wide video into each shape and fill, graded", async () => {
    const video = path.join(dir, "wide.mp4");
    for (const [shape, fill, expected] of [
      ["vertical", "blur", "1080x1920"],
      ["square", "bars", "1080x1080"],
      ["wide", "crop", "1920x1080"],
    ] as const) {
      const look = frameLookOf({ shape, fill, contrast: 1.2, saturation: 1.3, warmth: 0.5 });
      const request = step.toRequest!({ video_url: video, look: JSON.stringify(look) }, {});
      expect(size(await run(request, `${shape}-${fill}.mp4`))).toBe(expected);
    }
  }, 120_000);

  it("makes one sheet of six frames to study", async () => {
    const sheet = await run(contactSheetRequest(path.join(dir, "wide.mp4"), 4, false), "sheet.png");
    expect(size(sheet)).toBe("1920x720");
  }, 60_000);
});
