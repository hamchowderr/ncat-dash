import { describe, expect, it } from "vitest";

import { uploadKind } from "../src";

describe("uploadKind", () => {
  it("goes by the file's details once the toolkit has read them", () => {
    expect(uploadKind("application/octet-stream", { hasVideo: true, width: 1920 })).toBe("video");
    expect(uploadKind("", { hasAudio: true })).toBe("audio");
    expect(uploadKind("", { width: 800, height: 600, format: "png_pipe" })).toBe("image");
  });

  it("falls back to the type the browser gave while details are still to come", () => {
    expect(uploadKind("video/mp4", null)).toBe("video");
    expect(uploadKind("audio/mpeg", undefined)).toBe("audio");
    expect(uploadKind("image/png", null)).toBe("image");
    expect(uploadKind("Video/QuickTime", null)).toBe("video");
  });

  it("calls anything else other", () => {
    expect(uploadKind("application/pdf", null)).toBe("other");
    expect(uploadKind("", null)).toBe("other");
    expect(uploadKind("text/plain", {})).toBe("other");
  });
});
