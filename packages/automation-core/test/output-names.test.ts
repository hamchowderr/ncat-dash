import { describe, expect, it, test } from "vitest";

import {
  isMachineName,
  nameFiles,
  outputNoun,
  plainName,
  runOutputNames,
  runStem,
  stepFileLabels,
} from "../src/output-names";

const JOB = "ca4934e3-5b1f-4c3e-9a77-0d2f1b6e8a10";
const out = (name: string) => `https://files.example.com/${name}`;

describe("plainName", () => {
  test("says a person's file name plainly", () => {
    expect(plainName("space-interviews.mp4")).toBe("Space interviews");
    expect(plainName("Q3_recap_final.mov")).toBe("Q3 recap final");
  });

  test("gives nothing for a toolkit name", () => {
    expect(plainName(`${JOB}_output_0.mp4`)).toBeNull();
    expect(plainName(`${JOB}_captioned.mp4`)).toBeNull();
    expect(plainName(`${JOB}.mp4`)).toBeNull();
    expect(plainName("")).toBeNull();
  });

  test("keeps the words around a job id", () => {
    expect(plainName(`space-interviews-${JOB}.mp4`)).toBe("Space interviews");
  });
});

test("isMachineName spots job ids, not people's names", () => {
  expect(isMachineName(`${JOB}_output_0.mp4`)).toBe(true);
  expect(isMachineName("space interviews 2024.mp4")).toBe(false);
});

test("outputNoun says what a file is", () => {
  expect(outputNoun(out("a.mp4"))).toBe("clip");
  expect(outputNoun(out("a.mp3"))).toBe("audio");
  expect(outputNoun(out("a.jpg"), "video-thumbnail")).toBe("thumbnail");
  expect(outputNoun(out("a.png"))).toBe("image");
  expect(outputNoun(out("a.srt"))).toBe("captions");
  expect(outputNoun(out("a.txt"), "media-transcribe")).toBe("transcript");
  expect(outputNoun(out("a.zip"))).toBe("files");
  expect(outputNoun(out("a.bin"))).toBe("file");
});

describe("nameFiles", () => {
  test("numbers clips when a step made several", () => {
    const files = [0, 1, 2].map((n) => out(`${JOB}_output_${n}.mp4`));
    expect(nameFiles("Space interviews", files)).toEqual([
      "Space interviews clip 1",
      "Space interviews clip 2",
      "Space interviews clip 3",
    ]);
  });

  test("leaves the number off a single file and counts each kind apart", () => {
    expect(
      nameFiles(
        "Space interviews",
        [out(`${JOB}_output_0.mp4`), out(`${JOB}.jpg`)],
        "video-thumbnail",
      ),
    ).toEqual(["Space interviews clip", "Space interviews thumbnail"]);
  });

  test("keeps a name a person gave", () => {
    expect(nameFiles("Space interviews", [out("intro%20cut.mp4")])).toEqual(["intro cut.mp4"]);
  });
});

test("runStem prefers the starting file, then the automation", () => {
  expect(runStem("space-interviews.mp4", "Weekly clips")).toBe("Space interviews");
  expect(runStem(`${JOB}_output_0.mp4`, "Weekly clips")).toBe("Weekly clips");
  expect(runStem(null, "  ")).toBe("Output");
});

test("runOutputNames names each file once, under the first step that made it", () => {
  const clips = [0, 1].map((n) => out(`${JOB}_output_${n}.mp4`));
  const captioned = [0, 1].map((n) => out(`${JOB}${n}_captioned.mp4`));
  const names = runOutputNames("Space interviews", [
    { stepId: "clips", outputs: clips },
    // An approval hands the same files on.
    { stepId: null, outputs: clips },
    { stepId: "video-caption", outputs: captioned },
  ]);
  expect(names).toEqual({
    [clips[0]]: "Space interviews clip 1",
    [clips[1]]: "Space interviews clip 2",
    [captioned[0]]: "Space interviews clip 1",
    [captioned[1]]: "Space interviews clip 2",
  });
});

describe("variant codes in file names", () => {
  const job = (id: string) =>
    `https://bucket.example.com/${id}-1234abcd-5678-90ab-cdef-1234567890ab_output_0.mp4`;
  const variants = [job("v1"), job("v2"), job("v3"), job("v4")];

  it("names each hook and ending pairing, then each length and shape after it", () => {
    const first = stepFileLabels(
      [
        {
          stepId: "recipe-hook-variants",
          input: {
            video_url: "https://x/base.mp4",
            hook_2_url: "https://x/h2.mp4",
            ending_2_url: "https://x/c2.mp4",
          },
          outputs: variants,
        },
      ],
      [],
    );
    expect(first.map((item) => item.label)).toEqual(["h01_c01", "h01_c02", "h02_c01", "h02_c02"]);

    const cuts = [job("c1"), job("c2")];
    const second = stepFileLabels(
      [
        {
          stepId: "recipe-length-cuts",
          input: { video_url: variants[2], lengths: "15, 6" },
          outputs: cuts,
        },
      ],
      first,
    );
    expect(second.map((item) => item.label)).toEqual(["h02_c01_6s", "h02_c01_15s"]);

    const shaped = [job("s1")];
    const third = stepFileLabels(
      [
        {
          stepId: "recipe-blur-fill",
          input: { video_url: cuts[1], width: 1080, height: 1350 },
          outputs: shaped,
        },
      ],
      [...first, ...second],
    );
    expect(third).toEqual([{ url: shaped[0], label: "h02_c01_15s_4x5" }]);

    // Defaults count: the blur fill is 9:16 when no size is set.
    const captioned = [job("k1")];
    expect(
      stepFileLabels(
        [{ stepId: "video-caption", input: { video_url: shaped[0] }, outputs: captioned }],
        third,
      ),
    ).toEqual([{ url: captioned[0], label: "h02_c01_15s_4x5_captioned" }]);

    const names = runOutputNames("Boots ad", [
      { stepId: "recipe-hook-variants", outputs: variants, labels: first },
      { stepId: "recipe-blur-fill", outputs: shaped, labels: third },
    ]);
    expect(names[variants[1]]).toBe("Boots ad h01_c02");
    expect(names[shaped[0]]).toBe("Boots ad h02_c01_15s_4x5");
  });

  it("leaves files without codes named as before", () => {
    // A shape or captions alone adds nothing: only a coded file gets more code.
    expect(
      stepFileLabels(
        [
          {
            stepId: "recipe-blur-fill",
            input: { video_url: "https://x/a.mp4" },
            outputs: [job("a")],
          },
        ],
        [],
      ),
    ).toEqual([]);
    expect(
      stepFileLabels(
        [
          {
            stepId: "recipe-crop-vertical",
            input: { video_url: "https://x/a.mp4" },
            outputs: [job("a")],
          },
        ],
        [],
      ),
    ).toEqual([]);
    expect(
      runOutputNames("Talk", [{ stepId: "recipe-blur-fill", outputs: [job("a")] }])[job("a")],
    ).toBe("Talk clip");
  });
});
