import { describe, expect, test } from "vitest";

import { stepHref, stepIdOfPage } from "./catalog";

describe("step page addresses", () => {
  test("Custom edit has a plain address, never one named after the tool underneath", () => {
    expect(stepHref("ffmpeg-compose")).toBe("/steps/custom-edit");
    expect(stepIdOfPage("custom-edit")).toBe("ffmpeg-compose");
  });

  test("other steps keep their own id as the address", () => {
    expect(stepHref("video-trim")).toBe("/steps/video-trim");
    expect(stepIdOfPage("video-trim")).toBeUndefined();
  });
});
