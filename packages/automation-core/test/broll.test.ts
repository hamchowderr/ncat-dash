import { execFile, execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BROLL_DEFAULTS,
  brollMomentsFromPicks,
  brollMomentsFromWords,
  brollPicksFrom,
  brollRequest,
  brollSettings,
  chooseCutaways,
  cutawayBox,
  cutawaySummary,
  type Footage,
  looksLikeBroll,
  scoreOf,
  shownWords,
  type Word,
} from "../src";

function wordsOf(text: string, start = 0, gap = 0.4): Word[] {
  let at = start;
  return text.split(" ").map((word) => {
    const one = { text: word, start: at, end: at + gap - 0.05 };
    at += gap;
    return one;
  });
}

function footage(ref: string, score: number, extra: Partial<Footage> = {}): Footage {
  return {
    kind: "library",
    url: `https://bucket.example.com/${ref}.mp4`,
    ref,
    title: ref,
    duration: 10,
    bestAt: 5,
    score,
    ...extra,
  };
}

describe("B-Roll settings", () => {
  it("fills blanks and keeps numbers in range", () => {
    expect(brollSettings({})).toEqual(BROLL_DEFAULTS);
    expect(brollSettings({ seconds: 99, skipOpening: -4, often: "wild", look: "window" })).toEqual({
      ...BROLL_DEFAULTS,
      seconds: 8,
      skipOpening: 0,
      look: "window",
    });
    expect(brollSettings({ seconds: "2.5", sources: "library" }).seconds).toBe(2.5);
  });
});

describe("what could be shown", () => {
  it("keeps the words that name something", () => {
    expect(shownWords("I started this whole thing in my dad's garage.")).toBe("whole dad garage");
    expect(shownWords("So yeah, I think that's really it.")).toBe("");
    expect(shownWords("They were solutions to problems I didn't know about.")).toBe(
      "solutions problems",
    );
    expect(shownWords("We drove to the beach and watched the sunset over the ocean")).toBe(
      "beach sunset ocean",
    );
  });

  it("makes one moment per sentence that names something", () => {
    const words = [
      ...wordsOf("Okay so yeah."),
      ...wordsOf("I opened a coffee shop downtown.", 2),
      ...wordsOf("It was okay.", 5),
    ];
    const moments = brollMomentsFromWords(words);
    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({ start: 2, show: "coffee shop downtown" });
    expect(moments[0].said).toBe("I opened a coffee shop downtown.");
  });
});

describe("Plan B-Roll's answer", () => {
  it("reads only well-formed picks", () => {
    expect(
      brollPicksFrom({
        cutaways: [{ quote: "my dad's garage", show: "a cluttered garage" }, { quote: "x" }, 4],
      }),
    ).toEqual([{ quote: "my dad's garage", show: "a cluttered garage" }]);
    expect(brollPicksFrom(null)).toEqual([]);
  });

  it("places quotes on the words and drops what was not said", () => {
    const words = wordsOf("I started this in my dad's garage and then we moved to an office");
    const { moments, dropped } = brollMomentsFromPicks(words, [
      { quote: "moved to an office", show: "a bright office" },
      { quote: "my dads garage", show: "a garage" },
      { quote: "a castle", show: "castle" },
    ]);
    expect(dropped).toBe(1);
    expect(moments.map((m) => m.show)).toEqual(["a garage", "a bright office"]);
    expect(moments[0].start).toBeCloseTo(1.6);
  });
});

describe("choosing cutaways", () => {
  const moments = [0, 4, 9, 20, 30].map((start, index) => ({
    start,
    end: start + 3,
    said: `sentence ${index}`,
    show: `thing ${index}`,
  }));

  it("keeps the opening on the speaker, spaces them out and never reuses footage", () => {
    const cuts = chooseCutaways(
      moments,
      [
        [footage("V1", 0.3)],
        [footage("V2", 0.31)],
        [footage("V2", 0.32), footage("V3", 0.28)],
        [footage("V4", 0.29)],
        [footage("V5", 0.2)],
      ],
      { ...BROLL_DEFAULTS, often: "medium", seconds: 3, skipOpening: 3 },
      { duration: 40 },
    );
    // The first moment starts inside the opening, so it moves to 3 s; V2 is best at 9 s
    // and then too close to the 4 s one, which loses; V5 does not look enough like it.
    expect(cuts.map((cut) => [cut.start, cut.footage.ref])).toEqual([
      [9, "V2"],
      [20, "V4"],
    ]);
    expect(cuts[0].end).toBe(12);
    // Centred on the footage's best second.
    expect(cuts[0].from).toBeCloseTo(3.5);
  });

  it("stays clear of what is to be avoided and ends before the video does", () => {
    const cuts = chooseCutaways(
      [moments[2], { ...moments[4], start: 38.5, end: 39.5 }],
      [[footage("V1", 0.3)], [footage("V2", 0.3)]],
      { ...BROLL_DEFAULTS, seconds: 4 },
      { duration: 40, avoid: [{ start: 10, end: 11 }] },
    );
    expect(cuts).toEqual([]);
  });

  it("busy allows more than light", () => {
    const all = moments.map((_, index) => [footage(`V${index}`, 0.3)]);
    const busy = chooseCutaways(
      moments,
      all,
      { ...BROLL_DEFAULTS, often: "busy", skipOpening: 0 },
      {
        duration: 40,
      },
    );
    const light = chooseCutaways(
      moments,
      all,
      { ...BROLL_DEFAULTS, often: "light", skipOpening: 0 },
      {
        duration: 40,
      },
    );
    expect(busy.length).toBeGreaterThan(light.length);
  });

  it("says where the footage came from", () => {
    const stock = footage("pixabay:1", 0.3, {
      kind: "stock",
      credit: { site: "Pixabay", page: "https://pixabay.com/videos/1", by: "someone" },
    });
    const cuts = chooseCutaways(
      moments.slice(2, 4),
      [[footage("V1", 0.3)], [stock]],
      { ...BROLL_DEFAULTS, skipOpening: 0 },
      { duration: 40 },
    );
    expect(cutawaySummary(cuts)).toBe("Added 2 cutaways: 1 from your library, 1 from Pixabay.");
    expect(cutawaySummary([])).toBe("No cutaways were added.");
  });

  // Scores from the first real run: "international space station" against the team's own
  // astronaut clip (0.283) and a Pixabay still (0.288).
  it("prefers the library over stock that matches about as well", () => {
    const stock = footage("pixabay:238", 0.288, { kind: "stock" });
    const [cut] = chooseCutaways(
      moments.slice(2, 3),
      [[stock, footage("V2", 0.283)]],
      { ...BROLL_DEFAULTS, skipOpening: 0 },
      { duration: 40 },
    );
    expect(cut.footage.ref).toBe("V2");
    // A clearly better stock clip still wins.
    const [better] = chooseCutaways(
      moments.slice(2, 3),
      [[footage("pixabay:9", 0.31, { kind: "stock" }), footage("V2", 0.283)]],
      { ...BROLL_DEFAULTS, skipOpening: 0 },
      { duration: 40 },
    );
    expect(better.footage.ref).toBe("pixabay:9");
  });

  it("never lets a weak library match in on the preference", () => {
    const cuts = chooseCutaways(
      moments.slice(2, 3),
      [[footage("V2", 0.245)]],
      { ...BROLL_DEFAULTS, skipOpening: 0, match: "normal" },
      { duration: 40 },
    );
    expect(cuts).toEqual([]);
  });

  // The NASA interview's cuts, found by the toolkit: its helmet shot runs 20.3 s to 27.8 s,
  // and the astronaut clip once landed at 22.5 s inside it, so the helmet showed twice.
  const NASA_CUTS = [0.1, 5.3, 7.6, 10.8, 12.2, 15.1, 18.1, 20.3, 27.8, 31.1, 35.9, 39.5];
  const said = (start: number) => [
    { start, end: start + 2, said: "the space station", show: "space station" },
  ];

  it("covers a short shot of the video whole instead of cutting into it", () => {
    const [cut] = chooseCutaways(
      said(22.5),
      [[footage("ASTRO", 0.28, { duration: 16.5 })]],
      BROLL_DEFAULTS,
      {
        duration: 75,
        cuts: NASA_CUTS,
      },
    );
    expect([cut.start, cut.end]).toEqual([20.3, 27.8]);
  });

  it("leaves a short shot alone when the footage is too short to cover it", () => {
    expect(
      chooseCutaways(said(22.5), [[footage("ASTRO", 0.28, { duration: 4 })]], BROLL_DEFAULTS, {
        duration: 75,
        cuts: NASA_CUTS,
      }),
    ).toEqual([]);
  });

  it("moves an edge onto a cut close by, and ends where the video cuts", () => {
    // Starts 0.6 s into the 31.1 s shot: it starts with the shot.
    const [early] = chooseCutaways(said(31.7), [[footage("A", 0.3)]], BROLL_DEFAULTS, {
      duration: 75,
      cuts: NASA_CUTS,
    });
    expect([early.start, early.end]).toEqual([31.1, 34.1]);
    // 3 s from 13.5 s would run past the cut at 15.1 s: it ends there.
    const [cut] = chooseCutaways(
      said(13.5),
      [[footage("B", 0.3)]],
      { ...BROLL_DEFAULTS, skipOpening: 0 },
      {
        duration: 75,
        cuts: [0.1, 12.2, 15.1, 30],
      },
    );
    expect([cut.start, cut.end]).toEqual([13.5, 15.1]);
  });

  it("cuts away inside a long take, where the speaker talks", () => {
    const [cut] = chooseCutaways(said(50), [[footage("A", 0.3)]], BROLL_DEFAULTS, {
      duration: 75,
      cuts: [40, 70],
    });
    expect([cut.start, cut.end]).toEqual([50, 53]);
  });

  it("is placed as before when the cuts are not known", () => {
    const [cut] = chooseCutaways(
      said(22.5),
      [[footage("ASTRO", 0.28, { duration: 16.5 })]],
      BROLL_DEFAULTS,
      {
        duration: 75,
      },
    );
    expect([cut.start, cut.end]).toEqual([22.5, 25.5]);
  });
});

describe("what counts as B-Roll", () => {
  it("is short, with small faces and little said", () => {
    expect(looksLikeBroll({ duration: 12, faces: [0, 0.01, 0] })).toBe(true);
    expect(looksLikeBroll({ duration: 12, faces: [0.2, 0.25, 0.22] })).toBe(false);
    expect(looksLikeBroll({ duration: 60, faces: [0], spokenWords: 150 })).toBe(false);
    expect(looksLikeBroll({ duration: 900, faces: [0] })).toBe(false);
  });

  // The faces the picture model found in a real NASA interview (75 s, 720p, not yet
  // transcribed): she is in a medium shot most of the time, about 2.5% of the frame.
  it("is not an interview where someone is on camera most of the time", () => {
    const interview = [
      0.058, 0.037, 0.016, 0.017, 0.025, 0.025, 0.024, 0.026, 0.057, 0.024, 0.02, 0.024, 0.025,
      0.024, 0, 0, 0.03, 0.023, 0.024, 0.02, 0.021, 0.059, 0.063, 0.315, 0.308, 0.311, 0.294, 0.026,
      0, 0, 0, 0.061, 0.03, 0.024, 0, 0, 0,
    ];
    expect(looksLikeBroll({ duration: 75, faces: interview })).toBe(false);
    // A launch, the Earth from orbit: nobody on camera.
    expect(looksLikeBroll({ duration: 57, faces: Array(28).fill(0) })).toBe(true);
    // A crowd or a wide shot: faces now and then, all small.
    expect(looksLikeBroll({ duration: 20, faces: [0, 0.006, 0.008, 0, 0.004, 0.015, 0, 0] })).toBe(
      true,
    );
  });

  it("scores unit vectors", () => {
    expect(scoreOf([1, 0], [1, 0])).toBe(1);
    expect(scoreOf([1, 0], [0, 1])).toBe(0);
  });
});

describe("the cutaway box", () => {
  it("fills the frame or sits as a window", () => {
    expect(cutawayBox("full", { width: 1080, height: 1920 })).toEqual({
      width: 1080,
      height: 1920,
      x: 0,
      y: 0,
    });
    const tall = cutawayBox("window", { width: 1080, height: 1920 });
    expect(tall.width).toBe(928);
    expect(tall.x).toBe(76);
    const wide = cutawayBox("window", { width: 1920, height: 1080 });
    expect(wide.x + wide.width).toBeLessThan(1920);
  });
});

const runFile = promisify(execFile);
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe.skipIf(!hasFfmpeg)("laying B-Roll over a real video", () => {
  let dir = "";
  const ffmpeg = (args: string[]) =>
    runFile("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { timeout: 120_000 });
  const probe = (file: string, entries: string, stream = "v:0") =>
    execFileSync("ffprobe", [
      ...["-v", "error", "-select_streams", stream],
      ...["-show_entries", entries, "-of", "csv=p=0:s=x", file],
    ])
      .toString()
      .trim();
  // The colour in the middle of the frame at a time, as "r,g,b".
  const colourAt = (file: string, time: number) => {
    const raw = execFileSync("ffmpeg", [
      ...["-v", "error", "-ss", String(time), "-i", file, "-frames:v", "1"],
      ...[
        "-vf",
        "crop=8:8:(iw-8)/2:(ih-8)/2,scale=1:1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ],
    ]);
    return [...raw.subarray(0, 3)];
  };

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "broll-"));
    await ffmpeg([
      ...["-f", "lavfi", "-i", "color=c=0x0000FF:size=720x1280:rate=25:duration=10"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:duration=10"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac"],
      path.join(dir, "talk.mp4"),
    ]);
    await ffmpeg([
      ...["-f", "lavfi", "-i", "color=c=0xFF0000:size=1280x720:rate=30:duration=6"],
      ...["-f", "lavfi", "-i", "sine=frequency=900:duration=6"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac"],
      path.join(dir, "red.mp4"),
    ]);
    await ffmpeg([
      ...["-f", "lavfi", "-i", "color=c=0x00FF00:size=1920x1080:rate=24:duration=5"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"],
      path.join(dir, "green.mp4"),
    ]);
  }, 60_000);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  async function render(look: "full" | "window", name: string) {
    const cut = (ref: string, start: number, end: number) => ({
      start,
      end,
      said: "",
      show: "",
      footage: footage(ref, 0.3, { url: `file:${ref}.mp4`, duration: 5 }),
      from: 1,
    });
    const request = brollRequest(
      "file:talk.mp4",
      { width: 720, height: 1280 },
      [cut("red", 2, 4), cut("green", 6, 8.5)],
      look,
    ) as {
      inputs: { file_url: string; options?: { option: string; argument?: unknown }[] }[];
      filters: { filter: string }[];
      outputs: { options: { option: string; argument?: unknown }[] }[];
    };
    // The same command the toolkit's ffmpeg_compose.py builds.
    const args: string[] = [];
    for (const input of request.inputs) {
      for (const item of input.options ?? []) {
        args.push(item.option);
        if (item.argument !== undefined) args.push(String(item.argument));
      }
      args.push("-i", path.join(dir, input.file_url.slice("file:".length)));
    }
    args.push("-filter_complex", request.filters.map((item) => item.filter).join(";"));
    for (const item of request.outputs[0].options) {
      args.push(item.option);
      if (item.argument !== undefined) args.push(String(item.argument));
    }
    const file = path.join(dir, `${name}.mp4`);
    await ffmpeg([...args, file]);
    return file;
  }

  it("covers the video only while each cutaway lasts, keeping its size, length and sound", async () => {
    const file = await render("full", "full");
    expect(probe(file, "stream=width,height")).toBe("720x1280");
    expect(Number(probe(file, "stream=duration"))).toBeCloseTo(10, 0);
    expect(probe(file, "stream=codec_type", "a")).toBe("audio");
    const [r1, , b1] = colourAt(file, 1);
    expect(b1).toBeGreaterThan(200);
    expect(r1).toBeLessThan(40);
    expect(colourAt(file, 3)[0]).toBeGreaterThan(200);
    expect(colourAt(file, 5)[2]).toBeGreaterThan(200);
    expect(colourAt(file, 7)[1]).toBeGreaterThan(200);
    expect(colourAt(file, 9.5)[2]).toBeGreaterThan(200);
  }, 120_000);

  it("as a window, leaves the speaker showing around it", async () => {
    const file = await render("window", "window");
    // The middle of a tall frame is below the window, so it stays on the speaker.
    expect(colourAt(file, 3)[2]).toBeGreaterThan(200);
    const top = execFileSync("ffmpeg", [
      ...["-v", "error", "-ss", "3", "-i", file, "-frames:v", "1"],
      ...["-vf", "crop=8:8:356:300,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    ]);
    expect(top[0]).toBeGreaterThan(200);
  }, 120_000);
});
