import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESET,
  MOTION_PIECES,
  MOTION_PIECE_TYPES,
  MOTION_PRESETS,
  MOTION_SOUNDS,
  NO_MOTION_SETUP,
  PRESET_GROUPS,
  getPreset,
  motionBeatsFromPicks,
  motionPicksFrom,
  motionPlanSettings,
  motionRequest,
  motionSetupFor,
  motionSetupText,
  pieceInfo,
  placedFrom,
  planMotionByRules,
  planSoundsByRules,
  spokenNumbers,
  tidyMotionSetup,
  type MotionSetup,
  type Word,
  nothingToDrawNote,
} from "../src";

/** Words spoken one after another, 0.4 s each, from `start`. */
function say(text: string, start = 0): Word[] {
  return text.split(" ").map((word, index) => ({
    text: word,
    start: Math.round((start + index * 0.4) * 1000) / 1000,
    end: Math.round((start + index * 0.4 + 0.35) * 1000) / 1000,
  }));
}

const setup = (
  change: Partial<MotionSetup> = {},
  style: Partial<MotionSetup["style"]> = {},
): MotionSetup => ({
  ...NO_MOTION_SETUP,
  ...change,
  style: { ...NO_MOTION_SETUP.style, ...style },
});

describe("pieces and presets", () => {
  it("lists every piece the toolkit draws, each with a sound it has", () => {
    expect(MOTION_PIECES.map((piece) => piece.type)).toEqual([...MOTION_PIECE_TYPES]);
    for (const piece of MOTION_PIECES) expect(MOTION_SOUNDS).toContain(piece.sound);
  });

  it("has the 18 presets from the doc, each named once and grouped", () => {
    expect(MOTION_PRESETS).toHaveLength(18);
    expect(new Set(MOTION_PRESETS.map((one) => one.id)).size).toBe(18);
    expect(new Set(MOTION_PRESETS.map((one) => one.name)).size).toBe(18);
    for (const one of MOTION_PRESETS) {
      expect(PRESET_GROUPS).toContain(one.group);
      expect(one.style.pieces.length).toBeGreaterThan(0);
      for (const type of one.style.pieces) expect(MOTION_PIECE_TYPES).toContain(type);
    }
    expect(getPreset(DEFAULT_PRESET)?.name).toBe("Clean Talking Head");
    expect(MOTION_PRESETS.map((one) => one.name)).toContain("Bold Hook");
  });

  it("names presets in Title Case without real people's names", () => {
    for (const one of MOTION_PRESETS) {
      for (const word of one.name.split(/[ -]/)) expect(word[0]).toBe(word[0].toUpperCase());
      expect(one.name).not.toMatch(/Hormozi|MrBeast|Vox|Abdaal|Gadzhi|Tom Scott/);
    }
  });
});

describe("the team's Motion settings", () => {
  it("starts from the picked preset and keeps only known choices", () => {
    const result = tidyMotionSetup({
      preset: "bold-hook",
      style: {
        look: "neon",
        busy: "nope" as never,
        pieces: ["stat", "stat", "explosion" as never],
      },
      handle: " otakusolutions ",
      hostName: "  Ana ",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.setup.style.look).toBe("neon");
    expect(result.setup.style.busy).toBe("busy");
    expect(result.setup.style.pieces).toEqual(["stat"]);
    expect(result.setup.handle).toBe("@otakusolutions");
    expect(result.setup.hostName).toBe("Ana");
  });

  it("refuses an unknown preset and words that are too long", () => {
    expect(tidyMotionSetup({ preset: "nope" })).toEqual({
      ok: false,
      message: "Pick one of the preset styles.",
    });
    const long = tidyMotionSetup({ preset: "bold-hook", hostName: "x".repeat(61) });
    expect(long.ok).toBe(false);
  });

  it("lets a step use another preset's style, keeping the team's names", () => {
    const team = setup({ hostName: "Ana", handle: "@ana" });
    expect(motionSetupFor(team, "team")).toBe(team);
    const other = motionSetupFor(team, "hype");
    expect(other.style).toEqual(getPreset("hype")!.style);
    expect(other.hostName).toBe("Ana");
  });

  it("describes the setup in plain words for the agent", () => {
    const text = motionSetupText(
      setup({ hostName: "Ana", hostRole: "Host", handle: "@ana", notes: "Never use emojis" }),
    );
    expect(text).toContain("Clean Talking Head");
    expect(text).toContain("Usual speaker: Ana, Host.");
    expect(text).toContain("@ana");
    expect(text).toContain("Never use emojis");
  });
});

describe("numbers that are said", () => {
  it("finds figures with what they count, joining units", () => {
    const words = say("We grew 40 percent in 6 months and made $12,000 last year in 2024.");
    expect(spokenNumbers(words)).toEqual([
      { at: words[2].start, figure: "40%", label: "in 6 months" },
      { at: words[9].start, figure: "$12,000", label: "last year" },
    ]);
  });

  it("skips small counting numbers and years", () => {
    expect(spokenNumbers(say("I have 3 tips from 2019 for you"))).toEqual([]);
    expect(spokenNumbers(say("that is 3 million views"))).toEqual([
      expect.objectContaining({ figure: "3 million", label: "views" }),
    ]);
  });
});

describe("placing pieces by rules", () => {
  const words = say(
    "Hi I'm Ana and today we grew 40 percent faster than last year with our team",
    1,
  );

  it("opens with a title, names the speaker, shows numbers and ends with the follow card", () => {
    const plan = planMotionByRules({
      words,
      duration: 30,
      setup: setup(
        { hostName: "Ana", hostRole: "Host", handle: "@ana" },
        { pieces: ["title", "lower_third", "stat", "follow"], opening: "title", ending: "follow" },
      ),
      title: "Growing Fast",
    });
    expect(plan.pieces.map((piece) => piece.type)).toEqual([
      "title",
      "lower_third",
      "stat",
      "follow",
    ]);
    const [title, name, stat, follow] = plan.pieces;
    expect(title).toMatchObject({ start: 0.2, title: "Growing Fast" });
    // The title sits in the middle, the name at the bottom: both can show at once.
    expect(name).toMatchObject({ start: 1.5, title: "Ana", subtitle: "Host" });
    expect(stat).toMatchObject({ title: "40%", subtitle: "faster than last year" });
    expect(follow.start + follow.duration).toBeCloseTo(29.7);
    expect(follow).toMatchObject({ title: "@ana", subtitle: "Follow for more" });
  });

  it("never puts two pieces in one place at once and keeps the style's gap", () => {
    const many = say(Array.from({ length: 30 }, (_, i) => `we made ${100 + i} sales`).join(" "));
    const plan = planMotionByRules({
      words: many,
      duration: 60,
      setup: setup({}, { pieces: ["stat"], busy: "medium" }),
    });
    const stats = plan.pieces.filter((piece) => piece.type === "stat");
    expect(stats.length).toBeGreaterThan(1);
    for (let i = 1; i < stats.length; i++) {
      expect(stats[i].start - stats[i - 1].start).toBeGreaterThanOrEqual(12);
    }
  });

  it("leaves out what is switched off or has nothing to show", () => {
    const plan = planMotionByRules({
      words,
      duration: 30,
      setup: setup(
        { hostName: "", handle: "" },
        { pieces: ["lower_third", "follow", "title"], opening: "title" },
      ),
    });
    expect(plan.pieces).toEqual([]);
  });

  it("puts a card at each chapter after the first, or a transition when cards are off", () => {
    const chapters = [
      { start: 0, title: "Intro", bullets: [] },
      { start: 12, title: "The plan", bullets: [] },
    ];
    const cards = planMotionByRules({
      words,
      duration: 30,
      chapters,
      setup: setup({}, { pieces: ["chapter"] }),
    });
    expect(cards.pieces).toEqual([
      { type: "chapter", start: 12, duration: 2.4, title: "The plan" },
    ]);
    const wipes = planMotionByRules({
      words,
      duration: 30,
      chapters,
      setup: setup({}, { pieces: ["transition"] }),
    });
    expect(wipes.pieces).toEqual([{ type: "transition", start: 11.65, duration: 0.7 }]);
  });

  it("uses the logo to open or end when the style says so", () => {
    const plan = planMotionByRules({
      words,
      duration: 20,
      setup: setup({}, { pieces: [], opening: "logo", ending: "logo" }),
      logo: "https://example.com/logo.png",
    });
    expect(plan.pieces.map((piece) => [piece.type, piece.start])).toEqual([
      ["logo", 0.2],
      ["logo", 16.7],
    ]);
  });

  it("keeps a short video's pieces inside it", () => {
    const plan = planMotionByRules({
      words: say("Hello", 0.2),
      duration: 3,
      setup: setup({ hostName: "Ana" }, { pieces: ["lower_third"] }),
    });
    for (const piece of plan.pieces) expect(piece.start + piece.duration).toBeLessThanOrEqual(3);
  });
});

describe("sound effects by rules", () => {
  it("hits at the start, whooshes at chapters, pops on numbers and dings at the end", () => {
    const words = say("So we made 500 sales and then 900 more", 0.5);
    const sounds = planSoundsByRules({
      words,
      duration: 40,
      level: "heavy",
      chapters: [
        { start: 0, title: "A", bullets: [] },
        { start: 20, title: "B", bullets: [] },
      ],
    });
    expect(sounds.map((one) => one.sound)).toEqual(["impact", "pop", "pop", "whoosh", "ding"]);
    expect(sounds.at(-1)!.at).toBe(38.8);
  });

  it("is sparser when light", () => {
    const words = say("we made 500 sales and then 900 more and 700 again", 0.5);
    const heavy = planSoundsByRules({ words, duration: 30, level: "heavy" }).filter(
      (s) => s.sound === "pop",
    );
    const light = planSoundsByRules({ words, duration: 30, level: "light" }).filter(
      (s) => s.sound === "pop",
    );
    expect(light.length).toBeLessThan(heavy.length);
  });
});

describe("the toolkit request", () => {
  it("carries the plan, the look, the brand colour and font, and the sound level", () => {
    const request = motionRequest(
      "https://files.example.com/a.mp4",
      {
        pieces: [
          { type: "stat", start: 2, duration: 3, title: "40%", subtitle: "growth", sound: null },
        ],
        sounds: [{ sound: "riser", at: 5 }],
      },
      setup({}, { look: "neon", sound: "light" }),
      { color: "#FF2A6D", font: "Archivo Black" },
    );
    expect(request).toEqual({
      video_url: "https://files.example.com/a.mp4",
      pieces: [
        { type: "stat", start: 2, duration: 3, title: "40%", subtitle: "growth", sound: null },
      ],
      sounds: [{ sound: "riser", at: 5 }],
      style: { look: "neon", accent: "#FF2A6D", font: "Archivo Black" },
      sound_volume: 0.55,
      piece_sounds: true,
    });
  });

  it("drops a brand colour or font the toolkit would refuse", () => {
    const request = motionRequest("u", { pieces: [], sounds: [] }, setup(), {
      color: "red",
      font: "x;}",
    });
    expect(request.style).toEqual({ look: NO_MOTION_SETUP.style.look });
  });

  it("records what was placed for later steps", () => {
    expect(
      placedFrom("u", { pieces: [{ type: "title", start: 1, duration: 2.8 }], sounds: [] }),
    ).toEqual({ source: "u", items: [{ start: 1, end: 3.8, kind: "title" }] });
  });

  it("makes a title from a file name", () => {
    expect(pieceInfo("follow").place).toBe("bottom");
  });
});

describe("the Plan Motion Graphics step", () => {
  const words = [
    ...say("Welcome back to the show."),
    ...say("We grew revenue 40 percent in six months.", 3),
    ...say("Consistency beats talent every single time.", 8),
    ...say("Now let us talk about hiring.", 14),
  ];
  const all = setup(
    {},
    { busy: "medium", pieces: ["keyword", "stat", "quote", "transition", "title"] },
  );

  it("asks for the pieces the style uses, as often as it is busy", () => {
    const settings = motionPlanSettings(all, 60, { lookFor: " the numbers " });
    expect(settings).toMatchObject({
      count: 5,
      gap: 12,
      pieces: ["keyword", "stat", "quote", "transition"],
      sounds: true,
      lookFor: "the numbers",
    });
    expect(motionPlanSettings(all, 60, {}, "off").sounds).toBe(false);
  });

  it("keeps only well-formed beats from the answer", () => {
    expect(
      motionPicksFrom({
        beats: [
          { quote: "We grew revenue", piece: "stat", text: "40%", subtitle: "revenue growth" },
          { piece: "keyword", text: "no quote" },
          "not a beat",
        ],
      }),
    ).toEqual([
      {
        quote: "We grew revenue",
        piece: "stat",
        text: "40%",
        subtitle: "revenue growth",
        sound: "",
      },
    ]);
    expect(motionPicksFrom({ moments: [] })).toEqual([]);
  });

  it("places each beat where its quote is said and drops the rest", () => {
    const settings = motionPlanSettings(all, 20, {});
    const { beats, dropped } = motionBeatsFromPicks(
      words,
      [
        { quote: "Now let us talk", piece: "transition", text: "", subtitle: "", sound: "" },
        {
          quote: "We grew revenue 40 percent",
          piece: "stat",
          text: "40%",
          subtitle: "revenue growth",
          sound: "ding",
        },
        {
          quote: "Consistency beats talent every single time.",
          piece: "quote",
          text: "",
          subtitle: "",
          sound: "none",
        },
        { quote: "never said", piece: "keyword", text: "Growth", subtitle: "", sound: "" },
        // Not one of this style's pieces.
        { quote: "Welcome back", piece: "follow", text: "@x", subtitle: "", sound: "" },
        // Says what was not said, which this style does not allow.
        { quote: "Welcome back", piece: "keyword", text: "Hello", subtitle: "", sound: "" },
      ],
      settings,
    );
    expect(dropped).toBe(1);
    expect(beats).toEqual([
      {
        type: "stat",
        start: 3,
        duration: 3,
        title: "40%",
        subtitle: "revenue growth",
        sound: "ding",
      },
      {
        type: "quote",
        start: 8,
        duration: 4.5,
        title: "Consistency beats talent every single time.",
        sound: null,
      },
      { type: "transition", start: 13.65, duration: 0.7 },
    ]);
  });

  it("lets a keyword say what was not said when the style allows it", () => {
    const pick = {
      quote: "Welcome back",
      piece: "keyword",
      text: "Hello",
      subtitle: "",
      sound: "pop",
    };
    const allowed = motionBeatsFromPicks(words, [pick], { pieces: ["keyword"], showsUnsaid: true });
    expect(allowed.beats).toEqual([
      { type: "keyword", start: 0, duration: 1.2, title: "Hello", sound: "pop" },
    ]);
  });

  it("draws the plan's beats in place of the numbers found by rules", () => {
    const plan = planMotionByRules({
      words,
      duration: 20,
      setup: setup({}, { pieces: ["keyword", "stat"], opening: "none", ending: "none" }),
      beats: [{ type: "keyword", start: 8, duration: 1.2, title: "Consistency" }],
    });
    expect(plan.pieces).toEqual([
      { type: "keyword", start: 8, duration: 1.2, title: "Consistency" },
    ]);
  });
});

describe("nothingToDrawNote", () => {
  const setup = {
    ...NO_MOTION_SETUP,
    style: { ...NO_MOTION_SETUP.style, pieces: ["lower_third" as const], ending: "none" as const },
  };

  it("names the missing speaker name when the name card has nothing to show", () => {
    expect(nothingToDrawNote("motion", setup)).toBe(
      "Nothing to draw on the video, so it went on unchanged. Add a speaker name in Settings, under Motion, for the name and follow cards to show.",
    );
  });

  it("says only that the videos went on when nothing is missing", () => {
    expect(nothingToDrawNote("motion", { ...setup, hostName: "Ana" }, 2)).toBe(
      "Nothing to draw on the videos, so they went on unchanged.",
    );
  });

  it("says so plainly for sound effects", () => {
    expect(nothingToDrawNote("sound-effects", setup)).toBe(
      "No sound effect fit the video, so it went on unchanged.",
    );
  });
});
