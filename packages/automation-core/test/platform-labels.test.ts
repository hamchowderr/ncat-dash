import { describe, expect, test } from "vitest";

import { runOutputNames } from "../src/output-names";
import {
  platformApp,
  platformsThatFit,
  runPlatforms,
  suitsPlatform,
} from "../src/platform-labels";
import { getPlatform, PLATFORMS } from "../src/clips";

const JOB = "ca4934e3-5b1f-4c3e-9a77-0d2f1b6e8a10";
const out = (name: string) => `https://files.example.com/${JOB}_${name}`;

describe("platformApp", () => {
  test("gives the app whose logo a platform shows", () => {
    expect(platformApp("Instagram Reels")).toBe("instagram");
    expect(platformApp("Instagram feed")).toBe("instagram");
    expect(platformApp("YouTube Shorts")).toBe("youtube");
    expect(platformApp("YouTube")).toBe("youtube");
    expect(platformApp("Snapchat Spotlight")).toBe("snapchat");
    expect(platformApp("X")).toBe("x");
    expect(platformApp("Something else")).toBeNull();
  });

  test("every Clips platform has a logo", () => {
    for (const platform of PLATFORMS) expect(platformApp(platform.name)).not.toBeNull();
  });
});

describe("runPlatforms", () => {
  const clipA = out("output_0.mp4");
  const clipB = out("output_1.mp4");
  const captioned = out("captioned.mp4");
  const thumb = out("thumbnail.png");

  test("clips cut for a platform are for it, and so is what later steps make from them", () => {
    const found = runPlatforms(
      [
        { id: "cut", kind: "moments", input: { platform: "TikTok" } },
        { id: "caption", kind: "step", input: {} },
        { id: "thumb", kind: "step", input: {} },
      ],
      [
        { nodeId: "cut", outputs: [clipA, clipB] },
        {
          nodeId: "caption",
          outputs: [captioned],
          items: [{ url: captioned, from: clipA, kind: "video" }],
        },
        { nodeId: "thumb", outputs: [thumb], items: [{ url: thumb, from: clipB, kind: "image" }] },
      ],
    );
    expect(found).toEqual({ [clipA]: "TikTok", [clipB]: "TikTok", [captioned]: "TikTok" });
  });

  test("a turned-off or unknown platform step labels nothing", () => {
    expect(
      runPlatforms(
        [{ id: "cut", kind: "clips", off: true, input: { platform: "TikTok" } }],
        [{ nodeId: "cut", outputs: [clipA] }],
      ),
    ).toEqual({});
    expect(
      runPlatforms(
        [{ id: "cut", kind: "clips", input: { platform: "Myspace" } }],
        [{ nodeId: "cut", outputs: [clipA] }],
      ),
    ).toEqual({});
  });

  test("a run with no platform step has no platforms", () => {
    expect(
      runPlatforms([{ id: "a", kind: "step", input: {} }], [{ nodeId: "a", outputs: [clipA] }]),
    ).toEqual({});
  });
});

describe("names", () => {
  test("a clip made for a platform says so in its name", () => {
    const a = out("output_0.mp4");
    const b = out("output_1.mp4");
    const names = runOutputNames("Claude interview", [{ stepId: null, outputs: [a, b] }], {
      [a]: "Instagram Reels",
      [b]: "Instagram Reels",
    });
    expect(names[a]).toBe("Claude interview Instagram Reels clip 1");
    expect(names[b]).toBe("Claude interview Instagram Reels clip 2");
  });

  test("without platforms names stay as they were", () => {
    const a = out("output_0.mp4");
    expect(runOutputNames("Claude interview", [{ stepId: null, outputs: [a] }])[a]).toBe(
      "Claude interview clip",
    );
  });
});

describe("what a video fits", () => {
  const vertical60 = { width: 1080, height: 1920, duration: 60 };

  test("a vertical minute fits the vertical platforms that take a minute", () => {
    const fits = platformsThatFit(vertical60);
    expect(fits).toContain("TikTok");
    expect(fits).toContain("Instagram Reels");
    expect(fits).toContain("YouTube Shorts");
    expect(fits).not.toContain("YouTube");
    expect(fits).not.toContain("Instagram feed");
    // Any-shape platforms would fit everything, so they are left out.
    expect(fits).not.toContain("LinkedIn");
    expect(fits).not.toContain("X");
  });

  test("a smaller picture of the same shape still fits", () => {
    expect(platformsThatFit({ width: 720, height: 1280, duration: 30 })).toContain("TikTok");
  });

  test("a clip too long for a platform does not fit it", () => {
    const fits = platformsThatFit({ width: 1080, height: 1920, duration: 93 });
    expect(fits).not.toContain("Instagram Stories");
    expect(fits).not.toContain("Facebook Reels");
    expect(fits).toContain("Instagram Reels");
  });

  test("a wide video fits YouTube", () => {
    expect(platformsThatFit({ width: 1920, height: 1080, duration: 600 })).toEqual(["YouTube"]);
  });

  test("kept to where the team posts", () => {
    expect(platformsThatFit(vertical60, ["tiktok"])).toEqual(["TikTok"]);
    expect(platformsThatFit(vertical60, [])).toContain("Threads");
  });

  test("unknown sizes fit nothing", () => {
    expect(platformsThatFit({ duration: 30 })).toEqual([]);
  });

  test("suitsPlatform checks shape and length", () => {
    const reels = getPlatform("Instagram Reels")!;
    expect(suitsPlatform(reels, vertical60)).toBe(true);
    expect(suitsPlatform(reels, { width: 1080, height: 1080, duration: 60 })).toBe(false);
    expect(suitsPlatform(reels, { width: 1080, height: 1920, duration: 200 })).toBe(false);
  });
});
