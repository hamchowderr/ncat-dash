import { describe, expect, it } from "vitest";
import {
  type AutomationNode,
  creatorPartOf,
  creatorSets,
  fileFamily,
  type FolderObject,
  SETTLE_MS,
  STARTERS,
  withCreatorTakes,
} from "../src";

const NOW = 1_800_000_000_000;
const isVideo = (key: string) => fileFamily(key) === "video";
const file = (key: string, minutesAgo = 10, etag = "e1"): FolderObject => ({
  key,
  etag,
  size: 100,
  lastModified: NOW - minutesAgo * 60_000,
});

describe("creator folders", () => {
  it("reads which creator and which take a file is", () => {
    expect(creatorPartOf("ugc/Maya/hooks/hook 1.mp4", "ugc/")).toEqual({
      creator: "Maya",
      part: "hook",
    });
    expect(creatorPartOf("ugc/Maya/Body/take.mp4", "ugc/")).toEqual({
      creator: "Maya",
      part: "body",
    });
    expect(creatorPartOf("ugc/Maya/CTAs/a.mp4", "ugc/")?.part).toBe("ending");
    // The cleanup step's folders straight under the watched folder: no creator.
    expect(creatorPartOf("Finished/Clean Up/hooks/a hook_01.mp4", "Finished/Clean Up/")).toEqual({
      creator: "",
      part: "hook",
    });
    expect(creatorPartOf("ugc/Maya/raw/a.mp4", "ugc/")).toBeNull();
    expect(creatorPartOf("ugc/a.mp4", "ugc/")).toBeNull();
    expect(creatorPartOf("ugc/Maya/hooks/old/a.mp4", "ugc/")).toBeNull();
    expect(creatorPartOf("other/Maya/hooks/a.mp4", "ugc/")).toBeNull();
  });

  it("makes one set per creator with a body and a hook, once they stop landing", () => {
    const sets = creatorSets(
      [
        file("ugc/Maya/body/body.mp4"),
        file("ugc/Maya/hooks/hook 10.mp4"),
        file("ugc/Maya/hooks/hook 2.mp4"),
        file("ugc/Maya/endings/cta.mp4"),
        file("ugc/Maya/hooks/notes.txt"),
        // Jordan has no hook yet, so waits.
        file("ugc/Jordan/body/body.mp4"),
        // Sam is still uploading.
        file("ugc/Sam/body/body.mp4"),
        file("ugc/Sam/hooks/a.mp4", 1),
      ],
      "ugc/",
      NOW,
      isVideo,
    );
    expect(sets.map((set) => set.creator)).toEqual(["Maya"]);
    const [maya] = sets;
    expect(maya.body.key).toBe("ugc/Maya/body/body.mp4");
    // Name order, with numbers read as numbers.
    expect(maya.hooks.map((each) => each.key)).toEqual([
      "ugc/Maya/hooks/hook 2.mp4",
      "ugc/Maya/hooks/hook 10.mp4",
    ]);
    expect(maya.endings.map((each) => each.key)).toEqual(["ugc/Maya/endings/cta.mp4"]);
    expect(maya.files).toHaveLength(4);

    // Sam's set starts once nothing has landed for the settle time.
    const later = creatorSets(
      [file("ugc/Sam/body/body.mp4"), file("ugc/Sam/hooks/a.mp4", 1)],
      "ugc/",
      NOW + SETTLE_MS,
      isVideo,
    );
    expect(later.map((set) => set.creator)).toEqual(["Sam"]);
  });

  it("uses the newest body and at most five hooks and three endings", () => {
    const [set] = creatorSets(
      [
        file("ugc/Maya/body/old.mp4", 30),
        file("ugc/Maya/body/new.mp4", 20),
        ...Array.from({ length: 7 }, (_, n) => file(`ugc/Maya/hooks/h${n + 1}.mp4`)),
        ...Array.from({ length: 4 }, (_, n) => file(`ugc/Maya/endings/c${n + 1}.mp4`)),
      ],
      "ugc/",
      NOW,
      isVideo,
    );
    expect(set.body.key).toBe("ugc/Maya/body/new.mp4");
    expect(set.hooks).toHaveLength(5);
    expect(set.endings).toHaveLength(3);
  });

  it("hands a set's takes to the variants and length cuts steps only", () => {
    const nodes: AutomationNode[] = [
      {
        id: "variants_1",
        kind: "step",
        stepId: "recipe-hook-variants",
        input: { hook_3_url: "https://old/x.mp4", ending_seconds: 5 },
        position: { x: 0, y: 0 },
      },
      {
        id: "lengths_1",
        kind: "step",
        stepId: "recipe-length-cuts",
        input: { lengths: "15" },
        position: { x: 0, y: 0 },
      },
      {
        id: "caption_1",
        kind: "step",
        stepId: "video-caption",
        input: {},
        position: { x: 0, y: 0 },
      },
    ];
    const [variants, lengths, caption] = withCreatorTakes(nodes, {
      creator: "Maya",
      hooks: [
        { file_url: "https://f/h1.mp4", file_name: "h1.mp4" },
        { file_url: "https://f/h2.mp4", file_name: "h2.mp4" },
      ],
      endings: [{ file_url: "https://f/c1.mp4", file_name: "c1.mp4" }],
    });
    expect(variants.input).toEqual({
      ending_seconds: 5,
      creator: "Maya",
      base_cut: "is only the body",
      hook_1_url: "https://f/h1.mp4",
      hook_2_url: "https://f/h2.mp4",
      ending_1_url: "https://f/c1.mp4",
    });
    expect(lengths.input).toEqual({ lengths: "15", creator: "Maya" });
    expect(caption).toBe(nodes[2]);
    // The saved steps are left alone.
    expect(nodes[0].input.hook_3_url).toBe("https://old/x.mp4");
  });

  it("has a ready-made that starts from creator folders", () => {
    const starter = STARTERS.find((each) => each.id === "ugc-ad-variants-from-creator-folders")!;
    expect(starter.trigger).toEqual({
      kind: "folder",
      prefix: "ugc/",
      fileType: "video",
      layout: "creators",
    });
    expect(starter.nodes[0].input.base_cut).toBe("is only the body");
    expect(starter.category).toBe("variants");
  });
});
