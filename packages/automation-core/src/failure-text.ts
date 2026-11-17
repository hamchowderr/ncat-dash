/**
 * Turns the text a failed step left behind into one short reason a person can read,
 * keeping the full text for a "Show details" fold. Toolkit steps that run FFmpeg often
 * fail with FFmpeg's whole log: a banner of version and build flags, a description of
 * the input, and only then the line that says what went wrong.
 */
export type ExplainedFailure = {
  /** One short sentence or line. */
  reason: string;
  /** The full text, when it says more than the reason. Null when the reason is all of it. */
  details: string | null;
};

const MAX_REASON = 240;
const STILL_IMAGE_CODECS = /Video: (png|mjpeg|jpeg|jpegls|webp|bmp|tiff|ppm|pgm|qoi)\b/;

// Lines from FFmpeg's banner and its description of the files, which say nothing about
// what went wrong.
const NOISE = [
  /^ffmpeg version\b/i,
  /^ffprobe version\b/i,
  /^built with\b/i,
  /^configuration:/i,
  /^lib(av|sw|post)\w*\s+\d/i,
  /^(Input|Output) #\d+/,
  /^(Duration|Stream #|Metadata:|Chapters?:|Side data:)/,
  /^Stream mapping:/,
  /^Press \[q\]/,
  /^Conversion failed!?$/i,
  /^Error opening output files?/i,
  /^Error opening input files?/i,
  /^Exiting normally/i,
];

function looksLikeFfmpegLog(text: string): boolean {
  return /ffmpeg version|ffprobe version|\bconfiguration: --|Input #\d+,|Output #\d+,/.test(text);
}

/** Known FFmpeg failures, said in plain words. */
function friendlyReason(text: string): string | null {
  const inputPart = text.split(/Output #\d+/)[0];
  const hasAudio = /Stream #\d+:\d+[^\n]*: Audio:/.test(inputPart);
  const hasVideo = /Stream #\d+:\d+[^\n]*: Video:/.test(inputPart);
  const stillImage =
    STILL_IMAGE_CODECS.test(inputPart) ||
    /Input #\d+, (png|jpeg|webp|bmp|tiff)_pipe\b/.test(inputPart);
  if (stillImage && /Duration: N\/A/.test(inputPart) && !hasAudio) {
    return "This file is a still image. This step needs a video or audio file.";
  }
  if (
    /does not contain any stream|matches no streams|Output file is empty, nothing was encoded/.test(
      text,
    ) &&
    hasVideo &&
    !hasAudio
  ) {
    return "This file has no sound to work with.";
  }
  if (/Server returned 404|HTTP error 404|404 Not Found/.test(text)) {
    return 'The file\'s link returned "not found". Check the file is still there.';
  }
  if (/Server returned 403|HTTP error 403|403 Forbidden/.test(text)) {
    return "The file's link refused access. It may have expired.";
  }
  if (/No such file or directory/.test(text)) return "The file could not be found.";
  if (/moov atom not found|Invalid data found when processing input/.test(text)) {
    return "The file is damaged or is not a video or audio file.";
  }
  return null;
}

function clip(line: string): string {
  return line.length > MAX_REASON ? `${line.slice(0, MAX_REASON - 1).trimEnd()}…` : line;
}

export function explainFailure(text: string | null | undefined): ExplainedFailure {
  const full = (text ?? "").trim();
  if (!full) return { reason: "The step failed.", details: null };

  if (looksLikeFfmpegLog(full)) {
    // A prefix such as "Failed to load audio: " or "FFmpeg error: " sits before the banner.
    const rawPrefix = full.match(/^([\s\S]*?)(?:ffmpeg|ffprobe) version\b/i)?.[1] ?? "";
    const prefix = rawPrefix.trim();
    const known = friendlyReason(full);
    if (known) return { reason: known, details: full };
    const meaningful = full
      .slice(rawPrefix.length)
      .split(/\r?\n/)
      .map((line) => line.replace(/^\[[^\]]*@ 0x[0-9a-f]+\]\s*/i, "").trim())
      .filter((line) => line && !NOISE.some((pattern) => pattern.test(line)))
      .filter((line) => !/^\w+\s*:\s*$/.test(line));
    // The first line that names a problem is the cause; later ones are its knock-on effects.
    const errorLine =
      meaningful.find((line) => /error|invalid|fail|unknown|not |unable|cannot|no /i.test(line)) ??
      meaningful[meaningful.length - 1];
    const lead = prefix.replace(/[:\s]+$/, "");
    const reason = errorLine
      ? lead && !errorLine.toLowerCase().includes(lead.toLowerCase())
        ? `${lead}: ${errorLine}`
        : errorLine
      : lead || "FFmpeg could not process this file.";
    return { reason: clip(reason), details: full };
  }

  const firstLine = full.split(/\r?\n/)[0].trim();
  if (firstLine === full && full.length <= MAX_REASON) return { reason: full, details: null };
  return { reason: clip(firstLine), details: full };
}
