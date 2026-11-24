import { STARTERS } from "@takewon/automation-core";
import { describe, expect, it } from "vitest";
import { automationName, DEFAULT_CLIPS, DEFAULT_PLAN, planRuns, timeLimitMs } from "../src/plan";

describe("planRuns", () => {
  it("runs every ready-made in the default plan, shortest video first", () => {
    const plan = planRuns();
    expect(plan.map((item) => item.clip.seconds)).toEqual(
      [...plan.map((item) => item.clip.seconds)].sort((a, b) => a - b),
    );
    expect(plan).toHaveLength(Object.values(DEFAULT_PLAN).flat().length);
    expect(plan[0]).toMatchObject({
      readyMadeId: "caption-uploads",
      readyMadeName: "Caption every new upload",
    });
  });

  it("uses only ready-mades that exist and that pay no AI model per video", () => {
    const paid = ["moments", "chapters", "broll", "motion"];
    for (const id of Object.values(DEFAULT_PLAN).flat()) {
      const starter = STARTERS.find((candidate) => candidate.id === id);
      expect(starter, id).toBeDefined();
      expect(
        starter!.nodes.some((node) => paid.includes(node.kind)),
        id,
      ).toBe(false);
    }
  });

  it("has a 40 s, an 81 s and a long video, each a public address", () => {
    expect(DEFAULT_CLIPS.map((clip) => clip.seconds)).toEqual([40, 81, 480]);
    for (const clip of DEFAULT_CLIPS) expect(clip.url).toMatch(/^https:\/\/.+\.mp4$/);
  });

  it("narrows to the videos and ready-mades asked for", () => {
    const plan = planRuns({
      onlyClips: ["talking-head-81s-wide"],
      onlyReadyMades: ["social-clips"],
    });
    expect(plan).toHaveLength(1);
    expect(plan[0].clip.id).toBe("talking-head-81s-wide");
  });

  it("says so when a video or ready-made doesn't exist", () => {
    expect(() => planRuns({ onlyClips: ["nope"] })).toThrow(/no video "nope"/);
    expect(() => planRuns({ plan: { "talking-head-40s-vertical": ["nope"] } })).toThrow(
      /no ready-made "nope"/,
    );
  });

  it("gives longer videos more time and names the automation it keeps", () => {
    expect(timeLimitMs(DEFAULT_CLIPS[0])).toBe((900 + 320) * 1000);
    expect(timeLimitMs(DEFAULT_CLIPS[2])).toBeGreaterThan(timeLimitMs(DEFAULT_CLIPS[1]));
    expect(automationName("Clips for social")).toBe("Speed Test: Clips for social");
  });
});
