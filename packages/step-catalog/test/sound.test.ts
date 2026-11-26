import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  composeProblem,
  DUCKING,
  duckedMix,
  type FileFacts,
  getStep,
  micInSync,
  readFacts,
  readSync,
  SEPARATE_MIC_STEP,
  StepSetupError,
  VARIANT_MUSIC_STEP,
} from "../src";

type Option = { option: string; argument?: string | number };
type ComposeRequest = {
  inputs: { file_url: string; options?: Option[] }[];
  filters: { filter: string }[];
  outputs: { options: Option[] }[];
};

const BASE = "https://files.example.com/";
const at = (file: string) => `${BASE}${file}`;

const micFacts = (sync: FileFacts[string] extends infer T ? T : never): FileFacts => ({
  video_url: { duration: 6, hasAudio: true, hasVideo: true },
  mic_url: { duration: 8, hasAudio: true, ...(sync ?? {}) },
});

function buildMic(facts: FileFacts, extra: Record<string, unknown> = {}): ComposeRequest {
  const step = getStep(SEPARATE_MIC_STEP)!;
  const input = step.input.parse({ video_url: at("camera.mp4"), mic_url: at("mic.wav"), ...extra });
  return step.toRequest!(input, facts) as ComposeRequest;
}

describe("Use A Separate Mic Recording", () => {
  it("lines the mic up against the video and leaves the picture alone", () => {
    const step = getStep(SEPARATE_MIC_STEP)!;
    expect(step.readsSync).toEqual({ field: "mic_url", against: "video_url" });
    expect(step.readsFirst).toEqual(["video_url", "mic_url"]);
    const request = buildMic(
      micFacts({ sync: { matched: true, offset: 1.3, drift: 0, confidence: 0.9 } }),
    );
    expect(request.filters[0].filter).toContain("atrim=start=1.3000");
    expect(request.filters[0].filter).toContain("atrim=duration=6[mic]");
    const options = request.outputs[0].options.map((one) => `${one.option} ${one.argument ?? ""}`);
    expect(options).toContain("-c:v copy");
    expect(options).toContain("-map [mic]");
    expect(options).toContain("-t 6");
    expect(composeProblem(request)).toBeNull();
  });

  it("delays a mic that started after the camera, and corrects drift", () => {
    expect(micInSync(-0.5, 0)).toBe(
      "[1:a]aresample=48000,aformat=channel_layouts=stereo,adelay=delays=500:all=1",
    );
    expect(micInSync(2, 0.00005)).toContain("atempo=1.00005000");
    // A drift too small to matter is left alone.
    expect(micInSync(2, 0.0000002)).not.toContain("atempo");
  });

  it("nudges the mic later or earlier by hand", () => {
    const facts = micFacts({ sync: { matched: true, offset: 1.3, drift: 0, confidence: 0.9 } });
    expect(buildMic(facts, { nudge_ms: 100 }).filters[0].filter).toContain("atrim=start=1.2000");
    expect(buildMic(facts, { nudge_ms: -200 }).filters[0].filter).toContain("atrim=start=1.5000");
  });

  it("says plainly when the two cannot be lined up", () => {
    expect(() => buildMic(micFacts({}))).toThrow(StepSetupError);
    expect(() =>
      buildMic(micFacts({ sync: { matched: false, offset: 0, drift: 0, confidence: 0.1 } })),
    ).toThrow(/same take/);
    expect(() =>
      buildMic({ video_url: { duration: 6, hasAudio: false }, mic_url: { hasAudio: true } }),
    ).toThrow(/no sound of its own/);
  });

  it("reads the toolkit's line-up answer, keeping only sound values", () => {
    expect(readSync({ matched: true, offset: 1.25, drift: 0.00004, confidence: 0.8 })).toEqual({
      matched: true,
      offset: 1.25,
      drift: 0.00004,
      confidence: 0.8,
    });
    expect(readSync({ matched: false, offset: null, confidence: 0.1 })).toEqual({
      matched: false,
      offset: 0,
      drift: 0,
      confidence: 0.1,
    });
    // A drift no clock has is a misread.
    expect(readSync({ matched: true, offset: 1, drift: 0.05, confidence: 2 })?.drift).toBe(0);
    expect(readSync({ offset: 1 })).toBeUndefined();
  });

  it("asks the toolkit to line them up before building the request", async () => {
    const asked: { url: string; body: Record<string, unknown> }[] = [];
    const fetch = (async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      asked.push({ url, body });
      const response = url.endsWith("/v1/audio/align")
        ? { matched: true, offset: 0.75, drift: 0, confidence: 0.7 }
        : { duration: 6, has_audio: true, has_video: true };
      return new Response(JSON.stringify({ response }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const step = getStep(SEPARATE_MIC_STEP)!;
    const facts = await readFacts(
      { baseUrl: "https://toolkit.example.com", apiKey: "k" },
      step,
      { video_url: at("camera.mp4"), mic_url: at("mic.wav") },
      { fetch },
    );
    expect(facts.mic_url?.sync?.offset).toBe(0.75);
    const align = asked.find((one) => one.url.endsWith("/v1/audio/align"))!;
    expect(align.body).toEqual({ reference_url: at("camera.mp4"), media_url: at("mic.wav") });
  });
});

describe("music that dips while someone talks", () => {
  it("keys the music off the voice", () => {
    const filters = duckedMix("voice", "music", "out");
    expect(filters[1]).toBe(
      `[music][voice_key]sidechaincompress=threshold=${DUCKING.threshold}:ratio=${DUCKING.ratio}:attack=${DUCKING.attack}:release=${DUCKING.release}[music_ducked]`,
    );
    expect(filters[2]).toContain("[voice_mix][music_ducked]amix");
  });

  it("is the default in Add background music and Music Under Each Variant", () => {
    for (const id of ["recipe-background-music", VARIANT_MUSIC_STEP]) {
      const step = getStep(id)!;
      const input = step.input.parse({ video_url: at("v.mp4"), music_url: at("m.mp3") });
      expect(input.music_under_speech).toBe("dips while someone talks");
      const request = step.toRequest!(input, {
        video_url: { duration: 10, hasAudio: true },
      }) as ComposeRequest;
      expect(request.filters.some((one) => one.filter.includes("sidechaincompress"))).toBe(true);
      expect(composeProblem(request)).toBeNull();
      const level = step.toRequest!(
        step.input.parse({
          video_url: at("v.mp4"),
          music_url: at("m.mp3"),
          music_under_speech: "stays at one level",
        }),
        { video_url: { duration: 10, hasAudio: true } },
      ) as ComposeRequest;
      expect(level.filters.some((one) => one.filter.includes("sidechaincompress"))).toBe(false);
    }
  });
});

const runFile = promisify(execFile);
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

/** Both on a real FFmpeg, built the way the toolkit's compose route builds it. */
describe.skipIf(!hasFfmpeg)("on a real FFmpeg", () => {
  let dir = "";
  const ffmpeg = (args: string[]) =>
    runFile("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { timeout: 120_000 });

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sound-"));
    // A 6 s camera video with a hum for its own sound.
    await ffmpeg([
      ...["-f", "lavfi", "-i", "color=gray:size=320x240:rate=30:duration=6"],
      ...["-f", "lavfi", "-i", "sine=frequency=100:duration=6"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac"],
      path.join(dir, "camera.mp4"),
    ]);
    // Mic recordings: one beep at 2.3 s (the mic started 1.3 s early) and one at 0.5 s
    // (the mic started 0.5 s late). Either way the beep belongs 1 s into the video.
    for (const [name, beep] of [
      ["early.wav", 2.3],
      ["late.wav", 0.5],
    ] as const) {
      await ffmpeg([
        ...["-f", "lavfi", "-i", `aevalsrc='0.8*sin(2*PI*1000*t)*between(t,${beep},${beep + 0.2})':s=48000:d=8`],
        path.join(dir, name),
      ]);
    }
    // A talking voice for 2 s, quiet for 2 s, talking again; and a steady music tone.
    await ffmpeg([
      ...["-f", "lavfi", "-i", "color=gray:size=320x240:rate=30:duration=6"],
      ...["-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*300*t)*(lt(t,2)+gte(t,4))':s=48000:d=6"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac"],
      path.join(dir, "talk.mp4"),
    ]);
    await ffmpeg([
      ...["-f", "lavfi", "-i", "sine=frequency=2000:duration=8:sample_rate=48000"],
      path.join(dir, "music.wav"),
    ]);
  }, 120_000);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  async function run(request: ComposeRequest, name: string): Promise<string> {
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
    const file = path.join(dir, `${name}.mp4`);
    args.push(file);
    await ffmpeg(args);
    return file;
  }

  /** Loudness in dB of one band of a file's sound, between two times. */
  function bandLevel(file: string, from: number, to: number, hz: number): number {
    const out = spawnSync("ffmpeg", [
      ...["-hide_banner", "-ss", String(from), "-t", String(to - from), "-i", file],
      ...["-af", `bandpass=f=${hz}:width_type=q:w=4,volumedetect`, "-f", "null", "-"],
    ]).stderr.toString();
    return Number(/mean_volume: (-?[\d.]+|-inf) dB/.exec(out)?.[1] ?? -91);
  }

  /** The first moment, in seconds, the file's sound is louder than quiet. */
  function firstSound(file: string): number {
    const raw = spawnSync("ffmpeg", [
      ...["-v", "error", "-i", file, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"],
    ]).stdout as Buffer;
    const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    const index = samples.findIndex((value) => Math.abs(value) > 0.2);
    return index / 48000;
  }

  for (const [name, offset] of [
    ["early", 1.3],
    ["late", -0.5],
  ] as const) {
    it(`puts a mic that started ${name} in sync with the picture`, async () => {
      const step = getStep(SEPARATE_MIC_STEP)!;
      const input = step.input.parse({ video_url: at("camera.mp4"), mic_url: at(`${name}.wav`) });
      const file = await run(
        step.toRequest!(input, {
          video_url: { duration: 6, hasAudio: true },
          mic_url: { duration: 8, hasAudio: true, sync: { matched: true, offset, drift: 0, confidence: 0.9 } },
        }) as ComposeRequest,
        `mic-${name}`,
      );
      // The beep lands 1 s in, to within a couple of milliseconds (AAC's own start aside).
      expect(Math.abs(firstSound(file) - 1)).toBeLessThan(0.03);
      // The camera's hum is gone; the video is as long as it was.
      expect(bandLevel(file, 2, 5, 100)).toBeLessThan(-60);
      const length = spawnSync("ffprobe", [
        ...["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      ]).stdout.toString();
      expect(Number(length)).toBeCloseTo(6, 1);
    }, 120_000);
  }

  for (const id of ["recipe-background-music", VARIANT_MUSIC_STEP]) {
    it(`${id}: the music dips while someone talks and comes back in the pause`, async () => {
      const step = getStep(id)!;
      const build = (choice: string) =>
        step.toRequest!(
          step.input.parse({
            video_url: at("talk.mp4"),
            music_url: at("music.wav"),
            music_under_speech: choice,
            // Loud enough that the dip shows above the hiss AAC adds around the voice.
            music_volume: 1,
          }),
          { video_url: { duration: 6, hasAudio: true } },
        ) as ComposeRequest;
      const ducked = await run(build("dips while someone talks"), `${id}-ducked`);
      const level = await run(build("stays at one level"), `${id}-level`);
      const talking = bandLevel(ducked, 0.5, 1.8, 2000);
      const pause = bandLevel(ducked, 2.8, 3.8, 2000);
      // About 10 dB lower under the voice than in the pause...
      expect(pause - talking).toBeGreaterThan(6);
      // ...while at one level it barely changes.
      expect(Math.abs(bandLevel(level, 2.8, 3.8, 2000) - bandLevel(level, 0.5, 1.8, 2000))).toBeLessThan(2);
      // The voice itself is left as loud as it was (the test voice is mono, and spreading
      // it over two channels takes 3 dB off each).
      const voice = bandLevel(path.join(dir, "talk.mp4"), 0.5, 1.8, 300);
      expect(Math.abs(bandLevel(ducked, 0.5, 1.8, 300) - (voice - 3))).toBeLessThan(1);
    }, 120_000);
  }
});
