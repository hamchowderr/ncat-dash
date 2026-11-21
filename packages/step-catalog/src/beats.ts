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

const { opt, VIDEO_OUT, url, number, choice, seconds, editStep, SHAPES, SHAPE_NAMES } =
  composeParts;

export const BEAT_CUT_STEP = "recipe-beat-cut";

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

export const beatRecipes: StepDefinition[] = [
  editStep({
    id: BEAT_CUT_STEP,
    title: "Cut To The Beat",
    description:
      "Cuts your clips and pictures together so the picture changes on the beat of the music: every beat, every two beats, every bar or every two bars. The beat is found in the music itself with plain sound analysis, no AI. Clips take turns, each carrying on from where it last left off and looping if it runs out; pictures hold still. The music plays under it and fades out on the last cut. With no music picked it uses your team's first music track from Settings.",
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
      const clips = b.video_urls.map((item) => item.video_url);
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
              ...VIDEO_OUT,
            ],
          },
        ],
      };
    },
  }),
];
