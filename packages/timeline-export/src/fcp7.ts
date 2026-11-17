/**
 * Final Cut Pro 7 XML (".xml", the "xmeml" format). Final Cut 7 itself is long gone, but
 * this is the timeline file Premiere Pro and DaVinci Resolve both open.
 */
import {
  type CutList,
  type CutSource,
  type Rate,
  fileLink,
  fileNameOf,
  framePieces,
  rateOf,
  sourcesOf,
  toFrames,
  xml,
} from "./cuts";

const flag = (value: boolean) => (value ? "TRUE" : "FALSE");

const rateXml = (rate: Rate) =>
  `<rate><timebase>${rate.timebase}</timebase><ntsc>${flag(rate.ntsc)}</ntsc></rate>`;

const timecodeXml = (rate: Rate) =>
  `<timecode>${rateXml(rate)}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>`;

const pictureXml = (rate: Rate, width: number, height: number) =>
  `<samplecharacteristics>${rateXml(rate)}<width>${width}</width><height>${height}</height>` +
  `<anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics>`;

const soundXml = (source: CutSource) =>
  `<samplecharacteristics><depth>16</depth><samplerate>${source.audioSampleRate ?? 48000}</samplerate></samplecharacteristics>`;

/** How many audio tracks a recording puts on the timeline: one per channel, two at most. */
const channelsOf = (source: CutSource) =>
  source.hasAudio ? Math.min(2, Math.max(1, source.audioChannels ?? 2)) : 0;

/** The timeline file for Premiere Pro and DaVinci Resolve. */
export function fcp7Xml(list: CutList): string {
  const fileIds = new Map(
    sourcesOf(list).map((source, index) => [source.url, `file-${index + 1}`]),
  );
  // A file is described in full the first time it is used and by its id after that.
  const described = new Set<string>();
  let nextItem = 1;

  const fileXml = (source: CutSource) => {
    const id = fileIds.get(source.url)!;
    if (described.has(id)) return `<file id="${id}"/>`;
    described.add(id);
    const rate = rateOf(source.fps);
    const name = fileNameOf(source.url);
    const channels = channelsOf(source);
    return (
      `<file id="${id}"><name>${xml(name)}</name><pathurl>${xml(fileLink(name))}</pathurl>` +
      `${rateXml(rate)}<duration>${toFrames(source.duration, rate)}</duration>${timecodeXml(rate)}` +
      `<media><video>${pictureXml(rate, source.width, source.height)}</video>` +
      (channels
        ? `<audio>${soundXml(source)}<channelcount>${channels}</channelcount></audio>`
        : "") +
      `</media></file>`
    );
  };

  const sequences = list.timelines.map((timeline, index) => {
    const { source } = timeline;
    const rate = rateOf(source.fps);
    const pieces = framePieces(timeline);
    const total = pieces.reduce((sum, piece) => sum + piece.out - piece.in, 0);
    const channels = channelsOf(source);
    const length = toFrames(source.duration, rate);
    const name = fileNameOf(source.url);

    // Every piece is one picture item and one sound item per channel, linked together so
    // the editor moves them as one.
    const items = pieces.map(() => {
      const ids = Array.from({ length: 1 + channels }, () => `clipitem-${nextItem++}`);
      return ids;
    });
    const links = (ids: string[], pieceIndex: number) =>
      ids
        .map(
          (id, track) =>
            `<link><linkclipref>${id}</linkclipref><mediatype>${track === 0 ? "video" : "audio"}</mediatype>` +
            `<trackindex>${track === 0 ? 1 : track}</trackindex><clipindex>${pieceIndex + 1}</clipindex></link>`,
        )
        .join("");
    const item = (pieceIndex: number, track: number) => {
      const piece = pieces[pieceIndex];
      const ids = items[pieceIndex];
      return (
        `<clipitem id="${ids[track]}"><name>${xml(name)}</name><enabled>TRUE</enabled>` +
        `<duration>${length}</duration>${rateXml(rate)}` +
        `<start>${piece.at}</start><end>${piece.at + piece.out - piece.in}</end>` +
        `<in>${piece.in}</in><out>${piece.out}</out>${fileXml(source)}` +
        (track > 0
          ? `<sourcetrack><mediatype>audio</mediatype><trackindex>${track}</trackindex></sourcetrack>`
          : "") +
        (ids.length > 1 ? links(ids, pieceIndex) : "") +
        `</clipitem>`
      );
    };

    const videoTrack = `<track>${pieces.map((_, i) => item(i, 0)).join("")}<enabled>TRUE</enabled><locked>FALSE</locked></track>`;
    const audioTracks = Array.from(
      { length: channels },
      (_, channel) =>
        `<track>${pieces.map((_, i) => item(i, channel + 1)).join("")}<enabled>TRUE</enabled><locked>FALSE</locked></track>`,
    ).join("");

    return (
      `<sequence id="sequence-${index + 1}"><name>${xml(timeline.name)}</name><duration>${total}</duration>` +
      `${rateXml(rate)}${timecodeXml(rate)}<media>` +
      `<video><format>${pictureXml(rate, timeline.width ?? source.width, timeline.height ?? source.height)}</format>${videoTrack}</video>` +
      `<audio><format>${soundXml(source)}</format>${audioTracks}</audio>` +
      `</media></sequence>`
    );
  });

  const body =
    sequences.length === 1
      ? sequences[0]
      : `<project><name>${xml(list.name)}</name><children>${sequences.join("")}</children></project>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="5">${body}</xmeml>\n`;
}
