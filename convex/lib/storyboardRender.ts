/**
 * Turning a storyboard into one finished video. Every take becomes one short video made in
 * its scene (Full Screen, Panel, Centre, Full Graphic, Circle), all the same size, frame rate
 * and sound, so the takes can then be joined end to end without being made again. These
 * rules only build the requests; storyboardVideos.ts sends them and joins what comes back.
 */
import type { Aspect, Part, Scene } from "./storyboard";

/** The frame each shape is made at. */
export const CANVAS: Record<Aspect, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

const RATE = 30;
const BACKGROUND = "0x111111";
/** The gap around boxes, as a share of the frame's shorter side. */
const MARGIN = 0.045;
/** The line around you in a Panel or a Circle, in pixels. */
const BORDER = 6;

/** Which part is shown with you, when a take has more than one: the first one in. */
export const SHOWN_WITH_YOU: Part[] = ["recording", "screen", "graphic"];

/** A file going into a take: its address, and the stretch of it used when only part is. */
export type Source = {
  url: string;
  kind: "video" | "image";
  start?: number;
  end?: number;
  /** False when the file is known to have no sound. */
  audio?: boolean;
};

export type Segment = {
  scene: Scene;
  /** You saying the line. Its sound is the take's sound, and it decides how long it is. */
  you?: Source;
  /** What is shown with you: a graphic, a page recording or your screen. */
  shown?: Source;
  /** How long the take is, in seconds, when nothing else says: a picture with no voice. */
  hold: number;
  /** The team's colour, for the line around you. */
  accent?: string;
};

type Option = { option: string; argument?: string | number };
const opt = (option: string, argument?: string | number): Option =>
  argument === undefined ? { option } : { option, argument };
const seconds = (value: number) => String(Math.round(value * 1000) / 1000);
const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2);

/** The settings every take is made with, so they join without being made again. */
const SAME_FOR_ALL: Option[] = [
  opt("-c:v", "libx264"),
  opt("-preset", "veryfast"),
  opt("-crf", 21),
  opt("-pix_fmt", "yuv420p"),
  opt("-r", RATE),
  opt("-c:a", "aac"),
  opt("-b:a", "192k"),
  opt("-ar", 48000),
  opt("-ac", 2),
  opt("-movflags", "+faststart"),
  opt("-f", "mp4"),
];

const lengthOf = (source: Source | undefined) =>
  source && source.start !== undefined && source.end !== undefined
    ? Math.max(0.1, source.end - source.start)
    : null;

/** How long a take runs, when that is known before it is made. */
export function segmentLength(segment: Segment): number | null {
  if (segment.you) return lengthOf(segment.you);
  if (segment.shown?.kind === "video") return lengthOf(segment.shown);
  return segment.hold;
}

/** A file as an input: only its stretch, and a picture held for as long as it is needed. */
function input(source: Source, still: number | null) {
  const options: Option[] = [];
  if (source.kind === "image") {
    options.push(opt("-loop", 1), opt("-framerate", RATE));
    if (still) options.push(opt("-t", seconds(still)));
  } else if (source.start !== undefined) {
    options.push(opt("-ss", seconds(source.start)));
    const length = lengthOf(source);
    if (length) options.push(opt("-t", seconds(length)));
  }
  return options.length > 0 ? { file_url: source.url, options } : { file_url: source.url };
}

/** Fills a box, cutting off what does not fit: you on camera. */
const cover = (w: number, h: number) =>
  `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
/** Fits inside a box with nothing cut off: a graphic, a recording, a screen. */
const fit = (w: number, h: number) =>
  `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${BACKGROUND},setsar=1`;
/** A video shown with you holds its last frame if it ends before you do. */
const hold = (source: Source) =>
  source.kind === "video" ? "tpad=stop_mode=clone:stop_duration=3600," : "";
const ROUND = `format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lte(hypot(X-W/2,Y-H/2),W/2),255,0)'`;
const FINISH = `fps=${RATE},format=yuv420p,setsar=1`;

/** The picture part of a take, as filters ending in [v]. */
function pictureOf(
  scene: Scene,
  you: number | null,
  shown: { index: number; source: Source } | null,
  width: number,
  height: number,
  accent: string,
): string[] {
  const tall = height > width;
  const margin = even(Math.min(width, height) * MARGIN);
  const background = `color=c=${BACKGROUND}:s=${width}x${height}:r=${RATE}`;
  const g = shown ? `[${shown.index}:v]${hold(shown.source)}` : "";
  const y = you !== null ? `[${you}:v]` : "";

  // Only one of you and what is shown is in: it fills the frame.
  // A video alone plays its own length, so it is not held at its end.
  if (you === null) return [`[${shown!.index}:v]${fit(width, height)},${FINISH}[v]`];
  if (!shown || scene === "full") return [`${y}${cover(width, height)},${FINISH}[v]`];

  if (scene === "graphic") return [`${g}${fit(width, height)},${FINISH}[v]`];

  if (scene === "panel") {
    // What is shown takes most of the frame; you are boxed beside it, or under it when tall.
    const inner = tall ? width - 2 * margin : height - 2 * margin;
    const shownW = tall ? inner : even(width * 0.64 - 1.5 * margin);
    const shownH = tall ? even(height * 0.56 - 1.5 * margin) : inner;
    const youW = tall ? inner - 2 * BORDER : even(width - 3 * margin - shownW - 2 * BORDER);
    const youH = tall ? even(height - 3 * margin - shownH - 2 * BORDER) : inner - 2 * BORDER;
    const youX = tall ? margin : 2 * margin + shownW;
    const youY = tall ? 2 * margin + shownH : margin;
    return [
      `${background}[bg]`,
      `${g}${fit(shownW, shownH)}[shown]`,
      `${y}${cover(youW, youH)},pad=${youW + 2 * BORDER}:${youH + 2 * BORDER}:${BORDER}:${BORDER}:color=${accent}[you]`,
      `[bg][shown]overlay=${margin}:${margin}[base]`,
      `[base][you]overlay=${youX}:${youY}:shortest=1,${FINISH}[v]`,
    ];
  }

  if (scene === "centre") {
    // You in the middle; the graphic's two halves either side, for a comparison.
    const middle = even((tall ? height : width) * 0.36);
    const side = even(((tall ? height : width) - middle) / 2);
    const halfA = tall ? "crop=iw:ih/2:0:0" : "crop=iw/2:ih:0:0";
    const halfB = tall ? "crop=iw:ih/2:0:ih/2" : "crop=iw/2:ih:iw/2:0";
    const sideBox = tall ? fit(width, side) : fit(side, height);
    const youBox = tall ? cover(width, middle) : cover(middle, height);
    const secondAt = tall ? `0:${side + middle}` : `${side + middle}:0`;
    const youAt = tall ? `0:${side}` : `${side}:0`;
    return [
      `${background}[bg]`,
      `${g}split[sa][sb]`,
      `[sa]${halfA},${sideBox}[a]`,
      `[sb]${halfB},${sideBox}[b]`,
      `${y}${youBox}[you]`,
      `[bg][a]overlay=0:0[ba]`,
      `[ba][b]overlay=${secondAt}[bab]`,
      `[bab][you]overlay=${youAt}:shortest=1,${FINISH}[v]`,
    ];
  }

  // Circle: what is shown fills the frame, and a small circle of you sits in a corner.
  const size = even(Math.min(width, height) * 0.34);
  const ring = size + 2 * BORDER;
  const x = width - ring - margin;
  const top = height - ring - margin;
  return [
    `${g}${fit(width, height)}[shown]`,
    `color=c=${accent}:s=${ring}x${ring}:r=${RATE},${ROUND}[ring]`,
    `${y}${cover(size, size)},${ROUND}[you]`,
    `[shown][ring]overlay=${x}:${top}[base]`,
    `[base][you]overlay=${x + BORDER}:${top + BORDER}:shortest=1,${FINISH}[v]`,
  ];
}

/**
 * The request that makes one take in its scene. The take's sound is you saying the line,
 * or silence when nobody says it; either way every take has the same kind of sound, so the
 * takes join cleanly.
 */
export function sceneRequest(segment: Segment, aspect: Aspect): Record<string, unknown> {
  const { width, height } = CANVAS[aspect];

  const inputs: { file_url: string; options?: Option[] }[] = [];
  let you: number | null = null;
  let shown: { index: number; source: Source } | null = null;
  if (segment.you) {
    you = inputs.length;
    inputs.push(input(segment.you, null));
  }
  // Shown alone as a picture, it is held for the take's time; with you, until you finish.
  let showsWithYou =
    segment.shown && (segment.scene !== "full" || !segment.you) ? segment.shown : undefined;
  // A video shown alone whose length is not known is played for the take's time, so the
  // silence under it has an end.
  if (!segment.you && showsWithYou?.kind === "video" && lengthOf(showsWithYou) === null) {
    showsWithYou = { ...showsWithYou, start: 0, end: segment.hold };
  }
  if (showsWithYou) {
    shown = { index: inputs.length, source: showsWithYou };
    inputs.push(input(showsWithYou, you === null ? segment.hold : null));
  }
  if (inputs.length === 0) throw new Error("A take needs a file to be made.");

  const length = segmentLength({ ...segment, shown: showsWithYou ?? segment.shown });
  const accent =
    segment.accent && /^#[0-9A-Fa-f]{6}$|^[A-Za-z]+$/.test(segment.accent)
      ? segment.accent
      : "white";
  const filters = pictureOf(segment.scene, you, shown, width, height, accent);
  const voiced = you !== null && segment.you?.audio !== false;
  filters.push(
    voiced
      ? `[${you}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a]`
      : `anullsrc=r=48000:cl=stereo[a]`,
  );
  return {
    inputs,
    filters: filters.map((filter) => ({ filter })),
    outputs: [
      {
        options: [
          opt("-map", "[v]"),
          opt("-map", "[a]"),
          ...(length ? [opt("-t", seconds(length))] : []),
          opt("-shortest"),
          ...SAME_FOR_ALL,
        ],
      },
    ],
  };
}
