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

/** The address in a network error ("connect ECONNREFUSED 127.0.0.1:8080"), if it names one. */
function addressIn(text: string): string | null {
  return (
    text.match(/\b(?:ECONNREFUSED|ETIMEDOUT|ECONNRESET|EHOSTUNREACH)\s+([\w.:[\]-]+)/)?.[1] ?? null
  );
}

/**
 * Errors from code rather than from the toolkit's media work: a server that did not
 * answer, a refused key, a crash. People get what happened and what to do about it.
 */
function developerReason(text: string): string | null {
  if (
    /ECONNREFUSED|Connection refused|NewConnectionError|Failed to establish a new connection/i.test(
      text,
    )
  ) {
    const address = addressIn(text);
    const local = address !== null && /^(127\.|localhost|0\.0\.0\.0|\[?::1)/.test(address);
    return local
      ? "The toolkit could not be reached. It is set to an address on this computer, so check the toolkit's address in Settings."
      : "The toolkit could not be reached. Check that it is running and that its address in Settings is right.";
  }
  if (
    /ENOTFOUND|EAI_AGAIN|getaddrinfo|Name or service not known|nodename nor servname/i.test(text)
  ) {
    return "That address could not be found. Check the toolkit's address in Settings.";
  }
  if (/ETIMEDOUT|timed? ?out|TimeoutError|AbortError|operation was aborted/i.test(text)) {
    return "This took too long and was stopped. Try again in a moment.";
  }
  if (
    /ECONNRESET|socket hang up|EPIPE|fetch failed|network ?error|Max retries exceeded/i.test(text)
  ) {
    return "The connection to the toolkit dropped. Try again in a moment.";
  }
  if (/CERT_|certificate|SSL|self[- ]signed/i.test(text)) {
    return "The toolkit's secure connection could not be trusted. Check its address uses a valid certificate.";
  }
  if (
    /(HTTP|status|code|answered)\W{0,3}401\b|Unauthori[sz]ed|Invalid API key|invalid.?api.?key/i.test(
      text,
    )
  ) {
    return "The toolkit did not accept the API key. Check it in Settings.";
  }
  if (
    /(HTTP|status|code|answered)\W{0,3}50[0234]\b|Internal Server Error|Bad Gateway|Service Unavailable/i.test(
      text,
    )
  ) {
    return "The toolkit ran into a problem of its own. Try again in a moment.";
  }
  if (
    /(HTTP|status|code|answered)\W{0,3}413\b|Payload Too Large|Request Entity Too Large/i.test(text)
  ) {
    return "The file is too large for the toolkit to take.";
  }
  if (/(HTTP|status|code|answered)\W{0,3}429\b|Too Many Requests|queue (is )?full/i.test(text)) {
    return "The toolkit is busy with other work. This will try again shortly.";
  }
  return null;
}

/** Text that reads like code talking: an error class, a stack, an errno or raw data. */
function looksLikeCode(text: string): boolean {
  return (
    /^(Uncaught\s+)?[A-Z]\w*(Error|Exception)\b/.test(text) ||
    /^Error:\s/.test(text) ||
    /Traceback \(most recent call last\)|\n\s+at\s+\S+.*\(|\berrno\b/.test(text) ||
    /\bE(NOENT|ACCES|PERM|ADDRINUSE|ADDRNOTAVAIL|NETUNREACH|PROTO|INVAL)\b/.test(text) ||
    /^[{[]/.test(text.trim()) ||
    /\[object Object\]|Cannot read propert|is not a function|is not defined/.test(text)
  );
}

/** The useful words a refusal carries in its body: `{"message": "..."}` and the like. */
function messageInBody(text: string): string | null {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const body = JSON.parse(json) as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "reason"]) {
      const value = body[key];
      if (typeof value === "string" && value.trim() && !looksLikeCode(value.trim())) {
        return value.trim();
      }
    }
  } catch {
    // Not data after all.
  }
  return null;
}

/** A web page in place of an answer: a server's own "Not Found" page, a proxy's error page. */
const HTML_PAGE =
  /<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]|<title[\s>]|<\/(?:h1|p|div|pre|title)>/i;

function looksLikeHtml(text: string): boolean {
  return HTML_PAGE.test(text);
}

/** The words of a web page, with its tags, styles and scripts taken out. */
function pageText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?(<\/\1>|$)/gi, " ")
    .replace(/<!--[\s\S]*?(-->|$)/g, " ")
    .replace(/<[^>]*>?/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

const MISSING_STEP = "Your toolkit does not have this step yet. Update it to the latest version.";

/**
 * A 404 or 405 for a job means the toolkit has no such endpoint: an older toolkit that
 * predates this step. Unless it said something of its own, such as a file it could not find.
 */
function missingStep(text: string): boolean {
  const status = Number(text.match(/\bHTTP (\d{3})\b/)?.[1] ?? NaN);
  if (status !== 404 && status !== 405) return false;
  if (looksLikeHtml(text)) return true;
  return /^The toolkit (refused|was not ready for) the job/.test(text) && !messageInBody(text);
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
      : lead || "The toolkit could not process this file.";
    return { reason: clip(reason), details: full };
  }

  // Raw HTML never reaches people, not even behind "Show details".
  const plain = looksLikeHtml(full) ? pageText(full) : full;

  if (missingStep(full)) return { reason: MISSING_STEP, details: plain };

  const developer = developerReason(full);
  if (developer) return { reason: developer, details: plain };

  if (plain !== full) {
    // Something other than the toolkit answered, or it failed before it could say why.
    return {
      reason:
        "The toolkit answered with an error page instead of a result. Check that it is running and up to date, and that its address in Settings is right.",
      details: plain,
    };
  }

  // "The toolkit refused the job (HTTP 400). {"message": "..."}": say what it said.
  const said = messageInBody(full);
  if (said) {
    const lead = full.match(/^The toolkit[^.]*?(?= \(HTTP|\.)/)?.[0];
    return { reason: clip(lead ? `${lead}: ${said}` : said), details: full };
  }

  const firstLine = full.split(/\r?\n/)[0].trim();
  if (looksLikeCode(firstLine) || looksLikeCode(full)) {
    return {
      reason:
        "Something went wrong in this step. Try it again, and if it keeps failing, show the details to whoever runs your toolkit.",
      details: full,
    };
  }
  if (firstLine === full && full.length <= MAX_REASON) return { reason: full, details: null };
  return { reason: clip(firstLine), details: full };
}
