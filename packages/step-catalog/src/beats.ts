import { z } from "zod";
import { type Beats, type StepDefinition, StepSetupError } from "./define";
import { composeParts } from "./editing";

/**
 * Beat sync: clips and pictures cut together so every cut lands on a beat of the music.
 * The toolkit finds the beats (/v1/audio/beats, plain sound analysis, no AI) just before
 * the request is built (`readsBeats`), then one FFmpeg request through /v1/ffmpeg/compose
 * cuts the pieces to whole frames counted from the song's start, so the cuts never drift
 * off the beat however long the video runs.
 */

const { opt, VIDEO_OUT, url, number, whole, choice, seconds, editStep, SHAPES, SHAPE_NAMES } =
  composeParts;

export const BEAT_CUT_STEP = "recipe-beat-cut";
export const SPLIT_SHOTS_STEP = "recipe-split-shots";

/** How often the picture changes, from every beat to every two bars. */
export const CUT_EVERY = ["every beat", "every 2 beats", "every bar", "every 2 bars"] as const;
export type CutEvery = (typeof CUT_EVERY)[number];

/** Below this the sound does not keep a beat (speech, free-time music), so cuts would wander. */
export const STEADY_ENOUGH = 0.25;

/** Frame rate of the finished video. */
const RATE = 30;

const PICTURE = /\.(jpe?g|png|webp|bmp|tiff?)(\?|#|$)/i;

/** Whether a link is to a still picture rather than a video, from its file ending. */
export function isPicture(link: string): boolean {
  return PICTURE.test(link);
}

/**
 * The times the picture changes at, from the first one at or after `from` seconds.
 * Every two beats and the bars start on a bar, so cuts fall on the strong beats. Without
 * bar starts, every fourth beat counts as one.
 */
export function beatGrid(found: Beats, every: CutEvery, from = 0): number[] {
  const after = (list: number[]) => list.filter((time) => time >= from - 0.001);
  const beats = after(found.beats);
  let bars = after(found.downbeats);
  if (bars.length < 2) bars = beats.filter((_, index) => index % 4 === 0);
  const everyOther = (list: number[]) => list.filter((_, index) => index % 2 === 0);
  switch (every) {
    case "every beat":
      return beats;
    case "every 2 beats": {
      const first = bars.length > 0 ? beats.findIndex((time) => time >= bars[0] - 0.001) : 0;
      return everyOther(beats.slice(Math.max(0, first)));
    }
    case "every bar":
      return bars;
    case "every 2 bars":
      return everyOther(bars);
  }
}

/** The order clips take turns in: as listed, or mixed up so neighbours in the list never follow each other. */
export const CLIP_ORDER = ["as they come", "mixed up"] as const;
export type ClipOrder = (typeof CLIP_ORDER)[number];

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * The clips' positions in a mixed-up order that is the same every time: stepping through the
 * list by about 0.62 of its length (the golden ratio), so two clips that follow each other are
 * always far apart in the list. Shots split from one long shot sit next to each other in the
 * list, and played as they come they look like one shot running on with no cut.
 */
export function mixedOrder(count: number): number[] {
  // Too few to keep every pair apart; six has no stride that does, so it is set out by hand.
  if (count <= 4) return [0, 2, 1, 3].filter((index) => index < count);
  if (count === 6) return [0, 2, 4, 1, 5, 3];
  const aim = count / 1.618034;
  // The nearest stride to the aim that visits every clip and never steps to a neighbour.
  const stride = Array.from({ length: count }, (_, index) => index)
    .filter((step) => step >= 2 && step <= count - 2 && gcd(step, count) === 1)
    .sort((a, b) => Math.abs(a - aim) - Math.abs(b - aim) || a - b)[0];
  return Array.from({ length: count }, (_, index) => (index * stride) % count);
}

export interface BeatCuts {
  /** Where in the song the video starts, in seconds: the first cut. */
  start: number;
  /** How many frames each piece shows, in order. */
  pieces: number[];
  /** The whole video's length in frames. */
  frames: number;
}

/**
 * The pieces between cuts, as whole frames counted from the song's start so rounding never
 * adds up: the video starts on the first cut and ends on the last one within `length`
 * seconds and before the song ends.
 */
export function beatCuts(args: {
  grid: number[];
  songLength: number;
  length: number;
  rate?: number;
}): BeatCuts {
  const rate = args.rate ?? RATE;
  const start = args.grid[0];
  if (start === undefined) {
    throw new StepSetupError(
      "No beat was found after the start you set. Start earlier in the song.",
    );
  }
  const last = Math.min(start + args.length, args.songLength) + 0.001;
  const points = args.grid.filter((time) => time <= last);
  const frames = points.map((time) => Math.round((time - start) * rate));
  const pieces = frames
    .slice(1)
    .map((frame, index) => frame - frames[index])
    .filter((n) => n > 0);
  if (pieces.length === 0) {
    throw new StepSetupError(
      "The video would end before the second cut. Make it longer, or cut more often.",
    );
  }
  return { start, pieces, frames: pieces.reduce((sum, n) => sum + n, 0) };
}

/** A piece of a video, from and to in seconds. */
export interface Shot {
  from: number;
  to: number;
}

/** Which pieces are kept when there are more than wanted. */
export const KEEP_SHOTS = [
  "spread through the video",
  "the longest shots",
  "from the start",
] as const;
export type KeepShots = (typeof KEEP_SHOTS)[number];

/** `count` of `shots`, picked the `keep` way, back in the order they come in the video. */
export function keepShots(shots: Shot[], count: number, keep: KeepShots): Shot[] {
  if (shots.length <= count) return shots;
  if (keep === "from the start") return shots.slice(0, count);
  if (keep === "the longest shots") {
    const kept = new Set(
      shots
        .map((shot, index) => ({ index, size: shot.to - shot.from }))
        // Longest first; of two the same length, the earlier one.
        .sort((a, b) => b.size - a.size || a.index - b.index)
        .slice(0, count)
        .map((one) => one.index),
    );
    return shots.filter((_, index) => kept.has(index));
  }
  // One from each of `count` even stretches of the list, the middle of it.
  return Array.from(
    { length: count },
    (_, part) => shots[Math.floor(((part + 0.5) * shots.length) / count)],
  );
}

/**
 * The pieces of a video between its camera cuts. A shot shorter than `shortest` joins the
 * one after it (the last joins the one before), a shot longer than `longest` is split
 * evenly, and at most `most` are kept, picked the `keep` way (spread through the video
 * unless said). With no cuts the whole video is split evenly.
 */
export function shotPieces(args: {
  cuts: number[];
  length: number;
  shortest: number;
  longest: number;
  most: number;
  keep?: KeepShots;
}): Shot[] {
  const { length, shortest, longest, most } = args;
  const inside = [...new Set(args.cuts)]
    .filter((time) => time > 0.05 && time < length - 0.05)
    .sort((a, b) => a - b);
  const edges = [0, ...inside, length];
  const shots: Shot[] = [];
  for (let index = 1; index < edges.length; index++) {
    const shot = { from: edges[index - 1], to: edges[index] };
    const last = shots[shots.length - 1];
    // A short shot left before this one: this one takes it in.
    if (last && last.to - last.from < shortest) last.to = shot.to;
    else shots.push(shot);
  }
  const end = shots[shots.length - 1];
  if (shots.length > 1 && end.to - end.from < shortest) {
    shots.pop();
    shots[shots.length - 1].to = end.to;
  }
  const even = shots.flatMap((shot) => {
    const parts = Math.ceil((shot.to - shot.from) / longest - 0.001);
    if (parts <= 1) return [shot];
    const size = (shot.to - shot.from) / parts;
    return Array.from({ length: parts }, (_, part) => ({
      from: shot.from + part * size,
      to: part === parts - 1 ? shot.to : shot.from + (part + 1) * size,
    }));
  });
  return keepShots(even, most, args.keep ?? "spread through the video");
}

export const beatRecipes: StepDefinition[] = [
  editStep({
    id: SPLIT_SHOTS_STEP,
    title: "Split Into Shots",
    description:
      "Splits a video into its shots, cutting where the camera cuts. The cuts are found in the picture itself with plain image comparison, no AI. Shots shorter than you set join the next one, and long shots are split into even pieces, so a video with no cuts at all is split evenly. When there are more shots than you want, it keeps ones spread through the whole video, the longest, or the first. Put Cut To The Beat after it to cut the shots to music.",
    primaryInput: "video_url",
    readsFirst: ["video_url"],
    readsCuts: ["video_url"],
    askFirst: ["longest"],
    blanks: {
      video_url: url("The video"),
      shortest: number("Shots shorter than this many seconds join the next one", 0.2, 10).default(
        1,
      ),
      longest: number("Shots longer than this many seconds are split evenly", 1, 60).default(4),
      most: whole("How many pieces at most", 1, 30).default(30),
      keep: choice(KEEP_SHOTS, "Which pieces to keep when there are more than that")
        .default("spread through the video")
        .meta({ title: "Keep" }),
    },
    outputLabels: (_b, count) =>
      Array.from({ length: count }, (_, index) => `shot${String(index + 1).padStart(2, "0")}`),
    toRequest: (b, facts) => {
      const video = facts.video_url;
      if (!video?.duration) {
        throw new StepSetupError(
          "The video's length could not be read, so it cannot be split into shots.",
        );
      }
      const shots = shotPieces({
        cuts: video.cuts ?? [],
        length: video.duration,
        shortest: b.shortest,
        longest: Math.max(b.longest, b.shortest),
        most: b.most,
        keep: b.keep,
      });
      return {
        inputs: [{ file_url: b.video_url }],
        filters: [],
        // One file per shot. Cutting after decoding lands on the exact frame of the cut.
        outputs: shots.map((shot) => ({
          options: [
            opt("-map", "0:v:0"),
            opt("-map", "0:a:0?"),
            opt("-ss", seconds(shot.from)),
            opt("-to", seconds(shot.to)),
            ...VIDEO_OUT,
          ],
        })),
      };
    },
  }),
  editStep({
    id: BEAT_CUT_STEP,
    title: "Cut To The Beat",
    description:
      "Cuts your clips and pictures together so the picture changes on the beat of the music: every beat, every two beats, every bar or every two bars. The beat is found in the music itself with plain sound analysis, no AI. Clips take turns, each carrying on from where it last left off and looping if it runs out; pictures hold still. Clips take turns in the order listed, or mixed up so neighbours in the list are kept apart. The music plays under it and fades out on the last cut. With no music picked it uses your team's first music track from Settings.",
    primaryInput: null,
    listInput: { field: "video_urls", itemKey: "video_url" },
    brandInputs: { music_url: "music" },
    readsFirst: ["music_url"],
    readsBeats: ["music_url"],
    askFirst: ["cut_every", "length", "shape"],
    blanks: {
      video_urls: z
        .array(z.object({ video_url: z.string().url() }))
        .min(1)
        .max(30)
        .describe("The clips and pictures, in the order they take turns")
        .meta({ title: "Clips and pictures" }),
      music_url: url("The music to cut to. Left empty, your team's first music track").meta({
        title: "Music",
      }),
      cut_every: choice(CUT_EVERY, "How often the picture changes")
        .default("every 2 beats")
        .meta({ title: "Change the picture" }),
      length: number(
        "How long the video is, in seconds, at most. It ends on a beat, and sooner when the song is shorter",
        3,
        180,
      ).default(30),
      start_at: number(
        "Where in the song to start, in seconds, to skip a slow intro. It starts on the first beat after this",
        0,
        900,
      ).default(0),
      shape: choice(SHAPE_NAMES, "The shape of the video").default("vertical"),
      order: choice(
        CLIP_ORDER,
        "The order the clips take turns in. Mixed up keeps clips that sit next to each other in the list apart, so shots split from one long shot never play back to back",
      )
        .default("as they come")
        .meta({ title: "Order" }),
    },
    toRequest: (b, facts) => {
      const music = facts.music_url;
      const found = music?.beats;
      if (!found) {
        throw new StepSetupError(
          "The music's beat could not be read. Update your toolkit to the latest version and try again.",
        );
      }
      if (found.steadiness < STEADY_ENOUGH) {
        throw new StepSetupError(
          "This music has no steady beat to cut on. Pick a track with a clear beat.",
        );
      }
      const songLength = music.duration ?? found.beats[found.beats.length - 1];
      const cuts = beatCuts({
        grid: beatGrid(found, b.cut_every, b.start_at),
        songLength,
        length: b.length,
      });
      const [w, h] = SHAPES[b.shape];
      const listed = b.video_urls.map((item) => item.video_url);
      const clips =
        b.order === "mixed up" ? mixedOrder(listed.length).map((index) => listed[index]) : listed;
      const uses = clips.map(() => 0);
      cuts.pieces.forEach((_, index) => (uses[index % clips.length] += 1));

      const filters: string[] = [];
      clips.forEach((_, index) => {
        const count = uses[index];
        if (count === 0) return;
        const names = Array.from({ length: count }, (__, use) => `[c${index}x${use}]`).join("");
        // Filled to the shape (cropped, not letterboxed), as a beat edit is usually shown.
        filters.push(
          `[${index}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=${RATE},format=yuv420p,split=${count}${names}`,
        );
      });
      const taken = clips.map(() => 0);
      const shown = clips.map(() => 0);
      const parts = cuts.pieces.map((frames, index) => {
        const clip = index % clips.length;
        const from = shown[clip];
        shown[clip] += frames;
        filters.push(
          `[c${clip}x${taken[clip]++}]trim=start_frame=${from}:end_frame=${from + frames},setpts=PTS-STARTPTS[p${index}]`,
        );
        return `[p${index}]`;
      });
      filters.push(`${parts.join("")}concat=n=${parts.length}:v=1:a=0[v]`);
      const total = cuts.frames / RATE;
      const fade = Math.min(0.6, total / 4);
      filters.push(
        `[${clips.length}:a]atrim=start=${seconds(cuts.start)}:duration=${seconds(total)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,afade=t=out:st=${seconds(total - fade)}:d=${seconds(fade)}[a]`,
      );
      return {
        inputs: [
          ...clips.map((link) => ({
            file_url: link,
            // Never runs out: a short clip loops, and a picture is shown for as long as needed.
            options: isPicture(link)
              ? [opt("-loop", 1), opt("-framerate", RATE)]
              : [opt("-stream_loop", -1)],
          })),
          { file_url: b.music_url },
        ],
        filters: filters.map((filter) => ({ filter })),
        outputs: [
          {
            options: [
              opt("-map", "[v]"),
              opt("-map", "[a]"),
              opt("-t", seconds(total)),
              // FFmpeg 7 (the toolkit's) writes 25 frames a second unless told, which moves
              // every cut off the frame it was counted on.
              opt("-r", RATE),
              ...VIDEO_OUT,
            ],
          },
        ],
      };
    },
  }),
];
