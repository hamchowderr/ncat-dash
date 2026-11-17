import { describe, expect, it } from "vitest";
import { CHECKED, PLACEMENTS, placementGuide, platformGuideText, PLATFORMS } from "../src";

describe("the platform guide", () => {
  it("covers every platform the Clips step makes clips for", () => {
    for (const platform of PLATFORMS) {
      expect(placementGuide(platform.name), platform.name).toBeDefined();
    }
  });

  it("names each place once", () => {
    const names = PLACEMENTS.map((guide) => guide.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("cites the platform's own pages for every place, on https", () => {
    for (const guide of PLACEMENTS) {
      expect(guide.sources.length, guide.name).toBeGreaterThan(0);
      for (const source of guide.sources) expect(source).toMatch(/^https:\/\//);
      expect(guide.length && guide.shape && guide.file, guide.name).toBeTruthy();
    }
    expect(CHECKED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("never lets the Clips step cut past what a platform takes", () => {
    // The guide's length line states the clip limit in words; spot-check the hard limits.
    const limits: Record<string, number> = {
      "Instagram Stories": 60,
      "Instagram Reels": 900,
      "Facebook Reels": 90,
      "Facebook Stories": 60,
      "YouTube Shorts": 180,
      TikTok: 600,
      Threads: 300,
      "Snapchat Spotlight": 60,
      LinkedIn: 900,
      Pinterest: 900,
    };
    for (const [name, most] of Object.entries(limits)) {
      const platform = PLATFORMS.find((candidate) => candidate.name === name)!;
      expect(platform.maxSeconds, name).toBeLessThanOrEqual(most);
    }
  });

  it("reads one place as short text the agent can use", () => {
    const { text, unknown } = platformGuideText(["youtube shorts"]);
    expect(unknown).toEqual([]);
    expect(text).toContain("## YouTube Shorts");
    expect(text).toContain("Up to 3 min");
    expect(text).toContain(
      'Clips for a platform "YouTube Shorts" makes vertical 9:16 clips of up to 3 min.',
    );
    expect(text).toContain("support.google.com/youtube");
  });

  it("says plainly what it could not confirm", () => {
    const { text } = platformGuideText(["Snapchat Spotlight"]);
    expect(text).toContain("Not confirmed:");
  });

  it("describes Twitch as a place videos come from, not a Clips platform", () => {
    const { text } = platformGuideText(["Twitch clips"]);
    expect(text).toContain("Not a Clips platform.");
  });

  it("lists the places it knows when asked for one it does not", () => {
    const { text, unknown } = platformGuideText(["Myspace"]);
    expect(unknown).toEqual(["Myspace"]);
    expect(text).toContain("Known: YouTube Shorts");
  });

  it("gives every place when none is named", () => {
    const { text } = platformGuideText();
    for (const guide of PLACEMENTS) expect(text).toContain(`## ${guide.name} (`);
  });
});
