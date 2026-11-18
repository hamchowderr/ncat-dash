import { execFile, execFileSync, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  allSteps,
  callStep,
  editingRecipes,
  type FileFacts,
  getStep,
  type MediaFacts,
  readMediaFacts,
  type StepDefinition,
  StepSetupError,
  titleFromFileName,
  userInputJsonSchema,
  wrapLines,
} from "../src";

type Option = { option: string; argument?: string | number };
type ComposeRequest = {
  inputs: { file_url: string; options?: Option[] }[];
  filters: { filter: string }[];
  outputs: { options: Option[] }[];
};

const BASE = "https://files.example.com/";
// The test files, made in beforeAll below:
// main.mp4 1920x1080, 3 s, with sound; other.mp4 1280x720, 2 s, with sound;
// quiet.mp4 1280x720, 2 s, no sound; green.mp4 a square in front of pure green, 3 s;
// tall.png, card.png, photo.png, logo.png; voice.mp3 4 s.
const at = (file: string) => `${BASE}${file}`;

// What the toolkit's metadata route reads from each sample, worked out by hand.
const FACTS: Record<string, MediaFacts> = {
  "main.mp4": { duration: 3, width: 1920, height: 1080, fps: 25, hasAudio: true, hasVideo: true },
  "other.mp4": { duration: 2, width: 1280, height: 720, fps: 30, hasAudio: true, hasVideo: true },
  "quiet.mp4": { duration: 2, width: 1280, height: 720, fps: 30, hasAudio: false, hasVideo: true },
  "green.mp4": { duration: 3, width: 1280, height: 720, fps: 25, hasAudio: true, hasVideo: true },
  "voice.mp3": { duration: 4, hasAudio: true, hasVideo: false },
};

const SAMPLE: Record<string, Record<string, unknown>> = {
  "recipe-picture-in-picture": { video_url: at("main.mp4"), other_video_url: at("other.mp4") },
  "recipe-stack": { video_url: at("main.mp4"), other_video_url: at("other.mp4") },
  "recipe-side-by-side": { video_url: at("main.mp4"), other_video_url: at("other.mp4") },
  "recipe-green-screen": { video_url: at("green.mp4"), background_url: at("tall.png") },
  "recipe-quote-card": {
    template_url: at("card.png"),
    text: "Ship it before it's perfect: 100% of the time, you'll learn more",
    attribution: "Somebody wise",
  },
  "recipe-video-card": {
    video_url: at("main.mp4"),
    template_url: at("card.png"),
    text: "Follow for part 2",
  },
  "recipe-title-on-picture": {
    image_url: at("photo.png"),
    file_name: "Episode_12-How we grew.mp4",
    logo_url: at("logo.png"),
  },
  "recipe-frame-choices": { video_url: at("main.mp4") },
  "recipe-fit-to-voiceover": { audio_url: at("voice.mp3"), video_url: at("other.mp4") },
  "recipe-slideshow": {
    image_urls: [{ image_url: at("photo.png") }, { image_url: at("card.png") }],
    audio_url: at("voice.mp3"),
  },
  "recipe-intro-outro": {
    video_url: at("main.mp4"),
    intro_url: at("other.mp4"),
    outro_url: at("quiet.mp4"),
  },
  "recipe-change-format": { media_url: at("main.mp4") },
};

function factsFor(step: StepDefinition, input: Record<string, unknown>): FileFacts {
  const facts: FileFacts = {};
  for (const field of step.readsFirst ?? []) {
    const value = input[field];
    if (typeof value === "string") facts[field] = FACTS[value.slice(BASE.length)];
  }
  return facts;
}

function build(id: string, extra: Record<string, unknown> = {}, facts?: FileFacts) {
  const step = getStep(id)!;
  const input = step.input.parse({ ...SAMPLE[id], ...extra }) as Record<string, unknown>;
  return step.toRequest!(input, facts ?? factsFor(step, input)) as ComposeRequest;
}

describe("editing steps", () => {
  it("are all in the catalog with their own ids", () => {
    expect(editingRecipes.length).toBe(12);
    for (const step of editingRecipes) {
      expect(getStep(step.id)).toBe(step);
      expect(SAMPLE[step.id], step.id).toBeDefined();
    }
    expect(new Set(allSteps.map((step) => step.id)).size).toBe(allSteps.length);
  });

  it.each(editingRecipes.map((step) => [step.id, step] as const))(
    "%s builds a request the toolkit's compose route accepts",
    (id) => {
      const compose = getStep("ffmpeg-compose")!;
      expect(() => compose.input.strict().parse(build(id))).not.toThrow();
    },
  );

  it("takes brand items from Settings and never asks for them", () => {
    const brand = Object.fromEntries(editingRecipes.map((step) => [step.id, step.brandInputs]));
    expect(brand["recipe-quote-card"]).toMatchObject({ template_url: "card", font: "font" });
    expect(brand["recipe-video-card"]).toMatchObject({ template_url: "card" });
    expect(brand["recipe-intro-outro"]).toEqual({ intro_url: "intro", outro_url: "outro" });
    expect(brand["recipe-picture-in-picture"]).toEqual({ border_color: "color" });
    expect(brand["recipe-title-on-picture"]).toMatchObject({
      band_color: "color",
      logo_url: "logo",
    });
  });

  it("names the file the step before fills in as a required setting", () => {
    for (const step of editingRecipes) {
      const filled = step.listInput?.field ?? step.primaryInput;
      if (!filled) continue;
      const schema = userInputJsonSchema(step) as { required?: string[] };
      expect(schema.required, step.id).toContain(filled);
    }
  });

  it("refuses colours that could break out of the filter graph", () => {
    const pip = getStep("recipe-picture-in-picture")!;
    expect(() =>
      pip.input.parse({ ...SAMPLE["recipe-picture-in-picture"], border_color: "red:x=0" }),
    ).toThrow();
  });

  it("mixes only the sound that is there", () => {
    const both = build("recipe-picture-in-picture");
    expect(both.filters.map((item) => item.filter).join(";")).toContain("amix=inputs=2");
    const quiet = build("recipe-picture-in-picture", { other_video_url: at("quiet.mp4") });
    expect(quiet.filters.map((item) => item.filter).join(";")).not.toContain("amix");
    expect(quiet.outputs[0].options).toContainEqual({ option: "-map", argument: "0:a" });
  });

  it("cuts to the length of the video that decides it", () => {
    const main = build("recipe-stack");
    expect(main.outputs[0].options).toContainEqual({ option: "-t", argument: "3" });
    const other = build("recipe-stack", { ends: "with the other video" });
    expect(other.outputs[0].options).toContainEqual({ option: "-t", argument: "2" });
  });

  it("says what it needs when a file could not be read", () => {
    expect(() => build("recipe-frame-choices", {}, {})).toThrow(StepSetupError);
    expect(() => build("recipe-video-card", {}, {})).toThrow(/size could not be read/);
    expect(() =>
      build("recipe-intro-outro", { intro_url: undefined, outro_url: undefined }),
    ).toThrow(/Add an intro or an outro in Settings/);
    expect(() => build("recipe-title-on-picture", { file_name: undefined })).toThrow(
      /no title to write/,
    );
  });

  it("spreads frames evenly through the video", () => {
    const request = build("recipe-frame-choices", { count: 2 });
    const times = request.outputs.map(
      (output) => output.options.find((item) => item.option === "-ss")?.argument,
    );
    expect(times).toEqual(["1", "2"]);
  });

  it("copies the picture and sound when only the file type changes", () => {
    expect(build("recipe-change-format").outputs[0].options).toContainEqual({
      option: "-c",
      argument: "copy",
    });
    const mp3 = build("recipe-change-format", { to: "MP3" }).outputs[0].options;
    expect(mp3).toContainEqual({ option: "-f", argument: "mp3" });
    expect(mp3).toContainEqual({ option: "-vn" });
  });
});

describe("wrapLines and titleFromFileName", () => {
  it("wraps words into lines no longer than asked", () => {
    expect(wrapLines("one two three four five", 9)).toEqual(["one two", "three", "four five"]);
    expect(wrapLines("  spaced   out  ", 20)).toEqual(["spaced out"]);
    expect(wrapLines("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("turns a file name into a title", () => {
    expect(titleFromFileName("Episode_12-How we grew.mp4")).toBe("Episode 12 How we grew");
    expect(titleFromFileName("uploads/team/My   talk.MOV")).toBe("My talk");
  });
});

describe("reading files first", () => {
  it("reads the toolkit's metadata answer", () => {
    expect(
      readMediaFacts({ duration: 12.5, width: 1920, height: 1080, has_audio: false, x: 1 }),
    ).toEqual({ duration: 12.5, width: 1920, height: 1080, hasAudio: false });
    expect(readMediaFacts({})).toBeUndefined();
    expect(readMediaFacts(null)).toBeUndefined();
  });

  it("asks the toolkit about each file before sending the job", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchStub = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      calls.push({ url, body });
      if (url.endsWith("/v1/media/metadata")) {
        const file = String(body.media_url).slice(BASE.length);
        const facts = FACTS[file];
        return Response.json({
          code: 200,
          response: {
            duration: facts.duration,
            width: facts.width,
            height: facts.height,
            has_audio: facts.hasAudio,
          },
        });
      }
      return new Response("{}", { status: 202 });
    }) as unknown as typeof fetch;
    await callStep(
      { baseUrl: "https://toolkit.example.com", apiKey: "k" },
      getStep("recipe-stack")!,
      { ...SAMPLE["recipe-stack"], other_video_url: at("quiet.mp4") },
      { fetch: fetchStub, webhookUrl: "https://hooks.example.com/x", id: "job1" },
    );
    expect(calls.map((call) => call.url.replace("https://toolkit.example.com", ""))).toEqual([
      "/v1/media/metadata",
      "/v1/media/metadata",
      "/v1/ffmpeg/compose",
    ]);
    // Metadata is asked straight away, with no webhook.
    expect(calls[0].body).toEqual({ media_url: at("main.mp4") });
    const sent = calls[2].body as unknown as ComposeRequest;
    expect(sent.outputs[0].options).toContainEqual({ option: "-map", argument: "0:a" });
  });

  it("carries on without a file it could not read", async () => {
    const fetchStub = (async (url: string) =>
      url.endsWith("/v1/media/metadata")
        ? new Response("nope", { status: 500 })
        : new Response("{}", { status: 202 })) as unknown as typeof fetch;
    await expect(
      callStep(
        { baseUrl: "https://toolkit.example.com", apiKey: "k" },
        getStep("recipe-picture-in-picture")!,
        SAMPLE["recipe-picture-in-picture"],
        { fetch: fetchStub },
      ),
    ).resolves.toEqual({});
    await expect(
      callStep(
        { baseUrl: "https://toolkit.example.com", apiKey: "k" },
        getStep("recipe-frame-choices")!,
        SAMPLE["recipe-frame-choices"],
        { fetch: fetchStub },
      ),
    ).rejects.toThrow(StepSetupError);
  });
});

const runFile = promisify(execFile);
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

/**
 * Runs each editing step through a real FFmpeg, building the command the way the
 * toolkit's services/v1/ffmpeg/ffmpeg_compose.py does, and checks what comes out.
 * Skipped where FFmpeg is not installed; CI installs it. Set KEEP_EDITING_OUTPUT to a
 * folder to keep the results for a look.
 */
describe.skipIf(!hasFfmpeg)("editing steps on a real FFmpeg", () => {
  let dir = "";
  // Run without blocking, so the test worker keeps talking to vitest during long renders.
  const ffmpeg = (args: string[]) =>
    runFile("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { timeout: 120_000 });
  const probe = (file: string, entries: string, stream = "v:0") =>
    execFileSync("ffprobe", [
      ...["-v", "error", "-select_streams", stream],
      ...["-show_entries", entries, "-of", "csv=p=0:s=x", file],
    ])
      .toString()
      .trim();
  const size = (file: string) => probe(file, "stream=width,height");
  const length = (file: string) =>
    Number(
      execFileSync("ffprobe", [
        ...["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      ]).toString(),
    );
  const hasSound = (file: string) => probe(file, "stream=codec_type", "a") !== "";

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "editing-"));
    const video = (name: string, source: string, size: string, rate: number, seconds: number) =>
      ffmpeg([
        ...["-f", "lavfi", "-i", `${source}=size=${size}:rate=${rate}:duration=${seconds}`],
        ...["-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`],
        ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac"],
        path.join(dir, name),
      ]);
    await video("main.mp4", "testsrc", "1920x1080", 25, 3);
    await video("other.mp4", "testsrc2", "1280x720", 30, 2);
    await ffmpeg([
      ...["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=2"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-an"],
      path.join(dir, "quiet.mp4"),
    ]);
    await ffmpeg([
      ...["-f", "lavfi", "-i", "color=c=0x00FF00:size=1280x720:rate=25:duration=3"],
      ...["-f", "lavfi", "-i", "testsrc=size=400x500:rate=25:duration=3"],
      ...["-f", "lavfi", "-i", "sine=frequency=300:duration=3"],
      ...["-filter_complex", "[0:v][1:v]overlay=440:220[v]", "-map", "[v]", "-map", "2:a"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac"],
      path.join(dir, "green.mp4"),
    ]);
    const still = (name: string, source: string) =>
      ffmpeg(["-f", "lavfi", "-i", source, "-frames:v", "1", path.join(dir, name)]);
    await still("tall.png", "gradients=size=1080x3000");
    await still("card.png", "color=c=0x1E2A78:size=1080x1350");
    await still("photo.png", "testsrc2=size=1600x900");
    await still("logo.png", "color=c=orange:size=300x120");
    await ffmpeg([
      ...["-f", "lavfi", "-i", "sine=frequency=200:duration=4"],
      path.join(dir, "voice.mp3"),
    ]);
  }, 120_000);

  afterAll(() => {
    const keep = process.env.KEEP_EDITING_OUTPUT;
    if (keep && dir) {
      fs.mkdirSync(keep, { recursive: true });
      for (const file of fs.readdirSync(dir))
        fs.copyFileSync(path.join(dir, file), path.join(keep, file));
    }
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  const EXTENSION: Record<string, string> = {
    image2: "png",
    mp3: "mp3",
    wav: "wav",
    webm: "webm",
    mov: "mov",
  };

  /** The same command the toolkit builds from a compose request; returns every output. */
  async function run(request: ComposeRequest, name: string): Promise<string[]> {
    const args: string[] = [];
    for (const input of request.inputs) {
      for (const item of input.options ?? []) {
        args.push(item.option);
        if (item.argument !== undefined) args.push(String(item.argument));
      }
      args.push("-i", path.join(dir, input.file_url.slice(BASE.length)));
    }
    if (request.filters.length > 0) {
      args.push("-filter_complex", request.filters.map((item) => item.filter).join(";"));
    }
    const outputs = request.outputs.map((output, index) => {
      for (const item of output.options) {
        args.push(item.option);
        if (item.argument !== undefined) args.push(String(item.argument));
      }
      const format = String(output.options.find((item) => item.option === "-f")?.argument);
      const file = path.join(
        dir,
        `${name}${index ? `-${index}` : ""}.${EXTENSION[format] ?? "mp4"}`,
      );
      args.push(file);
      return file;
    });
    await ffmpeg(args);
    return outputs;
  }

  it.each(editingRecipes.map((step) => [step.id] as const))(
    "%s runs and makes something",
    async (id) => {
      for (const file of await run(build(id), id)) {
        expect(fs.statSync(file).size, file).toBeGreaterThan(500);
      }
    },
    120_000,
  );

  it("makes a picture in picture the main video's size and length", async () => {
    const [file] = await run(build("recipe-picture-in-picture"), "pip-check");
    expect(size(file)).toBe("1920x1080");
    expect(length(file)).toBeCloseTo(3, 0);
    const [longer] = await run(
      build("recipe-picture-in-picture", { ends: "with the other video", corner: "top left" }),
      "pip-other",
    );
    expect(length(longer)).toBeCloseTo(2, 0);
  }, 120_000);

  it("stacks into a vertical video and puts two side by side into a wide one", async () => {
    const [stack] = await run(build("recipe-stack", { top_share: 60 }), "stack-check");
    expect(size(stack)).toBe("1080x1920");
    expect(length(stack)).toBeCloseTo(3, 0);
    const [side] = await run(build("recipe-side-by-side", { divider: 0 }), "side-check");
    expect(size(side)).toBe("1920x1080");
    const [quiet] = await run(
      build("recipe-side-by-side", { other_video_url: at("quiet.mp4"), sound: "other video only" }),
      "side-quiet",
    );
    expect(hasSound(quiet)).toBe(false);
  }, 120_000);

  it("takes the green out from behind the person", async () => {
    const [file] = await run(build("recipe-green-screen"), "green-check");
    // A corner of the frame was pure green; now it shows the background instead.
    const corner = execFileSync("ffmpeg", [
      ...["-hide_banner", "-loglevel", "error", "-ss", "1", "-i", file],
      ...[
        "-vf",
        "crop=10:10:20:20,scale=1:1",
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ],
    ]);
    const [red, green, blue] = [...corner];
    expect(green > 200 && red < 60 && blue < 60).toBe(false);
    expect(size(file)).toBe("1280x720");
    const [scrolled] = await run(
      build("recipe-green-screen", { scroll: true, speaker_size: "small" }),
      "green-scroll",
    );
    expect(length(scrolled)).toBeCloseTo(3, 0);
  }, 120_000);

  it("makes cards the template's size and adds them to a video", async () => {
    const [card] = await run(build("recipe-quote-card"), "quote-check");
    expect(size(card)).toBe("1080x1350");
    const [end] = await run(build("recipe-video-card", { card_seconds: 2 }), "end-card-check");
    expect(size(end)).toBe("1920x1080");
    expect(length(end)).toBeCloseTo(5, 0);
    expect(hasSound(end)).toBe(true);
    const [start] = await run(build("recipe-video-card", { place: "at the start" }), "start-card");
    expect(length(start)).toBeCloseTo(6, 0);
  }, 120_000);

  it("writes a title on a picture at the picture's size", async () => {
    const [file] = await run(build("recipe-title-on-picture", { place: "top" }), "title-check");
    expect(size(file)).toBe("1600x900");
    const [plain] = await run(
      build("recipe-title-on-picture", { logo_url: undefined, title: "Typed title" }),
      "title-plain",
    );
    expect(size(plain)).toBe("1600x900");
  }, 120_000);

  it("saves as many frames as asked", async () => {
    const files = await run(build("recipe-frame-choices", { count: 3 }), "frames-check");
    expect(files).toHaveLength(3);
    for (const file of files) expect(size(file)).toBe("1920x1080");
  }, 120_000);

  it("fits a video to the voice-over's length every way", async () => {
    for (const fit of ["loop it", "hold the last frame", "change its speed"]) {
      const [file] = await run(
        build("recipe-fit-to-voiceover", { fit }),
        `fit-${fit.replace(/ /g, "-")}`,
      );
      expect(length(file), fit).toBeCloseTo(4, 0);
    }
  }, 120_000);

  it("shows each picture for a share of the sound", async () => {
    const [file] = await run(build("recipe-slideshow", { shape: "square" }), "slides-check");
    expect(size(file)).toBe("1080x1080");
    expect(length(file)).toBeCloseTo(4, 0);
  }, 120_000);

  it("plays the intro and outro around the video at its size, sound or not", async () => {
    const [file] = await run(build("recipe-intro-outro"), "intro-check");
    expect(size(file)).toBe("1920x1080");
    expect(length(file)).toBeCloseTo(7, 0);
    expect(hasSound(file)).toBe(true);
    const [outroOnly] = await run(
      build("recipe-intro-outro", { intro_url: undefined }),
      "outro-only",
    );
    expect(length(outroOnly)).toBeCloseTo(5, 0);
  }, 120_000);

  it("changes the file type", async () => {
    for (const to of ["MOV", "WebM", "MP3", "WAV"]) {
      const [file] = await run(build("recipe-change-format", { to }), `format-${to}`);
      expect(fs.statSync(file).size, to).toBeGreaterThan(500);
    }
  }, 120_000);
});
