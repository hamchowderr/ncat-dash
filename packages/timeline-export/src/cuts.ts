/**
 * A cut list: what an automation step cut out of a recording, in a form that does not
 * depend on any editor. The writers beside this file turn it into the timeline files
 * Premiere Pro, DaVinci Resolve and Final Cut Pro open.
 */

/** The recording the cuts were made from. */
export interface CutSource {
  /** Where the file is kept. Only its file name goes into a timeline. */
  url: string;
  /** Frames per second, as the toolkit reports it: 29.97, 25, 60. */
  fps: number;
  width: number;
  height: number;
  /** Length in seconds. */
  duration: number;
  hasAudio: boolean;
  audioChannels?: number;
  /** Samples per second, for example 48000. */
  audioSampleRate?: number;
}

/** One kept part of the recording. */
export interface CutPiece {
  /** Second of the recording the piece starts at. */
  start: number;
  seconds: number;
}

/** One timeline in the editor: pieces of one recording, back to back. */
export interface CutTimeline {
  name: string;
  source: CutSource;
  pieces: CutPiece[];
  /** The timeline's picture size when it differs from the recording's (a vertical clip). */
  width?: number;
  height?: number;
}

export interface CutList {
  /** Shown as the project or event name in the editor. */
  name: string;
  timelines: CutTimeline[];
}

/** A frame rate as editors want it: a whole timebase, and whether it is an NTSC rate. */
export interface Rate {
  /** 24, 25, 30, 60 and so on. */
  timebase: number;
  /** True for 23.976, 29.97, 59.94: the timebase slowed by 1000/1001. */
  ntsc: boolean;
}

/** The editor rate for a measured frame rate. 29.97 and 29.970029 both give 30 NTSC. */
export function rateOf(fps: number): Rate {
  if (!(fps > 0)) return { timebase: 30, ntsc: false };
  const timebase = Math.max(1, Math.round(fps));
  const ntsc = Math.abs(fps - (timebase * 1000) / 1001) < Math.abs(fps - timebase);
  return { timebase, ntsc };
}

/** Frames per second of a rate, exactly. */
export const framesPerSecond = (rate: Rate) =>
  rate.ntsc ? (rate.timebase * 1000) / 1001 : rate.timebase;

/** The frame a moment in seconds falls on. */
export const toFrames = (seconds: number, rate: Rate) =>
  Math.max(0, Math.round(seconds * framesPerSecond(rate)));

/** A piece snapped to the recording's frames. */
export interface FramedPiece {
  /** First frame of the recording in the piece. */
  in: number;
  /** One past its last frame. */
  out: number;
  /** Frame of the timeline the piece starts at. */
  at: number;
}

/**
 * The pieces of a timeline in whole frames, laid back to back. A piece never reaches past
 * the end of the recording, and one too short to hold a frame is dropped.
 */
export function framePieces(timeline: CutTimeline): FramedPiece[] {
  const rate = rateOf(timeline.source.fps);
  const last = toFrames(timeline.source.duration, rate);
  const framed: FramedPiece[] = [];
  let at = 0;
  for (const piece of timeline.pieces) {
    const start = Math.min(toFrames(piece.start, rate), last);
    const end = Math.min(toFrames(piece.start + piece.seconds, rate), last);
    if (end <= start) continue;
    framed.push({ in: start, out: end, at });
    at += end - start;
  }
  return framed;
}

/** The file name at the end of a URL, without its query: "Episode 12.mp4". */
export function fileNameOf(url: string): string {
  const path = url.split(/[?#]/)[0];
  const last = path.slice(path.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(last) || "recording";
  } catch {
    return last || "recording";
  }
}

/** A file name as the relative link a timeline file holds. */
export const fileLink = (name: string) => encodeURIComponent(name).replace(/%2F/gi, "/");

/** Text made safe to sit inside XML. */
export const xml = (text: string | number) =>
  String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Control characters are not allowed in XML at all.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** Each different recording in a cut list, once, in the order first used. */
export function sourcesOf(list: CutList): CutSource[] {
  const seen = new Map<string, CutSource>();
  for (const timeline of list.timelines) {
    if (!seen.has(timeline.source.url)) seen.set(timeline.source.url, timeline.source);
  }
  return [...seen.values()];
}

/**
 * The cut list of a "clips" step: one timeline per clip, each showing its part of the
 * recording it came from. Clips of a recording whose details are not known are left out.
 */
export function clipsCutList(
  name: string,
  plan: { source: string; part: number; parts: number; start: number; seconds: number }[],
  sources: Record<string, CutSource | undefined>,
  frame?: { width: number; height: number },
): CutList {
  const timelines: CutTimeline[] = [];
  for (const clip of plan) {
    const source = sources[clip.source];
    if (!source) continue;
    const base = fileNameOf(source.url).replace(/\.[^.]+$/, "");
    timelines.push({
      name: `${base} ${clip.part} of ${clip.parts}`,
      source,
      pieces: [{ start: clip.start, seconds: clip.seconds }],
      ...(frame ? { width: frame.width, height: frame.height } : {}),
    });
  }
  return { name, timelines };
}
