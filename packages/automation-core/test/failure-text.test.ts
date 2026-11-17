import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { explainFailure } from "../src/failure-text";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("explainFailure", () => {
  test("a still image given to a step that needs sound says so in plain words", () => {
    const log = `Failed to load audio: ${fixture("ffmpeg-still-image.txt")}`;
    const explained = explainFailure(log);
    expect(explained.reason).toBe(
      "This file is a still image. This step needs a video or audio file.",
    );
    expect(explained.details).toBe(log.trim());
  });

  test("an older error cut off after the banner still names a still image", () => {
    const cut = fixture("ffmpeg-still-image.txt").split("  Stream #0:0")[0];
    expect(explainFailure(cut).reason).toBe(
      "This file is a still image. This step needs a video or audio file.",
    );
  });

  test("an FFmpeg failure with no friendly wording shows its first real error line", () => {
    const explained = explainFailure(`FFmpeg error: ${fixture("ffmpeg-unknown-encoder.txt")}`);
    expect(explained.reason).toBe("FFmpeg error: Unknown encoder 'nosuchcodec'");
    expect(explained.reason).not.toContain("configuration");
    expect(explained.details).toContain("ffmpeg version");
  });

  test("a video with no sound track", () => {
    const log = [
      "ffmpeg version 6.1 Copyright (c) 2000-2023 the FFmpeg developers",
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':",
      "  Duration: 00:00:05.00, start: 0.000000, bitrate: 500 kb/s",
      "  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 1280x720, 25 fps",
      "Output #0, s16le, to 'pipe:':",
      "[out#0/s16le @ 0x55] Output file does not contain any stream",
    ].join("\n");
    expect(explainFailure(log).reason).toBe("This file has no sound to work with.");
  });

  test("short plain messages stay as they are, with nothing to fold away", () => {
    expect(explainFailure("Could not download the file.")).toEqual({
      reason: "Could not download the file.",
      details: null,
    });
    expect(explainFailure("")).toEqual({ reason: "The step failed.", details: null });
    expect(explainFailure(null).reason).toBe("The step failed.");
  });

  test("a long or many-line message keeps its first line as the reason", () => {
    const explained = explainFailure("Traceback: something broke\n  at line 4\n  at line 9");
    expect(explained.reason).toBe("Traceback: something broke");
    expect(explained.details).toContain("at line 9");
    expect(explainFailure("x".repeat(500)).reason.length).toBeLessThanOrEqual(240);
  });
});
