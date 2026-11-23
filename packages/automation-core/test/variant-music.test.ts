import { describe, expect, it } from "vitest";

import { getStep, VARIANT_MUSIC_STEP } from "@takewon/step-catalog";

import {
  draftProblems,
  getNodeType,
  graphProblem,
  missingBrandOf,
  passedOverWithout,
  STARTERS,
  stepFileLabels,
} from "../src";

const UGC = ["ugc-ad-variants", "ugc-ad-variants-from-creator-folders"];
const musicStep = getNodeType(`step:${VARIANT_MUSIC_STEP}`)!;

describe("music under each variant on the canvas", () => {
  it("never stops an automation for want of music, and says when it will be passed over", () => {
    expect(missingBrandOf(musicStep, {}, {})).toEqual([]);
    expect(passedOverWithout(musicStep, {}, {})).toBe("music");
    expect(passedOverWithout(musicStep, {}, { music: "upload:song" })).toBeNull();
    expect(passedOverWithout(musicStep, { music_url: "https://x.example/a.mp3" }, {})).toBeNull();
    // Other steps run whatever the brand holds.
    expect(passedOverWithout(getNodeType("step:video-caption")!, {}, {})).toBeNull();
  });
});

describe("UGC ad variant ready-mades", () => {
  for (const id of UGC) {
    const starter = STARTERS.find((each) => each.id === id)!;
    const node = (nodeId: string) => starter.nodes.find((each) => each.id === nodeId)!;
    const into = (nodeId: string) =>
      starter.edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source);

    it(`${id}: makes each shape clean and captioned, each with music and without`, () => {
      expect(graphProblem(starter.nodes, starter.edges)).toBeNull();
      for (const row of [1, 2, 3]) {
        expect(into(`shape_${row}`)).toEqual(["lengths_1"]);
        expect(into(`caption_${row}`)).toEqual([`shape_${row}`]);
        // The clean copy and the captioned copy each get one with music next to them.
        expect(into(`music_${row}`)).toEqual([`shape_${row}`]);
        expect(into(`caption_music_${row}`)).toEqual([`caption_${row}`]);
        expect(node(`music_${row}`).stepId).toBe(VARIANT_MUSIC_STEP);
        expect(node(`caption_music_${row}`).stepId).toBe(VARIANT_MUSIC_STEP);
      }
      // Ready to switch on without music in Settings: the music steps are passed over.
      expect(
        draftProblems({ ...starter, trigger: { kind: "manual" } } as never).filter((problem) =>
          problem.nodeId?.includes("music"),
        ),
      ).toEqual([]);
      // No two steps sit on the same spot.
      const spots = starter.nodes.map((each) => `${each.position.x},${each.position.y}`);
      expect(new Set(spots).size).toBe(spots.length);
    });
  }

  it("names the copy with music for everything else in it", () => {
    const step = (stepId: string, input: Record<string, unknown>, outputs: string[]) => ({
      stepId,
      input,
      outputs,
    });
    const labels = stepFileLabels(
      [
        step(VARIANT_MUSIC_STEP, { video_url: "https://f/a.mp4" }, ["https://f/a-music.mp4"]),
        step(VARIANT_MUSIC_STEP, { video_url: "https://f/b.mp4" }, ["https://f/b-music.mp4"]),
        // A file without a code gets none: the step only follows.
        step(VARIANT_MUSIC_STEP, { video_url: "https://f/plain.mp4" }, ["https://f/p-m.mp4"]),
      ],
      [
        { url: "https://f/a.mp4", label: "h02_c01_15s_9x16" },
        { url: "https://f/b.mp4", label: "h02_c01_15s_9x16_captioned" },
      ],
    );
    expect(labels).toEqual([
      { url: "https://f/a-music.mp4", label: "h02_c01_15s_9x16_music" },
      { url: "https://f/b-music.mp4", label: "h02_c01_15s_9x16_captioned_music" },
    ]);
    expect(getStep(VARIANT_MUSIC_STEP)?.title).toBe("Music Under Each Variant");
  });
});
