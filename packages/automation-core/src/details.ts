/**
 * What is known about a file once the toolkit has read it (it runs FFprobe): how long it
 * is, its picture size, its sound, and so on. Read once when a file is uploaded, kept with
 * the upload, and handed to every run the file starts.
 */
export interface FileDetails {
  /** Length in seconds. */
  duration?: number;
  /** Size in bytes. */
  filesize?: number;
  /** The container, as FFprobe names it: "mov,mp4,m4a,3gp,3g2,mj2", "mp3", "png_pipe". */
  format?: string;
  /** Bits per second for the whole file. */
  bitrate?: number;
  hasVideo?: boolean;
  hasAudio?: boolean;
  width?: number;
  height?: number;
  /** Frames per second. */
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  /** Samples per second, for example 48000. */
  audioSampleRate?: number;
}

const NUMBERS: [keyof FileDetails, string][] = [
  ["duration", "duration"],
  ["filesize", "filesize"],
  ["bitrate", "overall_bitrate"],
  ["width", "width"],
  ["height", "height"],
  ["fps", "fps"],
  ["audioChannels", "audio_channels"],
  ["audioSampleRate", "audio_sample_rate"],
];
const WORDS: [keyof FileDetails, string][] = [
  ["format", "format"],
  ["videoCodec", "video_codec"],
  ["audioCodec", "audio_codec"],
];
const FLAGS: [keyof FileDetails, string][] = [
  ["hasVideo", "has_video"],
  ["hasAudio", "has_audio"],
];

/**
 * The details in the toolkit's answer to /v1/media/metadata, keeping only what is known
 * and well-formed. Null when the answer holds nothing usable.
 */
export function readFileDetails(answer: unknown): FileDetails | null {
  if (typeof answer !== "object" || answer === null) return null;
  const raw = answer as Record<string, unknown>;
  const details: Record<string, unknown> = {};
  for (const [key, from] of NUMBERS) {
    const value = raw[from];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) details[key] = value;
  }
  for (const [key, from] of WORDS) {
    const value = raw[from];
    if (typeof value === "string" && value && value !== "unknown")
      details[key] = value.slice(0, 80);
  }
  for (const [key, from] of FLAGS) {
    if (typeof raw[from] === "boolean") details[key] = raw[from];
  }
  // Older toolkits leave these two out; the picture size and codecs say the same thing.
  if (details.hasVideo === undefined && details.width !== undefined) details.hasVideo = true;
  if (details.hasAudio === undefined && details.audioCodec !== undefined) details.hasAudio = true;
  return Object.keys(details).length > 0 ? (details as FileDetails) : null;
}

/**
 * Whether a file's length is inside an upload trigger's limits. With a limit set, a file
 * whose length is not known is left out, so a long file never slips into a short-clip
 * automation.
 */
export function withinLength(
  limits: { minSeconds?: number; maxSeconds?: number },
  details: FileDetails | null | undefined,
): boolean {
  const { minSeconds, maxSeconds } = limits;
  if (minSeconds === undefined && maxSeconds === undefined) return true;
  const duration = details?.duration;
  if (duration === undefined) return false;
  return (
    (minSeconds === undefined || duration >= minSeconds) &&
    (maxSeconds === undefined || duration <= maxSeconds)
  );
}

/** A length in seconds as a person reads it: 0:07, 6:52, 1:02:05. */
export function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** What kind of file the details describe. A picture has a frame but no length to speak of. */
export function detailsKind(details: FileDetails): "video" | "audio" | "image" | "other" {
  if (details.hasVideo || details.width !== undefined) {
    return /image|png|jpeg|webp|gif_pipe|_pipe/.test(details.format ?? "") ? "image" : "video";
  }
  return details.hasAudio ? "audio" : "other";
}

/** The details on one line: "6:52 · 1920×1080 · 30 fps · h264 / aac". */
export function describeFileDetails(details: FileDetails): string {
  const kind = detailsKind(details);
  const parts: string[] = [];
  if (details.duration !== undefined && kind !== "image") {
    parts.push(formatDuration(details.duration));
  }
  if (details.width !== undefined && details.height !== undefined) {
    parts.push(`${details.width}×${details.height}`);
  }
  if (details.fps !== undefined && kind === "video") {
    parts.push(`${Math.round(details.fps * 100) / 100} fps`);
  }
  const codecs = [kind === "image" ? undefined : details.videoCodec, details.audioCodec].filter(
    Boolean,
  );
  if (codecs.length > 0) parts.push(codecs.join(" / "));
  if (kind === "video" && details.hasAudio === false) parts.push("no sound");
  return parts.join(" · ");
}

const KIND_LABELS = { video: "Video", audio: "Audio", image: "Picture", other: "Other" } as const;

/**
 * The same five things about any file, for a table: what it is, how long, picture size,
 * frame rate and format. Null where one does not apply, so every row lines up.
 */
export function fileDetailColumns(details: FileDetails): {
  type: string;
  length: string | null;
  picture: string | null;
  frameRate: string | null;
  format: string | null;
} {
  const kind = detailsKind(details);
  const codecs = [details.videoCodec, details.audioCodec].filter(Boolean);
  return {
    type: KIND_LABELS[kind],
    length:
      details.duration !== undefined && kind !== "image" ? formatDuration(details.duration) : null,
    picture:
      details.width !== undefined && details.height !== undefined
        ? `${details.width}×${details.height}`
        : null,
    frameRate:
      details.fps !== undefined && kind === "video"
        ? `${Math.round(details.fps * 100) / 100} fps`
        : null,
    format: codecs.length > 0 ? codecs.join(" / ") : null,
  };
}

/**
 * FFprobe names a family of containers ("mov,mp4,m4a,3gp,3g2,mj2"). Show the one the file's own
 * name ends in when it is in that family, otherwise the family spelled out.
 */
function containerOf(format: string | undefined, name: string | undefined): string | null {
  if (!format) return null;
  const family = format.split(",").map((part) => part.trim());
  const ending = name?.split(".").pop()?.toLowerCase();
  return ending && family.includes(ending) ? ending : family.join(", ");
}

/** Everything that was read from a file, as label and value pairs in a fixed order. */
export function fileDetailRows(details: FileDetails, name?: string): [string, string][] {
  const kind = detailsKind(details);
  const columns = fileDetailColumns(details);
  const rows: [string, string | null][] = [
    ["Type", columns.type],
    ["Length", columns.length],
    ["Picture size", columns.picture],
    ["Frame rate", columns.frameRate],
    ["Video format", kind === "video" ? (details.videoCodec ?? null) : null],
    ["Picture format", kind === "image" ? (details.videoCodec ?? null) : null],
    ["Sound format", details.audioCodec ?? null],
    [
      "Sound",
      details.hasAudio === false
        ? "None"
        : details.audioChannels !== undefined
          ? details.audioChannels === 1
            ? "Mono"
            : details.audioChannels === 2
              ? "Stereo"
              : `${details.audioChannels} channels`
          : null,
    ],
    [
      "Sample rate",
      details.audioSampleRate !== undefined
        ? `${Math.round(details.audioSampleRate / 100) / 10} kHz`
        : null,
    ],
    ["Container", containerOf(details.format, name)],
    [
      "Bitrate",
      details.bitrate !== undefined
        ? details.bitrate >= 1_000_000
          ? `${Math.round(details.bitrate / 10_000) / 100} Mbps`
          : `${Math.round(details.bitrate / 1000)} kbps`
        : null,
    ],
  ];
  return rows.filter((row): row is [string, string] => row[1] !== null);
}
