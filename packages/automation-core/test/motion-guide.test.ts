import { describe, expect, it } from "vitest";
import { MOTION_PIECES, MOTION_PRESETS, motionGuideText } from "../src";

describe("the motion guide the agent reads", () => {
  const text = motionGuideText();

  it("lists every preset by the id a step takes, with its name and what it is best for", () => {
    for (const preset of MOTION_PRESETS) {
      expect(text).toContain(`- ${preset.id} (${preset.name}): ${preset.bestFor}.`);
    }
  });

  it("groups the presets and describes every piece", () => {
    expect(text).toContain("### Bold");
    for (const piece of MOTION_PIECES) expect(text).toContain(`- ${piece.title}: `);
  });

  it("points to Settings > Motion for the team's own style", () => {
    expect(text).toContain("Settings > Motion");
  });

  it("never mentions hosted or outside services", () => {
    expect(text.toLowerCase()).not.toMatch(/hosted|subscription|third-party/);
  });
});
