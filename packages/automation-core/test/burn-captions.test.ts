import { describe, expect, it } from "vitest";
import { burnRequest, burnsInFast, clipRequest, wordsRequest } from "../src";

describe("captions burned in with one quick save", () => {
  it("asks for the timed words with the caption job's look, word fixes, skipped parts and language", () => {
    const job = {
      video_url: "https://f/clip.mp4",
      settings: { style: "highlight" },
      replace: [{ find: "chowder", replace: "Chowderr" }],
      exclude_time_ranges: [{ start: "00:00:01", end: "00:00:02" }],
      language: "en",
    };
    expect(wordsRequest(job)).toEqual({
      media_url: "https://f/clip.mp4",
      settings: { style: "highlight" },
      replace: [{ find: "chowder", replace: "Chowderr" }],
      exclude_time_ranges: [{ start: "00:00:01", end: "00:00:02" }],
      language: "en",
    });
    expect(wordsRequest({ video_url: "https://f/a.mp4" })).toEqual({
      media_url: "https://f/a.mp4",
    });
  });

  it("takes every caption job except text the team typed itself", () => {
    expect(burnsInFast({ video_url: "x" })).toBe(true);
    expect(burnsInFast({ video_url: "x", captions: "  " })).toBe(true);
    expect(burnsInFast({ video_url: "x", captions: "Hello" })).toBe(false);
  });

  it("burns the caption file in with the same quick settings Clips uses, keeping the sound", () => {
    const burn = burnRequest("https://f/clip.mp4", "https://f/words.ass") as {
      inputs: unknown[];
      filters: { filter: string }[];
      outputs: { options: unknown[] }[];
    };
    expect(burn.inputs).toEqual([{ file_url: "https://f/clip.mp4" }]);
    expect(burn.filters[0].filter).toBe("[0:v]ass='https://f/words.ass',setsar=1[v]");
    const clip = clipRequest("https://f/a.mp4", { start: 0, seconds: 10 }, "9:16") as {
      outputs: { options: unknown[] }[];
    };
    const quick = (options: unknown[]) =>
      options.filter((o) => ["-c:v", "-preset", "-crf"].includes((o as { option: string }).option));
    expect(quick(burn.outputs[0].options)).toEqual(quick(clip.outputs[0].options));
    expect(burn.outputs[0].options).toContainEqual({ option: "-map", argument: "0:a?" });
  });
});

describe("clips", () => {
  it("make the blurred fill from a quarter-size copy, then scale it to the full frame", () => {
    const clip = clipRequest("https://f/a.mp4", { start: 0, seconds: 10 }, "9:16") as {
      filters: { filter: string }[];
    };
    expect(clip.filters[0].filter).toContain("crop=270:480,boxblur=5:5,scale=1080:1920[blurred]");
  });
});
