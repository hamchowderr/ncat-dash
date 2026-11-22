import { execFile, execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BEAT_CUT_STEP,
  type Beats,
  beatCuts,
  beatGrid,
  beatRecipes,
  callStep,
  type FileFacts,
  getStep,
  isPicture,
  readBeats,
  readCuts,
  readFacts,
  SPLIT_SHOTS_STEP,
  shotPieces,
  StepSetupError,
} from "../src";

type Option = { option: string; argument?: string | number };
type ComposeRequest = {
  inputs: { file_url: string; options?: Option[] }[];
  filters: { filter: string }[];
  outputs: { options: Option[] }[];
};

const BASE = "https://files.example.com/";
const at = (file: string) => `${BASE}${file}`;

/** A song at 120 beats a minute: a beat every half second from 0.25 s, a bar every 2 s. */
function song(length = 20, start = 0.25, beat = 0.5): Beats {
  const beats: number[] = [];
  for (let time = start; time < length - 0.1; time += beat)
    beats.push(Math.round(time * 1000) / 1000);
  return {
    tempo: 60 / beat,
    steadiness: 0.9,
    beats,
    downbeats: beats.filter((_, i) => i % 4 === 0),
  };
}

const SONG: FileFacts = { music_url: { duration: 20, hasAudio: true, beats: song() } };

function build(extra: Record<string, unknown> = {}, facts: FileFacts = SONG) {
  const step = getStep(BEAT_CUT_STEP)!;
  const input = step.input.parse({
    video_urls: [
      { video_url: at("red.mp4") },
      { video_url: at("green.mp4") },
      { video_url: at("blue.png") },
    ],
    music_url: at("song.wav"),
    ...extra,
  });
  return step.toRequest!(input, facts) as ComposeRequest;
}

describe("Cut To The Beat", () => {
  it("is in the catalog, reads the music's beats, and builds what compose accepts", () => {
    const step = getStep(BEAT_CUT_STEP)!;
    expect(beatRecipes).toContain(step);
    expect(step.readsFirst).toEqual(["music_url"]);
    expect(step.readsBeats).toEqual(["music_url"]);
    expect(step.brandInputs).toEqual({ music_url: "music" });
    expect(step.listInput).toEqual({ field: "video_urls", itemKey: "video_url" });
    expect(() => getStep("ffmpeg-compose")!.input.strict().parse(build())).not.toThrow();
  });

  it("changes the picture every two beats from the first bar by default", () => {
    expect(beatGrid(song(), "every 2 beats").slice(0, 4)).toEqual([0.25, 1.25, 2.25, 3.25]);
    expect(beatGrid(song(), "every beat").slice(0, 3)).toEqual([0.25, 0.75, 1.25]);
    expect(beatGrid(song(), "every bar").slice(0, 3)).toEqual([0.25, 2.25, 4.25]);
    expect(beatGrid(song(), "every 2 bars").slice(0, 3)).toEqual([0.25, 4.25, 8.25]);
  });

  it("starts on a bar, not on an upbeat, when two beats at a time", () => {
    // The music starts on an upbeat: the first bar is the third beat.
    const found = { ...song(), downbeats: song().beats.filter((_, i) => i % 4 === 2) };
    expect(beatGrid(found, "every 2 beats")[0]).toBe(1.25);
  });

  it("skips to the first beat after the start that is set", () => {
    expect(beatGrid(song(), "every bar", 5)[0]).toBe(6.25);
    expect(beatGrid(song(), "every beat", 5)[0]).toBe(5.25);
  });

  it("counts bars as every fourth beat when none were found", () => {
    expect(beatGrid({ ...song(), downbeats: [] }, "every bar").slice(0, 2)).toEqual([0.25, 2.25]);
  });

  it("cuts in whole frames from the song's start so the cuts never drift", () => {
    // 0.4 s beats at 30 frames a second: 12 frames each, but 0.41 s rounds unevenly.
    const grid = Array.from({ length: 40 }, (_, i) => 1 + i * 0.41);
    const cuts = beatCuts({ grid, songLength: 30, length: 10 });
    expect(cuts.start).toBe(1);
    let frame = 0;
    for (const [index, piece] of cuts.pieces.entries()) {
      frame += piece;
      // Every cut is within half a frame of its beat, however many come before it.
      expect(Math.abs(frame / 30 - (index + 1) * 0.41)).toBeLessThanOrEqual(0.5 / 30 + 1e-9);
    }
    expect(cuts.frames / 30).toBeLessThanOrEqual(10);
  });

  it("ends on the last cut within the length and before the song ends", () => {
    expect(
      beatCuts({ grid: beatGrid(song(), "every 2 beats"), songLength: 20, length: 30 }).frames,
    ).toBe(19 * 30);
    expect(
      beatCuts({ grid: beatGrid(song(), "every bar"), songLength: 20, length: 7 }).frames,
    ).toBe(6 * 30);
  });

  it("takes the clips in turn, each carrying on where it left off", () => {
    const request = build({ length: 6 });
    const trims = request.filters
      .map((item) => item.filter)
      .filter((f) => f.includes("trim=start_frame"));
    expect(trims).toEqual([
      "[c0x0]trim=start_frame=0:end_frame=30,setpts=PTS-STARTPTS[p0]",
      "[c1x0]trim=start_frame=0:end_frame=30,setpts=PTS-STARTPTS[p1]",
      "[c2x0]trim=start_frame=0:end_frame=30,setpts=PTS-STARTPTS[p2]",
      "[c0x1]trim=start_frame=30:end_frame=60,setpts=PTS-STARTPTS[p3]",
      "[c1x1]trim=start_frame=30:end_frame=60,setpts=PTS-STARTPTS[p4]",
      "[c2x1]trim=start_frame=30:end_frame=60,setpts=PTS-STARTPTS[p5]",
    ]);
  });

  it("loops clips and holds pictures, and starts the music on the first cut", () => {
    const request = build({ length: 6 });
    expect(request.inputs.map((input) => input.options)).toEqual([
      [{ option: "-stream_loop", argument: -1 }],
      [{ option: "-stream_loop", argument: -1 }],
      [
        { option: "-loop", argument: 1 },
        { option: "-framerate", argument: 30 },
      ],
      undefined,
    ]);
    const sound = request.filters.at(-1)!.filter;
    expect(sound).toContain("[3:a]atrim=start=0.25:duration=6,");
    expect(sound).toContain("afade=t=out:st=5.4:d=0.6");
    expect(request.outputs[0].options).toContainEqual({ option: "-t", argument: "6" });
    // Without a set rate the toolkit's FFmpeg 7 writes 25 frames a second, off the cuts.
    expect(request.outputs[0].options).toContainEqual({ option: "-r", argument: 30 });
  });

  it("fills the chosen shape", () => {
    expect(build({ shape: "wide" }).filters[0].filter).toContain(
      "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080",
    );
  });

  it("tells a picture from a video by its file ending", () => {
    expect(isPicture("https://x.example/a/photo.JPG?sig=1")).toBe(true);
    expect(isPicture("https://x.example/a/still.webp")).toBe(true);
    expect(isPicture("https://x.example/a/clip.mp4")).toBe(false);
  });

  it("says plainly when the beat could not be read or is not steady", () => {
    expect(() => build({}, { music_url: { duration: 20 } })).toThrow(StepSetupError);
    expect(() => build({}, { music_url: { duration: 20 } })).toThrow(/Update your toolkit/);
    expect(() =>
      build({}, { music_url: { duration: 20, beats: { ...song(), steadiness: 0.2 } } }),
    ).toThrow(/no steady beat/);
    expect(() => build({ start_at: 30 })).toThrow(/Start earlier/);
    expect(() => build({ cut_every: "every 2 bars", length: 3 })).toThrow(/before the second cut/);
  });
});

describe("reading the beat from the toolkit", () => {
  it("reads the toolkit's answer, dropping bad times", () => {
    expect(
      readBeats({ tempo: 120, steadiness: 0.8, beats: [1, 0.5, "x", -1], downbeats: [0.5] }),
    ).toEqual({ tempo: 120, steadiness: 0.8, beats: [0.5, 1], downbeats: [0.5] });
    expect(readBeats({ tempo: null, beats: [] })).toBeUndefined();
    expect(readBeats(null)).toBeUndefined();
  });

  it("asks for the beats after the length, only for steps that cut on them", async () => {
    const asked: { path: string; body: unknown }[] = [];
    const fetch = (async (address: string, init: RequestInit) => {
      const where = new URL(address).pathname;
      asked.push({ path: where, body: JSON.parse(String(init.body)) });
      const response =
        where === "/v1/media/metadata"
          ? { duration: 20, has_audio: true, has_video: false }
          : where === "/v1/audio/beats"
            ? { tempo: 120, steadiness: 0.9, beats: song().beats, downbeats: song().downbeats }
            : { outputs: [{ file_url: "https://files.example.com/out.mp4" }] };
      return new Response(JSON.stringify({ code: 200, response }));
    }) as typeof globalThis.fetch;
    const connection = { baseUrl: "https://toolkit.example.com", apiKey: "k" };
    const step = getStep(BEAT_CUT_STEP)!;
    const facts = await readFacts(connection, step, { music_url: at("song.wav") }, { fetch });
    expect(asked.map((one) => one.path)).toEqual(["/v1/media/metadata", "/v1/audio/beats"]);
    expect(asked[1].body).toEqual({ media_url: at("song.wav") });
    expect(facts.music_url?.beats?.tempo).toBe(120);

    // The whole call: metadata, beats, then the compose request cut on them.
    asked.length = 0;
    await callStep(
      connection,
      step,
      { video_urls: [{ video_url: at("red.mp4") }], music_url: at("song.wav"), length: 6 },
      { fetch },
    );
    expect(asked.map((one) => one.path)).toEqual([
      "/v1/media/metadata",
      "/v1/audio/beats",
      "/v1/ffmpeg/compose",
    ]);

    asked.length = 0;
    await readFacts(
      connection,
      getStep("recipe-slideshow")!,
      { audio_url: at("song.wav") },
      { fetch },
    );
    expect(asked.map((one) => one.path)).toEqual(["/v1/media/metadata"]);
  });

  it("leaves the beat out when the toolkit has no beat finder yet", async () => {
    const fetch = (async (address: string) =>
      address.endsWith("/v1/audio/beats")
        ? new Response("Not found", { status: 404 })
        : new Response(
            JSON.stringify({ response: { duration: 20, has_audio: true } }),
          )) as typeof globalThis.fetch;
    const facts = await readFacts(
      { baseUrl: "https://toolkit.example.com", apiKey: "k" },
      getStep(BEAT_CUT_STEP)!,
      { music_url: at("song.wav") },
      { fetch },
    );
    expect(facts.music_url).toEqual({ duration: 20, hasAudio: true });
  });

  it("is a step of its own too, matching the toolkit's request", () => {
    const step = getStep("audio-beats")!;
    expect(step.endpoint).toBe("/v1/audio/beats");
    expect(step.output).toBe("json");
    expect(() => step.input.parse({ media_url: at("song.wav"), beats_per_bar: 3 })).not.toThrow();
    expect(() => step.input.parse({ media_url: at("song.wav"), beats_per_bar: 5 })).toThrow();
  });
});

describe("Split Into Shots", () => {
  const pieces = (cuts: number[], length = 12, extra = {}) =>
    shotPieces({ cuts, length, shortest: 1, longest: 4, most: 30, ...extra }).map((shot) => [
      Math.round(shot.from * 100) / 100,
      Math.round(shot.to * 100) / 100,
    ]);

  it("cuts where the camera cuts", () => {
    expect(pieces([3, 5.5, 9])).toEqual([
      [0, 3],
      [3, 5.5],
      [5.5, 9],
      [9, 12],
    ]);
  });

  it("joins a short shot to the next one, and a short last shot to the one before", () => {
    expect(pieces([3, 3.4, 8, 11.6], 12, { longest: 10 })).toEqual([
      [0, 3],
      [3, 8],
      [8, 12],
    ]);
  });

  it("splits long shots evenly, so a video with no cuts is split evenly", () => {
    expect(pieces([], 10)).toEqual([
      [0, 3.33],
      [3.33, 6.67],
      [6.67, 10],
    ]);
    expect(pieces([2], 10)).toEqual([
      [0, 2],
      [2, 6],
      [6, 10],
    ]);
  });

  it("keeps the first pieces when asked to", () => {
    expect(pieces([2, 4, 6, 8, 10], 12, { most: 2, keep: "from the start" })).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  it("keeps pieces spread through the whole video unless told otherwise", () => {
    // Twelve one-second shots, four kept: one from each quarter of the video, in order.
    const cuts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    expect(pieces(cuts, 12, { most: 4 })).toEqual([
      [1, 2],
      [4, 5],
      [7, 8],
      [10, 11],
    ]);
  });

  it("can keep the longest shots instead, still in the video's order", () => {
    expect(pieces([1, 4, 5, 8.5, 10], 12, { most: 3, keep: "the longest shots" })).toEqual([
      [1, 4],
      [5, 8.5],
      [10, 12],
    ]);
  });

  it("ignores cuts at the very start or end, and repeated ones", () => {
    expect(pieces([0, 0.02, 4, 4, 12], 12)).toEqual([
      [0, 4],
      [4, 8],
      [8, 12],
    ]);
  });

  function split(extra: Record<string, unknown> = {}, facts?: FileFacts) {
    const step = getStep(SPLIT_SHOTS_STEP)!;
    const input = step.input.parse({ video_url: at("talk.mp4"), ...extra });
    return step.toRequest!(
      input,
      facts ?? { video_url: { duration: 12, hasVideo: true, cuts: [3, 5.5, 9] } },
    ) as ComposeRequest;
  }

  it("makes one file per shot, cut from the video's own picture and sound", () => {
    const request = split();
    expect(request.inputs).toEqual([{ file_url: at("talk.mp4") }]);
    expect(request.outputs).toHaveLength(4);
    const times = request.outputs.map((output) =>
      output.options.filter((o) => o.option === "-ss" || o.option === "-to").map((o) => o.argument),
    );
    expect(times).toEqual([
      ["0", "3"],
      ["3", "5.5"],
      ["5.5", "9"],
      ["9", "12"],
    ]);
    expect(request.outputs[0].options).toContainEqual({ option: "-map", argument: "0:a:0?" });
    const step = getStep(SPLIT_SHOTS_STEP)!;
    expect(step.outputLabels?.(step.input.parse({ video_url: at("talk.mp4") }), 2)).toEqual([
      "shot01",
      "shot02",
    ]);
  });

  it("says so when the video's length cannot be read", () => {
    expect(() => split({}, {})).toThrow(StepSetupError);
  });

  it("is a ready-made that starts from one video", () => {
    const step = getStep(SPLIT_SHOTS_STEP)!;
    expect(beatRecipes).toContain(step);
    expect(step.primaryInput).toBe("video_url");
    expect(step.readsCuts).toEqual(["video_url"]);
    expect(step.title).toBe("Split Into Shots");
  });

  it("reads the toolkit's camera cuts in order, bad times dropped", () => {
    expect(readCuts({ media: { cuts: [5, "x", 2.5, -1, Number.NaN] } })).toEqual([2.5, 5]);
    expect(readCuts({ media: {} })).toBeUndefined();
    expect(readCuts(null)).toBeUndefined();
  });

  it("asks the toolkit for the camera cuts after the length, only for steps that split on them", async () => {
    const asked: { path: string; body: unknown }[] = [];
    const fetch = (async (address: string, init: RequestInit) => {
      const where = new URL(address).pathname;
      asked.push({ path: where, body: JSON.parse(String(init.body)) });
      const response =
        where === "/v1/media/metadata"
          ? { duration: 12, has_audio: true, has_video: true }
          : where === "/v1/media/look"
            ? { media: { cuts: [9, 3] } }
            : { outputs: [{ file_url: "https://files.example.com/out.mp4" }] };
      return new Response(JSON.stringify({ code: 200, response }));
    }) as typeof globalThis.fetch;
    const connection = { baseUrl: "https://toolkit.example.com", apiKey: "k" };
    const step = getStep(SPLIT_SHOTS_STEP)!;
    const facts = await readFacts(connection, step, { video_url: at("talk.mp4") }, { fetch });
    expect(asked.map((one) => one.path)).toEqual(["/v1/media/metadata", "/v1/media/look"]);
    expect(asked[1].body).toEqual({ media_url: at("talk.mp4"), cuts: true, frames: false });
    expect(facts.video_url?.cuts).toEqual([3, 9]);

    asked.length = 0;
    await readFacts(
      connection,
      getStep("recipe-frame-choices")!,
      { video_url: at("talk.mp4") },
      {
        fetch,
      },
    );
    expect(asked.map((one) => one.path)).toEqual(["/v1/media/metadata"]);
  });

  it("splits evenly when the toolkit cannot find cuts", async () => {
    const fetch = (async (address: string) =>
      address.endsWith("/v1/media/look")
        ? new Response("Not found", { status: 404 })
        : new Response(
            JSON.stringify({ response: { duration: 8, has_video: true } }),
          )) as typeof globalThis.fetch;
    const step = getStep(SPLIT_SHOTS_STEP)!;
    const facts = await readFacts(
      { baseUrl: "https://toolkit.example.com", apiKey: "k" },
      step,
      { video_url: at("talk.mp4") },
      { fetch },
    );
    expect(facts.video_url?.cuts).toBeUndefined();
    expect(split({}, facts).outputs).toHaveLength(2);
  });
});

const runFile = promisify(execFile);
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

/** Cut To The Beat on a real FFmpeg, built the way the toolkit's compose route builds it. */
describe.skipIf(!hasFfmpeg)("Cut To The Beat on a real FFmpeg", () => {
  let dir = "";
  const ffmpeg = (args: string[]) =>
    runFile("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { timeout: 180_000 });

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "beats-"));
    // Clips of one colour each, shorter than they are needed, so they must loop.
    for (const [name, colour] of [
      ["red.mp4", "red"],
      ["green.mp4", "green"],
    ]) {
      await ffmpeg([
        ...["-f", "lavfi", "-i", `color=${colour}:size=640x360:rate=25:duration=1.5`],
        ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"],
        path.join(dir, name),
      ]);
    }
    await ffmpeg([
      ...["-f", "lavfi", "-i", "color=blue:size=400x400", "-frames:v", "1"],
      path.join(dir, "blue.png"),
    ]);
    // A kick every half second from 0.25 s.
    await ffmpeg([
      ...[
        "-f",
        "lavfi",
        "-i",
        "aevalsrc='0.8*sin(2*PI*60*t)*exp(-30*mod(t+0.25,0.5))':s=44100:d=20",
      ],
      path.join(dir, "song.wav"),
    ]);
  }, 120_000);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  async function run(request: ComposeRequest): Promise<string> {
    const args: string[] = [];
    for (const input of request.inputs) {
      for (const item of input.options ?? []) {
        args.push(item.option);
        if (item.argument !== undefined) args.push(String(item.argument));
      }
      args.push("-i", path.join(dir, input.file_url.slice(BASE.length)));
    }
    args.push("-filter_complex", request.filters.map((item) => item.filter).join(";"));
    for (const item of request.outputs[0].options) {
      args.push(item.option);
      if (item.argument !== undefined) args.push(String(item.argument));
    }
    const file = path.join(dir, "beat-cut.mp4");
    args.push(file);
    await ffmpeg(args);
    return file;
  }

  /** The colour of the frame at each half second, by its average red, green and blue. */
  function colourAt(file: string, time: number): string {
    const raw = execFileSync("ffmpeg", [
      ...["-v", "error", "-ss", String(time), "-i", file, "-frames:v", "1"],
      ...["-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    ]);
    const [r, g, b] = [...raw];
    return r > 150 && g < 100
      ? "red"
      : g > 100 && r < 100 && b < 100
        ? "green"
        : b > 150
          ? "blue"
          : "?";
  }

  it("changes the picture on every second beat, clips in turn and the picture held", async () => {
    const step = getStep(BEAT_CUT_STEP)!;
    const input = step.input.parse({
      video_urls: [
        { video_url: at("red.mp4") },
        { video_url: at("green.mp4") },
        { video_url: at("blue.png") },
      ],
      music_url: at("song.wav"),
      length: 8,
      shape: "square",
    });
    const file = await run(step.toRequest!(input, SONG) as ComposeRequest);
    const facts = execFileSync("ffprobe", [
      ...["-v", "error", "-show_entries", "stream=codec_type,width,height,duration"],
      ...["-of", "json", file],
    ]).toString();
    const streams = JSON.parse(facts).streams as Record<string, string | number>[];
    const video = streams.find((s) => s.codec_type === "video")!;
    expect([video.width, video.height]).toEqual([1080, 1080]);
    expect(Number(video.duration)).toBeCloseTo(8, 1);
    expect(Number(streams.find((s) => s.codec_type === "audio")!.duration)).toBeCloseTo(8, 1);
    // A second per piece: red, green, blue, then red again from where it left off (looped).
    const seen = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5].map((time) => colourAt(file, time));
    expect(seen).toEqual(["red", "green", "blue", "red", "green", "blue", "red", "green"]);
    // The cuts are on the beat: just before and after each whole second the colour changes.
    for (const cut of [1, 2, 3]) {
      expect(colourAt(file, cut - 0.05)).not.toBe(colourAt(file, cut + 0.05));
    }
  }, 120_000);

  it("splits a video into its shots on the exact frame of each camera cut", async () => {
    // Red for 2 s, green for 3 s, blue for 2 s: cuts at 2 and 5.
    const shots = path.join(dir, "shots.mp4");
    await ffmpeg([
      ...["-f", "lavfi", "-i", "color=red:size=320x240:rate=30:duration=2"],
      ...["-f", "lavfi", "-i", "color=green:size=320x240:rate=30:duration=3"],
      ...["-f", "lavfi", "-i", "color=blue:size=320x240:rate=30:duration=2"],
      ...["-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"],
      shots,
    ]);
    const step = getStep(SPLIT_SHOTS_STEP)!;
    const request = step.toRequest!(step.input.parse({ video_url: at("shots.mp4") }), {
      video_url: { duration: 7, hasVideo: true, cuts: [2, 5] },
    }) as ComposeRequest;
    const args = ["-i", shots];
    const files = request.outputs.map((output, index) => {
      for (const item of output.options) {
        args.push(item.option);
        if (item.argument !== undefined) args.push(String(item.argument));
      }
      const file = path.join(dir, `shot${index}.mp4`);
      args.push(file);
      return file;
    });
    await ffmpeg(args);
    const length = (file: string) =>
      Number(
        execFileSync("ffprobe", [
          ...["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
        ]).toString(),
      );
    expect(files.map(length).map((n) => Math.round(n * 10) / 10)).toEqual([2, 3, 2]);
    // Each shot is one colour from its first frame to its last.
    expect(files.map((file) => [colourAt(file, 0), colourAt(file, length(file) - 0.05)])).toEqual([
      ["red", "red"],
      ["green", "green"],
      ["blue", "blue"],
    ]);
  }, 120_000);
});
