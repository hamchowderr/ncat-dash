/**
 * FCPXML (".fcpxml"), the only timeline file Final Cut Pro opens. Version 1.10 on
 * purpose: a newer Final Cut reads an older file, an older one refuses a newer file, and
 * DaVinci Resolve reads this version too.
 */
import {
  type CutList,
  type Rate,
  fileLink,
  fileNameOf,
  framePieces,
  rateOf,
  sourcesOf,
  toFrames,
  xml,
} from "./cuts";

/** A count of frames as FCPXML writes time: a whole fraction of a second, "1001/30000s". */
export function frameTime(frames: number, rate: Rate): string {
  if (frames === 0) return "0s";
  const [top, bottom] = rate.ntsc ? [frames * 1001, rate.timebase * 1000] : [frames, rate.timebase];
  return top % bottom === 0 ? `${top / bottom}s` : `${top}/${bottom}s`;
}

const SEQUENCE_AUDIO_RATES: Record<number, string> = {
  32000: "32k",
  44100: "44.1k",
  48000: "48k",
  88200: "88.2k",
  96000: "96k",
  176400: "176.4k",
  192000: "192k",
};

/** The timeline file for Final Cut Pro. */
export function fcpXml(list: CutList): string {
  // Picture formats: one per different rate and size, shared by recordings and timelines.
  const formats = new Map<string, string>();
  const resources: string[] = [];
  let nextId = 1;
  const formatId = (rate: Rate, width: number, height: number) => {
    const key = `${rate.timebase}/${rate.ntsc}/${width}x${height}`;
    let id = formats.get(key);
    if (!id) {
      id = `r${nextId++}`;
      formats.set(key, id);
      resources.push(
        `<format id="${id}" frameDuration="${frameTime(1, rate)}" width="${width}" height="${height}"/>`,
      );
    }
    return id;
  };

  const assets = new Map<string, string>();
  for (const source of sourcesOf(list)) {
    const rate = rateOf(source.fps);
    const format = formatId(rate, source.width, source.height);
    const id = `r${nextId++}`;
    assets.set(source.url, id);
    const name = fileNameOf(source.url);
    resources.push(
      `<asset id="${id}" name="${xml(name.replace(/\.[^.]+$/, ""))}" start="0s" ` +
        `duration="${frameTime(toFrames(source.duration, rate), rate)}" hasVideo="1" format="${format}"` +
        (source.hasAudio
          ? ` hasAudio="1" audioSources="1" audioChannels="${Math.max(1, source.audioChannels ?? 2)}" audioRate="${source.audioSampleRate ?? 48000}"`
          : "") +
        `><media-rep kind="original-media" src="${xml(fileLink(name))}"/></asset>`,
    );
  }

  const projects = list.timelines.map((timeline) => {
    const { source } = timeline;
    const rate = rateOf(source.fps);
    const pieces = framePieces(timeline);
    const total = pieces.reduce((sum, piece) => sum + piece.out - piece.in, 0);
    const format = formatId(rate, timeline.width ?? source.width, timeline.height ?? source.height);
    const asset = assets.get(source.url)!;
    const name = fileNameOf(source.url).replace(/\.[^.]+$/, "");
    const clips = pieces
      .map(
        (piece) =>
          `<asset-clip ref="${asset}" name="${xml(name)}" offset="${frameTime(piece.at, rate)}" ` +
          `start="${frameTime(piece.in, rate)}" duration="${frameTime(piece.out - piece.in, rate)}" tcFormat="NDF"/>`,
      )
      .join("");
    const audioRate = SEQUENCE_AUDIO_RATES[source.audioSampleRate ?? 48000] ?? "48k";
    return (
      `<project name="${xml(timeline.name)}"><sequence format="${format}" duration="${frameTime(total, rate)}" ` +
      `tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="${audioRate}"><spine>${clips}</spine></sequence></project>`
    );
  });

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10">` +
    `<resources>${resources.join("")}</resources>` +
    `<library><event name="${xml(list.name)}">${projects.join("")}</event></library></fcpxml>\n`
  );
}
