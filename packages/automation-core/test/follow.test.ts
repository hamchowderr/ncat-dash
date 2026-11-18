import { describe, expect, it } from "vitest";

import {
  type AutomationEdge,
  type AutomationNode,
  clipsKeepShape,
  draftProblems,
  FOLLOW_SPEAKER_STEP,
  followShapeFrom,
  STARTERS,
} from "../src";

const clips = (platform: string): AutomationNode => ({
  id: "clips",
  kind: "clips",
  input: { platform },
  position: { x: 0, y: 0 },
});
const follow = (input: Record<string, unknown> = {}, off = false): AutomationNode => ({
  id: "follow_1",
  kind: "step",
  stepId: FOLLOW_SPEAKER_STEP,
  input,
  position: { x: 300, y: 0 },
  ...(off ? { off: true } : {}),
});
const caption: AutomationNode = {
  id: "caption_1",
  kind: "step",
  stepId: "video-caption",
  input: {},
  position: { x: 300, y: 0 },
};
const line = (source: string, target: string, branch?: string): AutomationEdge => ({
  id: `${source}>${target}`,
  source,
  target,
  ...(branch ? { branch } : {}),
});

describe("Clips straight into Follow the speaker", () => {
  it("keeps the video's own shape so there is a wide picture to follow in", () => {
    const nodes = [clips("TikTok"), follow()];
    expect(clipsKeepShape("clips", nodes, [line("clips", "follow_1")])).toBe(true);
  });

  it("makes the platform's shape as usual when the next step is anything else", () => {
    const nodes = [clips("TikTok"), caption];
    expect(clipsKeepShape("clips", nodes, [line("clips", "caption_1")])).toBe(false);
  });

  it("does not count a Follow the speaker that is switched off or only on the failure way", () => {
    expect(
      clipsKeepShape("clips", [clips("TikTok"), follow({}, true)], [line("clips", "follow_1")]),
    ).toBe(false);
    expect(
      clipsKeepShape("clips", [clips("TikTok"), follow()], [line("clips", "follow_1", "failed")]),
    ).toBe(false);
  });

  it("gives Follow the speaker the platform's shape", () => {
    const edges = [line("clips", "follow_1")];
    expect(followShapeFrom(follow(), [clips("Instagram feed"), follow()], edges)).toBe("4:5");
    expect(followShapeFrom(follow(), [clips("TikTok"), follow()], edges)).toBe("9:16");
    expect(followShapeFrom(follow(), [clips("YouTube"), follow()], edges)).toBe("16:9");
  });

  it("gives no shape for a platform that keeps the video's own, or with no Clips before", () => {
    expect(
      followShapeFrom(follow(), [clips("X"), follow()], [line("clips", "follow_1")]),
    ).toBeNull();
    expect(followShapeFrom(follow(), [follow()], [])).toBeNull();
    expect(
      followShapeFrom(caption, [clips("TikTok"), caption], [line("clips", "caption_1")]),
    ).toBeNull();
  });
});

describe("the ready-made follow-the-speaker automations", () => {
  it("are in Clips and shapes, start from a video upload and have nothing to fix", () => {
    for (const id of ["clips-follow-speaker", "follow-speaker-vertical"]) {
      const starter = STARTERS.find((s) => s.id === id)!;
      expect(starter.category).toBe("clips");
      expect(starter.trigger).toEqual({ kind: "upload", fileType: "video" });
      expect(starter.nodes.some((node) => node.stepId === FOLLOW_SPEAKER_STEP)).toBe(true);
      expect(draftProblems(starter)).toEqual([]);
    }
  });

  it("cuts clips, follows the speaker in each, then captions them", () => {
    const starter = STARTERS.find((s) => s.id === "clips-follow-speaker")!;
    expect(starter.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["clips", "follow_1"],
      ["follow_1", "caption_1"],
    ]);
    expect(clipsKeepShape("clips", starter.nodes, starter.edges)).toBe(true);
    // Left unpicked so it takes the platform's shape.
    expect(starter.nodes.find((node) => node.id === "follow_1")?.input.aspect).toBeUndefined();
  });
});
