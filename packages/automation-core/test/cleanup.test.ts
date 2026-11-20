import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, describe, expect, it } from "vitest";

import {
  CLEANUP_DEFAULTS,
  cleanupRequest,
  cleanupSentence,
  cleanupSettings,
  creatorFromKey,
  cutRate,
  findMarkers,
  findRetakes,
  isTakeLabel,
  planCleanup,
  type Word,
} from "../src";

const run = promisify(execFile);

/** Words said one after another: each lasts 0.3 s with a 0.1 s gap, unless a pause is given. */
function said(text: string, from = 0, pauses: Record<number, number> = {}): Word[] {
  const words: Word[] = [];
  let at = from;
  text
    .split(/\s+/)
    .filter(Boolean)
    .forEach((word, index) => {
      at += pauses[index] ?? 0;
      words.push({ text: word, start: at, end: at + 0.3 });
      at += 0.4;
    });
  return words;
}

const texts = (words: Word[], keep: { start: number; end: number }[]) =>
  words
    .filter((word) =>
      keep.some((range) => word.start >= range.start - 0.01 && word.end <= range.end + 0.01),
    )
    .map((word) => word.text)
    .join(" ");

describe("cleanupSettings", () => {
  it("fills gaps with defaults and keeps numbers in range", () => {
    expect(cleanupSettings({})).toEqual(CLEANUP_DEFAULTS);
    const set = cleanupSettings({
      cutPausesOver: 99,
      leavePause: 9,
      hooks: "count",
      hookCount: 40,
      retakes: false,
      creator: "  Jane  ",
    });
    expect(set).toEqual({
      cutPausesOver: 5,
      leavePause: 1,
      retakes: false,
      hooks: "count",
      hookCount: 9,
      creator: "Jane",
    });
    expect(cleanupSettings({ hooks: "nonsense" }).hooks).toBe("said");
  });
});

describe("findRetakes", () => {
  it("drops a line started again and keeps the last take", () => {
    // "These boots are" ... "These boots are the warmest I own."
    const words = said("These boots are. These boots are. These boots are the warmest I own.");
    const retakes = findRetakes(words);
    expect(retakes).toEqual([
      { first: 0, last: 2 },
      { first: 3, last: 5 },
    ]);
  });

  it("drops a line said again in other words", () => {
    const words = said(
      "So I tried every jacket out there. So I tried basically every single jacket. And this one won.",
    );
    expect(findRetakes(words)).toEqual([{ first: 0, last: 6 }]);
  });

  it("takes out sorry and again said between two takes", () => {
    const words = said("I love these boots. Sorry, again. I love these boots so much.");
    const kept = findRetakes(words).flatMap((retake) =>
      Array.from({ length: retake.last - retake.first + 1 }, (_, at) => retake.first + at),
    );
    expect(kept.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("leaves different lines alone", () => {
    const words = said("These boots are warm. They are light too. And they last for years.");
    expect(findRetakes(words)).toEqual([]);
  });
});

describe("findMarkers", () => {
  it("hears hook one, hook number two, third hook and body at the start of a line", () => {
    const words = said(
      "Hook one. Cold feet? Hook number two. Freezing? Third hook. Winter. Body. So here is why.",
    );
    expect(findMarkers(words).map((marker) => [marker.kind, marker.first, marker.last])).toEqual([
      ["hook", 0, 1],
      ["hook", 4, 6],
      ["hook", 8, 9],
      ["body", 11, 11],
    ]);
  });

  it("does not take a hook talked about in passing", () => {
    expect(findMarkers(said("The hook one uses is strong"))).toEqual([]);
  });
});

describe("planCleanup", () => {
  it("takes long pauses down to a short breath and never cuts into a word", () => {
    const words = said("one two three four", 1, { 2: 3 });
    // A 3.1 s pause between "two" and "three", heard by the silence check.
    const pause = { start: words[1].end, end: words[2].start };
    const plan = planCleanup({
      words,
      pauses: [{ start: 0, end: 0.95 }, pause],
      duration: 8,
      settings: CLEANUP_DEFAULTS,
    });
    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0].label).toBeNull();
    const [first, second] = plan.parts[0].keep;
    expect(first.start).toBeCloseTo(0.92);
    expect(first.end).toBeCloseTo(pause.start + 0.125);
    expect(second.start).toBeCloseTo(pause.end - 0.125);
    expect(plan.pauses).toBe(1);
    expect(plan.pauseSeconds).toBeCloseTo(3.1 - 0.25);
    expect(texts(words, plan.parts[0].keep)).toBe("one two three four");
    expect(plan.after).toBeLessThan(plan.before - 4);
  });

  it("drops the retakes and counts them", () => {
    const words = said("These boots are. These boots are the warmest I own.");
    const plan = planCleanup({ words, pauses: [], duration: 6, settings: CLEANUP_DEFAULTS });
    expect(plan.retakes).toBe(1);
    expect(texts(words, plan.parts[0].keep)).toBe("These boots are the warmest I own.");
  });

  it("keeps retakes when told to", () => {
    const words = said("These boots are. These boots are warm.");
    const plan = planCleanup({
      words,
      pauses: [],
      duration: 4,
      settings: { ...CLEANUP_DEFAULTS, retakes: false },
    });
    expect(plan.retakes).toBe(0);
    expect(texts(words, plan.parts[0].keep)).toBe("These boots are. These boots are warm.");
  });

  it("splits said hook takes into files and keeps hooks that open alike", () => {
    const words = said(
      "Okay rolling. Hook one. Are your feet always cold? Hook two. Are your feet freezing every winter? Hook three. Are your toes numb? Body. These boots fixed it. These boots fixed it for good.",
    );
    const plan = planCleanup({ words, pauses: [], duration: 30, settings: CLEANUP_DEFAULTS });
    expect(plan.parts.map((part) => part.label)).toEqual(["hook01", "hook02", "hook03", "body"]);
    expect(plan.hooks).toBe(3);
    expect(texts(words, plan.parts[0].keep)).toBe("Are your feet always cold?");
    expect(texts(words, plan.parts[1].keep)).toBe("Are your feet freezing every winter?");
    expect(texts(words, plan.parts[2].keep)).toBe("Are your toes numb?");
    // The body's own retake is dropped; the hooks were never compared with each other.
    expect(texts(words, plan.parts[3].keep)).toBe("These boots fixed it for good.");
    expect(plan.retakes).toBe(1);
  });

  it("ends the last hook at its first sentence when no body is said", () => {
    const words = said("Hook one. Cold feet? Hook two. Freezing toes? These boots fixed it.");
    const plan = planCleanup({ words, pauses: [], duration: 20, settings: CLEANUP_DEFAULTS });
    expect(plan.parts.map((part) => texts(words, part.keep))).toEqual([
      "Cold feet?",
      "Freezing toes?",
      "These boots fixed it.",
    ]);
  });

  it("takes the first takes as hooks when counting", () => {
    const words = said("Cold feet? Freezing toes? These boots fixed it.", 0, { 2: 1.5, 4: 1.5 });
    const plan = planCleanup({
      words,
      pauses: [],
      duration: 12,
      settings: { ...CLEANUP_DEFAULTS, hooks: "count", hookCount: 2 },
    });
    expect(plan.parts.map((part) => part.label)).toEqual(["hook01", "hook02", "body"]);
    expect(texts(words, plan.parts[2].keep)).toBe("These boots fixed it.");
  });

  it("makes one video when no hooks are said", () => {
    const words = said("Just a normal talk about boots.");
    const plan = planCleanup({ words, pauses: [], duration: 5, settings: CLEANUP_DEFAULTS });
    expect(plan.parts.map((part) => part.label)).toEqual([null]);
    expect(plan.hooks).toBe(0);
  });

  it("keeps nothing from a recording with no speech", () => {
    expect(
      planCleanup({ words: [], pauses: [], duration: 5, settings: CLEANUP_DEFAULTS }).parts,
    ).toEqual([]);
  });
});

describe("cleanupSentence", () => {
  it("says what was taken out", () => {
    expect(
      cleanupSentence({ pauses: 12, pauseSeconds: 18.2, retakes: 1, retakeSeconds: 4, hooks: 3 }),
    ).toBe(
      "Took out 12 long pauses (18 s) and 1 retake (4 s). Split out 3 hook takes and the body.",
    );
    expect(
      cleanupSentence({ pauses: 0, pauseSeconds: 0, retakes: 0, retakeSeconds: 0, hooks: 0 }),
    ).toBe("No long pauses or retakes to take out.");
  });
});

describe("creatorFromKey", () => {
  it("names the creator from the folder inside the watched one", () => {
    expect(creatorFromKey("teams/x/raw-takes/Jane Doe/take 3.mp4", "raw-takes/")).toBe("Jane Doe");
    expect(creatorFromKey("raw-takes/Jane/2026/take.mp4", "raw-takes/")).toBe("2026");
    expect(creatorFromKey("raw-takes/take.mp4", "raw-takes/")).toBeNull();
    expect(creatorFromKey("elsewhere/Jane/take.mp4", "raw-takes/")).toBeNull();
    expect(creatorFromKey(undefined, "raw-takes/")).toBeNull();
  });
});

describe("labels and rates", () => {
  it("knows a take's file code", () => {
    expect(isTakeLabel("hook01")).toBe(true);
    expect(isTakeLabel("body")).toBe(true);
    expect(isTakeLabel("h01_c01")).toBe(false);
    expect(isTakeLabel(null)).toBe(false);
  });

  it("cuts sound on whole frames", () => {
    expect(cutRate(29.97)).toBe(30);
    expect(cutRate(23.976)).toBe(24);
    expect(cutRate(25)).toBe(25);
    expect(cutRate(undefined)).toBe(30);
    expect(cutRate(7)).toBe(30);
  });
});

describe("cleanupRequest on real FFmpeg", () => {
  const dir = mkdtempSync(join(tmpdir(), "cleanup-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps only the chosen stretches, with picture and sound the same length", async () => {
    const source = join(dir, "take.mp4");
    // 12 s of a moving test picture with a tone that is silent from 3 s to 8 s.
    await run("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x240:rate=30:duration=12",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=12",
      "-filter_complex",
      "[1:a]volume='if(between(t,3,8),0,1)':eval=frame[a]",
      "-map",
      "0:v",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      "-shortest",
      source,
    ]);
    const request = cleanupRequest(
      source,
      {
        keep: [
          { start: 0.5, end: 3.1 },
          { start: 7.9, end: 11 },
        ],
      },
      29.97,
    ) as {
      inputs: { file_url: string; options: { option: string; argument?: string | number }[] }[];
      filters: { filter: string }[];
      outputs: { options: { option: string; argument?: string | number }[] }[];
    };
    const flat = (options: { option: string; argument?: string | number }[]) =>
      options.flatMap((item) =>
        item.argument === undefined ? [item.option] : [item.option, String(item.argument)],
      );
    const out = join(dir, "clean.mp4");
    await run("ffmpeg", [
      "-y",
      ...flat(request.inputs[0].options),
      "-i",
      request.inputs[0].file_url,
      "-filter_complex",
      request.filters.map((filter) => filter.filter).join(";"),
      ...flat(request.outputs[0].options).filter((part) => part !== "mp4" && part !== "-f"),
      out,
    ]);
    const probe = async (stream: string) =>
      Number(
        (
          await run("ffprobe", [
            "-v",
            "error",
            "-select_streams",
            stream,
            "-show_entries",
            "stream=duration",
            "-of",
            "csv=p=0",
            out,
          ])
        ).stdout.trim(),
      );
    const video = await probe("v:0");
    const audio = await probe("a:0");
    expect(video).toBeCloseTo(2.6 + 3.1, 1);
    expect(audio).toBeCloseTo(2.6 + 3.1, 1);
    expect(Math.abs(video - audio)).toBeLessThan(0.05);
  }, 60_000);
});
