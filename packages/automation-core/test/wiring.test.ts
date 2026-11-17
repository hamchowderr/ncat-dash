import { describe, expect, it } from "vitest";

import {
  applyOperation,
  applyOperations,
  type AutomationDraft,
  chooseFiles,
  draftProblems,
  fileFields,
  fits,
  getNodeType,
  readSource,
  stepsBefore,
  wantedKind,
  writeSource,
} from "../src";

const upload = "https://bucket.example/uploads/episode%2012.mp4?X-Amz-Signature=abc";

describe("choosing a step's files by itself", () => {
  it("knows what kind of file a setting wants from its name", () => {
    expect(wantedKind("video_url")).toBe("video");
    expect(wantedKind("video_urls")).toBe("video");
    expect(wantedKind("audio_urls")).toBe("audio");
    expect(wantedKind("music_url")).toBe("audio");
    expect(wantedKind("logo_url")).toBe("image");
    expect(wantedKind("media_url")).toBe("media");
    expect(wantedKind("file_url")).toBe("any");
    expect(wantedKind(null)).toBe("any");
  });

  it("tells files apart by their ending, ignoring what follows a question mark", () => {
    expect(fits(upload, "video")).toBe(true);
    expect(fits(upload, "media")).toBe(true);
    expect(fits(upload, "image")).toBe(false);
    expect(fits("https://x.example/thumb.jpg", "video")).toBe(false);
    expect(fits("https://x.example/sound.mp3", "media")).toBe(true);
    expect(fits("https://x.example/captions.srt", "video")).toBe(false);
    expect(fits("https://x.example/captions.srt", "any")).toBe(true);
    // No ending to go by: let it through rather than guess.
    expect(fits("https://x.example/download?id=42", "video")).toBe(true);
  });

  it("uses the step before when it made the right kind", () => {
    expect(chooseFiles("video", [["https://x/captioned.mp4"], [upload]])).toEqual([
      "https://x/captioned.mp4",
    ]);
  });

  it("looks further back when the step before made something else or nothing", () => {
    // After a transcript step, which hands on no file.
    expect(chooseFiles("video", [[], [upload]])).toEqual([upload]);
    // After a thumbnail step: the video before it, not the picture.
    expect(
      chooseFiles("video", [["https://x/thumb.jpg"], ["https://x/captioned.mp4"], [upload]]),
    ).toEqual(["https://x/captioned.mp4"]);
  });

  it("keeps only the fitting files when a level is mixed", () => {
    expect(
      chooseFiles("image", [["https://x/a.mp4", "https://x/a.jpg", "https://x/b.png"]]),
    ).toEqual(["https://x/a.jpg", "https://x/b.png"]);
  });

  it("hands over the nearest files as they are when nothing fits anywhere", () => {
    expect(chooseFiles("audio", [[], ["https://x/thumb.jpg"], []])).toEqual([
      "https://x/thumb.jpg",
    ]);
    expect(chooseFiles("video", [[], []])).toEqual([]);
  });

  it("lists the steps before one, nearest first", () => {
    const edges = [
      { id: "a>b", source: "a", target: "b" },
      { id: "b>c", source: "b", target: "c" },
      { id: "x>c", source: "x", target: "c" },
    ];
    expect(stepsBefore("c", edges)).toEqual([["b", "x"], ["a"]]);
    expect(stepsBefore("a", edges)).toEqual([]);
  });
});

describe("pointing a file setting somewhere", () => {
  const draft: AutomationDraft = applyOperations(
    { name: "Test", trigger: { kind: "upload", fileType: "video" }, nodes: [], edges: [] },
    [
      { op: "add", type: "step:video-caption", id: "captions" },
      { op: "add", type: "step:video-thumbnail", id: "thumb", after: "captions" },
      { op: "add", type: "step:recipe-logo", id: "logo", after: "thumb" },
    ],
  );

  it("round-trips every source through what is saved", () => {
    for (const source of [
      { from: "auto" },
      { from: "trigger" },
      { from: "step", id: "caption_1" },
      { from: "fixed", value: "https://x.example/logo.png" },
    ] as const) {
      expect(readSource(writeSource(source))).toEqual(source);
    }
  });

  it("finds the file settings of a node type", () => {
    expect(fileFields(getNodeType("step:recipe-logo")!)).toEqual(["video_url", "logo_url"]);
    expect(fileFields(getNodeType("approval")!)).toEqual([]);
  });

  it("points a setting at an earlier step, the start, and back to automatic", () => {
    const atStep = applyOperation(draft, {
      op: "use",
      id: "logo",
      field: "video_url",
      from: "captions",
    });
    expect(readSource(atStep.nodes[2].input.video_url)).toEqual({ from: "step", id: "captions" });
    const atStart = applyOperation(atStep, {
      op: "use",
      id: "logo",
      field: "video_url",
      from: "trigger",
    });
    expect(readSource(atStart.nodes[2].input.video_url)).toEqual({ from: "trigger" });
    const auto = applyOperation(atStart, {
      op: "use",
      id: "logo",
      field: "video_url",
      from: "auto",
    });
    expect(auto.nodes[2].input).toEqual({});
  });

  it("refuses a step that does not run before, a setting that is not a file, and automatic where it cannot be", () => {
    expect(() =>
      applyOperation(draft, { op: "use", id: "captions", field: "video_url", from: "logo" }),
    ).toThrow(/does not run before/);
    expect(() =>
      applyOperation(draft, { op: "use", id: "logo", field: "logo_size", from: "trigger" }),
    ).toThrow(/not a file setting/);
    expect(() =>
      applyOperation(draft, { op: "use", id: "logo", field: "logo_url", from: "auto" }),
    ).toThrow(/cannot find/);
    expect(() =>
      applyOperation(
        { ...draft, trigger: { kind: "schedule", schedule: { mode: "interval", minutes: 60 } } },
        { op: "use", id: "logo", field: "video_url", from: "trigger" },
      ),
    ).toThrow(/hands over no file/);
  });

  it("clears a setting that pointed at a step when that step is removed", () => {
    const pointed = applyOperation(draft, {
      op: "use",
      id: "logo",
      field: "video_url",
      from: "captions",
    });
    const removed = applyOperation(pointed, { op: "remove", ids: ["captions"] });
    expect(removed.nodes.find((node) => node.id === "logo")?.input).toEqual({});
  });

  it("reports a setting that points at a step no longer before it", () => {
    const pointed = applyOperation(draft, {
      op: "use",
      id: "logo",
      field: "video_url",
      from: "captions",
    });
    const cut = applyOperation(pointed, { op: "disconnect", source: "captions", target: "thumb" });
    const messages = draftProblems(cut).map((problem) => problem.message);
    expect(messages.some((message) => /does not run before it/.test(message))).toBe(true);
  });
});
