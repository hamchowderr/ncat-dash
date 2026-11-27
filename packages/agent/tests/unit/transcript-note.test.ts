import { describe, expect, it } from "vitest";
import { transcriptNote } from "../../src/mastra/ncat/library";

// What the agent is told about a file with no words, so it can say why instead of
// guessing (a long video on a slow server once had none for four hours).
const NOW = 1_800_000_000_000;
const video = { kind: "video", transcriptError: null, transcriptSince: null };

describe("transcriptNote", () => {
  it("says a ready transcript is ready", () => {
    expect(transcriptNote({ ...video, searchable: "ready" }, NOW)).toBe("Ready.");
  });
  it("says how long one being made has taken", () => {
    expect(
      transcriptNote({ ...video, searchable: "working", transcriptSince: NOW - 72 * 60_000 }, NOW),
    ).toBe("Being made now, 1 h 12 min so far. Its words cannot be read until it is done.");
  });
  it("passes on why one did not work", () => {
    expect(
      transcriptNote({ ...video, searchable: "failed", transcriptError: "No sound." }, NOW),
    ).toBe("It did not work: No sound. It can be tried again from the file's page.");
  });
  it("a picture has none", () => {
    expect(transcriptNote({ ...video, kind: "image", searchable: "no" }, NOW)).toBe(
      "Not a video or sound: it has no transcript.",
    );
  });
});
