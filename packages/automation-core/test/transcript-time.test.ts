import { describe, expect, it } from "vitest";
import {
  spokenSpan,
  transcriptIsSlow,
  transcriptLimitMs,
  transcriptTooSlowError,
} from "../src/transcript-time";

const MIN = 60_000;

describe("transcriptLimitMs", () => {
  it("allows three times the video's length", () => {
    expect(transcriptLimitMs(64 * 60)).toBe(192 * MIN);
  });
  it("never less than half an hour", () => {
    expect(transcriptLimitMs(90)).toBe(30 * MIN);
  });
  it("never more than six hours", () => {
    expect(transcriptLimitMs(5 * 60 * 60)).toBe(360 * MIN);
  });
  it("six hours when the length is not known", () => {
    expect(transcriptLimitMs(null)).toBe(360 * MIN);
    expect(transcriptLimitMs(0)).toBe(360 * MIN);
  });
});

describe("transcriptIsSlow", () => {
  it("is not slow in the first ten minutes", () => {
    expect(transcriptIsSlow(9 * MIN, 60)).toBe(false);
  });
  it("is slow once it runs longer than the video", () => {
    expect(transcriptIsSlow(70 * MIN, 64 * 60)).toBe(true);
    expect(transcriptIsSlow(30 * MIN, 64 * 60)).toBe(false);
  });
});

describe("words", () => {
  it("says a span plainly", () => {
    expect(spokenSpan(45 * MIN)).toBe("45 min");
    expect(spokenSpan(72 * MIN)).toBe("1 h 12 min");
    expect(spokenSpan(120 * MIN)).toBe("2 h");
  });
  it("says why a transcript was stopped", () => {
    expect(transcriptTooSlowError(193 * MIN, 64 * 60)).toBe(
      "Transcribing took over 3 h 13 min for a 1 h 4 min video, so it was stopped. The server doing it may be busy or too slow for long videos. Try again when it is less busy.",
    );
  });
});
