import { describe, expect, it } from "vitest";

import {
  followedNames,
  followOnsByEnd,
  followOnsFor,
  followOnTrigger,
  followsLine,
  isFollowOn,
  STARTERS,
  starterOf,
} from "../src";

const followOns = STARTERS.filter(isFollowOn);
const byId = (id: string) => STARTERS.find((starter) => starter.id === id)!;

describe("ready-made follow-ons", () => {
  it("are the nine that carry on from another automation, in their own category", () => {
    expect(followOns.map((starter) => starter.id)).toEqual([
      "brand-every-clip",
      "ready-to-post",
      "every-shape-after-captions",
      "backup-follow-speaker",
      "backup-clips-follow-speaker",
      "clips-from-episode",
      "episode-video-youtube",
      "lyric-video-vertical",
      "thumbnail-choices-after",
    ]);
    for (const starter of followOns) {
      expect(starter.category, starter.id).toBe("after");
      expect(starter.trigger, starter.id).toMatchObject({ kind: "finished", automationId: "" });
    }
  });

  it("only follow ready-mades that exist, never themselves, and never in a circle", () => {
    for (const starter of followOns) {
      for (const id of starter.follows!) {
        expect(
          STARTERS.some((other) => other.id === id),
          `${starter.id} -> ${id}`,
        ).toBe(true);
        expect(id).not.toBe(starter.id);
        expect(byId(id).follows ?? [], `${id} follows ${starter.id} back`).not.toContain(
          starter.id,
        );
      }
    }
  });

  it("can tell every ready-made they follow apart by its steps alone", () => {
    for (const id of new Set(followOns.flatMap((starter) => starter.follows!))) {
      const { trigger, nodes } = byId(id);
      expect(starterOf({ trigger, nodes }), id).toBe(id);
    }
  });

  it("are suggested after the ones they follow", () => {
    expect(followOnsFor("social-clips").map((starter) => starter.id)).toEqual(["brand-every-clip"]);
    expect(followOnsFor("brand-every-clip").map((starter) => starter.id)).toEqual([
      "ready-to-post",
    ]);
    expect(followOnsFor("caption-uploads").map((starter) => starter.id)).toEqual([
      "ready-to-post",
      "every-shape-after-captions",
    ]);
    expect(followOnsFor("follow-speaker-vertical").map((starter) => starter.id)).toEqual([
      "backup-follow-speaker",
    ]);
    expect(followOnsFor("clips-follow-speaker").map((starter) => starter.id)).toEqual([
      "brand-every-clip",
      "backup-clips-follow-speaker",
    ]);
    expect(followOnsFor("podcast-package").map((starter) => starter.id)).toEqual([
      "clips-from-episode",
    ]);
    expect(followOnsFor("clips-from-episode").map((starter) => starter.id)).toEqual([
      "brand-every-clip",
    ]);
    expect(followOnsFor(null)).toEqual([]);
    expect(followOnsFor("recipe-logo")).toEqual([]);
  });

  it("remember the ready-made an automation came from over its steps", () => {
    const { trigger, nodes } = byId("social-clips");
    expect(starterOf({ starterId: "caption-uploads", trigger, nodes })).toBe("caption-uploads");
    // One no longer in the list falls back to its steps; changed steps match nothing.
    expect(starterOf({ starterId: "gone", trigger, nodes })).toBe("social-clips");
    expect(starterOf({ trigger, nodes: [] })).toBeNull();
    expect(starterOf({ trigger: { kind: "schedule" }, nodes })).toBeNull();
  });

  it("are wired to the automation they are set up after", () => {
    expect(followOnTrigger(byId("backup-follow-speaker"), "auto_1")).toEqual({
      kind: "finished",
      automationId: "auto_1",
      when: "failed",
    });
    expect(followOnTrigger(byId("caption-uploads"), "auto_1")).toEqual(
      byId("caption-uploads").trigger,
    );
  });

  it("say on their card what they run after", () => {
    expect(followedNames(byId("lyric-video-vertical"))).toEqual([
      "Lyric video with highlighted words",
    ]);
    expect(followsLine(byId("lyric-video-vertical"))).toBe(
      "Runs after Lyric video with highlighted words",
    );
    expect(followsLine(byId("thumbnail-choices-after"))).toBe(
      "Runs after Talking head with B-Roll or Captioned video with your end card",
    );
    expect(followsLine(byId("backup-follow-speaker"))).toBe(
      "Runs if Vertical that follows the speaker fails",
    );
    expect(followsLine(byId("caption-uploads"))).toBeNull();
  });
});

describe("follow-ons for an automation built from scratch", () => {
  const ids = (
    nodes: Parameters<typeof followOnsByEnd>[0],
    edges: Parameters<typeof followOnsByEnd>[1] = [],
  ) => followOnsByEnd(nodes, edges).map((starter) => starter.id);

  it("suggest branding for clips, and the video ones for any finished video", () => {
    expect(
      ids(
        [
          { id: "c", kind: "clips" },
          { id: "cap", kind: "step", stepId: "video-caption" },
          { id: "ok", kind: "approval" },
        ],
        [
          { source: "c", target: "cap" },
          { source: "cap", target: "ok" },
        ],
      ),
    ).toEqual([
      "brand-every-clip",
      "ready-to-post",
      "every-shape-after-captions",
      "thumbnail-choices-after",
    ]);
    expect(ids([{ id: "t", kind: "step", stepId: "video-trim" }])).toEqual([
      "ready-to-post",
      "every-shape-after-captions",
      "thumbnail-choices-after",
    ]);
  });

  it("turn an MP3 into a video, and suggest nothing for pictures or text", () => {
    expect(ids([{ id: "m", kind: "step", stepId: "media-to-mp3" }])).toEqual([
      "episode-video-youtube",
    ]);
    expect(ids([{ id: "f", kind: "step", stepId: "recipe-frame" }])).toEqual([]);
    expect(ids([{ id: "t", kind: "step", stepId: "media-transcribe" }])).toEqual([]);
    expect(ids([])).toEqual([]);
  });
});
