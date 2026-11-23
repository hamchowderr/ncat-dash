/**
 * B-Roll: short cutaways laid over a talking-head video while the voice carries on.
 *
 * Add B-Roll needs no AI. It reads the transcript, takes the words that could be shown
 * from each sentence ("the garage", "coffee"), and asks the picture model (CLIP, on the
 * team's own toolkit) which footage looks most like them: first the team's own Content
 * Library, then free stock. Footage that does not look enough like the words is not used.
 * Then it spreads the cutaways out by the team's settings and lays them over with FFmpeg.
 *
 * Plan B-Roll (AI, only when a team adds it) reads the transcript instead and quotes the
 * moments worth covering and what to show; Add B-Roll uses that plan when it is there.
 * Every quote is found in the transcript word for word, as Best moments does.
 */
import { findQuote, sentencesOf, type Span, type Word } from "./moments";

export const BROLL_OFTEN = ["light", "medium", "busy"] as const;
export type BrollOften = (typeof BROLL_OFTEN)[number];

export const BROLL_LOOKS = ["full", "window"] as const;
export type BrollLook = (typeof BROLL_LOOKS)[number];

export const BROLL_SOURCES = ["library-and-stock", "library", "stock"] as const;
export type BrollSources = (typeof BROLL_SOURCES)[number];

export const BROLL_MATCH = ["close", "normal", "loose"] as const;
export type BrollMatch = (typeof BROLL_MATCH)[number];

export interface BrollSettings {
  /** How many cutaways: light, medium or busy. */
  often: BrollOften;
  /** How long each cutaway lasts, in seconds. */
  seconds: number;
  /** Seconds at the start kept on the speaker, so the hook stays on the face. */
  skipOpening: number;
  /** Full screen, or a smaller window over the speaker. */
  look: BrollLook;
  /** Where footage comes from. */
  sources: BrollSources;
  /** How closely footage must look like the words to be used. */
  match: BrollMatch;
}

export const BROLL_DEFAULTS: BrollSettings = {
  often: "medium",
  seconds: 3,
  skipOpening: 3,
  look: "full",
  sources: "library-and-stock",
  match: "normal",
};

export const MIN_BROLL_SECONDS = 1.5;
/**
 * Added to a library file's score when choosing, so the team's own footage wins over stock
 * that matches about as well. It never lets a weak match in: the threshold is checked
 * against the real score.
 */
export const LIBRARY_PREFERENCE = 0.01;
export const MAX_BROLL_SECONDS = 8;
export const MAX_SKIP_OPENING = 60;
/** The most cutaways laid over one video. */
export const MAX_CUTAWAYS = 20;

/** Seconds kept on the speaker between two cutaways. */
export const BROLL_GAPS: Record<BrollOften, number> = { light: 15, medium: 7, busy: 3 };

/**
 * The lowest CLIP score (picture vector against words vector) that counts as a match. A
 * picture that shows the words usually scores 0.26 to 0.33 with this model; an unrelated
 * one about 0.15 to 0.22.
 */
export const BROLL_THRESHOLDS: Record<BrollMatch, number> = {
  close: 0.27,
  normal: 0.25,
  loose: 0.23,
};

function numberOr(value: unknown, fallback: number): number {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : fallback;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const round3 = (value: number) => Math.round(value * 1000) / 1000;

function oneOf<T extends string>(choices: readonly T[], value: unknown, fallback: T): T {
  return choices.includes(value as T) ? (value as T) : fallback;
}

/** A step's saved settings with defaults for what is blank and every number in range. */
export function brollSettings(input: Record<string, unknown>): BrollSettings {
  return {
    often: oneOf(BROLL_OFTEN, input.often, BROLL_DEFAULTS.often),
    seconds: clamp(
      numberOr(input.seconds, BROLL_DEFAULTS.seconds),
      MIN_BROLL_SECONDS,
      MAX_BROLL_SECONDS,
    ),
    skipOpening: clamp(
      numberOr(input.skipOpening, BROLL_DEFAULTS.skipOpening),
      0,
      MAX_SKIP_OPENING,
    ),
    look: oneOf(BROLL_LOOKS, input.look, BROLL_DEFAULTS.look),
    sources: oneOf(BROLL_SOURCES, input.sources, BROLL_DEFAULTS.sources),
    match: oneOf(BROLL_MATCH, input.match, BROLL_DEFAULTS.match),
  };
}

export const usesLibrary = (settings: BrollSettings) => settings.sources !== "stock";
export const usesStock = (settings: BrollSettings) => settings.sources !== "library";

// Words that never say what to show. Kept short and plain: anything that slips through
// still has to look like some footage to be used.
const NOT_SHOWN = new Set(
  (
    "a about above actually after again against all almost also always am an and any anyway are " +
    "around as at away back basically be because been before being below between both but by " +
    "can cannot could day did do does doing done dont down during each else even ever every " +
    "everything few first for from further get gets getting go goes going gonna good got gotta " +
    "great had has have having he her here hers herself him himself his how however i if im in " +
    "into is it its itself ive just keep kind know last least let lets like literally little " +
    "look lot lots made make makes making many maybe me mean might more most much must my " +
    "myself need never new next no nor not nothing now of off oh ok okay on once one only or " +
    "other our ours ourselves out over own people pretty probably put quite rather really right " +
    "said same say saying says see seen she should show so some something sometimes still stuff " +
    "such sure take talk talking tell than thank thanks that thats the their theirs them " +
    "themselves then there theres these they thing things think this those though through time " +
    "times to today too try trying um uh under until up us use used using very want wanted wants " +
    "was way we well went were what whats when where which while who why will with within " +
    "without wont would yeah yes yet you youre your yours yourself yourselves year years week " +
    "weeks thing guys guy everyone somebody someone didnt doesnt isnt wasnt arent werent " +
    "cant couldnt wouldnt shouldnt hasnt havent hadnt youve weve theyve ill youll part bit"
  ).split(" "),
);

/**
 * The words in some speech that could be shown, in order, at most `max`: "I started this
 * in my dad's garage" gives "started dad's garage" less the verbs CLIP cannot show well,
 * so "dad garage". Empty when nothing is left.
 */
export function shownWords(text: string, max = 3): string {
  const kept: string[] = [];
  for (const raw of text.split(/\s+/)) {
    const word = raw
      .normalize("NFKD")
      .toLowerCase()
      .replace(/['’]s$/u, "")
      .replace(/[^\p{L}\p{N}-]+/gu, "");
    if (word.length < 3 || NOT_SHOWN.has(word) || /^\d+$/.test(word)) continue;
    if (/(ing|ed)$/.test(word) && word.length >= 5 && word.length < 8) continue;
    if (!kept.includes(word)) kept.push(word);
  }
  // The last words of a sentence usually carry what it is about.
  return kept.slice(-max).join(" ");
}

/** What a cutaway's footage is matched against: a moment and the words for it. */
export interface BrollMoment {
  start: number;
  end: number;
  /** What was said. */
  said: string;
  /** What to show, in a few words: the stock search and the picture model's words. */
  show: string;
}

/** Each sentence that names something to show, as a moment to maybe cover. */
export function brollMomentsFromWords(words: Word[]): BrollMoment[] {
  const moments: BrollMoment[] = [];
  for (const { first, last } of sentencesOf(words)) {
    const said = words
      .slice(first, last + 1)
      .map((word) => word.text)
      .join(" ");
    const show = shownWords(said);
    if (!show) continue;
    moments.push({ start: words[first].start, end: words[last].end, said, show });
  }
  return moments;
}

/** What Plan B-Roll's model hands back for one cutaway. */
export interface BrollPick {
  /** The words said when the cutaway should start, quoted from the transcript. */
  quote: string;
  /** What the footage should show, in a few plain words. */
  show: string;
}

const str = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

/** The cutaways in a model answer, keeping only well-formed ones. */
export function brollPicksFrom(answer: unknown): BrollPick[] {
  const list = (answer as { cutaways?: unknown } | null)?.cutaways;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => ({
      quote: str((item as { quote?: unknown })?.quote, 2000).trim(),
      show: str((item as { show?: unknown })?.show, 200).trim(),
    }))
    .filter((pick) => pick.quote !== "" && pick.show !== "")
    .slice(0, MAX_CUTAWAYS * 2);
}

/**
 * The plan's picks placed on the words: each quote found word for word (one that is not
 * there is dropped and counted), in the order they are said.
 */
export function brollMomentsFromPicks(
  words: Word[],
  picks: BrollPick[],
): { moments: BrollMoment[]; dropped: number } {
  const moments: BrollMoment[] = [];
  let dropped = 0;
  for (const pick of picks) {
    const found = findQuote(words, pick.quote);
    if (!found) {
      dropped++;
      continue;
    }
    moments.push({
      start: words[found.first].start,
      end: words[found.last].end,
      said: words
        .slice(found.first, found.last + 1)
        .map((word) => word.text)
        .join(" "),
      show: pick.show,
    });
  }
  moments.sort((a, b) => a.start - b.start);
  return { moments, dropped };
}

/** A piece of footage that could cover a moment. */
export interface Footage {
  kind: "library" | "stock";
  /** Where it can be read from now. */
  url: string;
  /** The library short ID ("V12"), or the stock site and its number ("pixabay:1234"). */
  ref: string;
  /** Its name, or what the stock site says it shows. */
  title: string;
  /** Its length in seconds. */
  duration: number;
  /** The second of it that looks most like the words. */
  bestAt: number;
  /** How much it looks like the words (CLIP score). */
  score: number;
  /** The stock site's page and who made it, for footage from stock. */
  credit?: { site: string; page: string; by: string };
}

/** One cutaway as it will be laid over the video. */
export interface Cutaway {
  /** When it covers the video, in the video's own seconds. */
  start: number;
  end: number;
  said: string;
  show: string;
  footage: Footage;
  /** Where in the footage it starts. */
  from: number;
}

/** A camera cut this close to a cutaway's edge: the edge moves onto it. */
export const SNAP_SECONDS = 1;
/**
 * A shot of the video no longer than this (a montage shot, a title) is covered whole or
 * left alone, never cut into: cutting away and back would show the same short shot twice.
 * A longer shot is a take where the speaker talks, and cutting away from it is the point.
 */
export const SHORT_SHOT_SECONDS = MAX_BROLL_SECONDS;

/**
 * Lines a cutaway up with the video's own camera cuts: an edge near a cut moves onto it,
 * a cut inside it ends it there, and a short shot is covered whole or not at all. Null
 * when it does not fit. Without cuts, the span as it was.
 */
export function fitToShots(
  span: Span,
  cuts: number[],
  limits: { earliest: number; latest: number; duration: number; longest: number },
): Span | null {
  if (cuts.length === 0) return span;
  const edges = [0, ...cuts.filter((cut) => cut > 0 && cut < limits.duration), limits.duration];
  const shotAt = (time: number) => {
    const end = edges.find((edge) => edge > time + 0.05) ?? limits.duration;
    const start = [...edges].reverse().find((edge) => edge <= time + 0.05) ?? 0;
    return { start, end };
  };
  let { start, end } = span;
  const length = end - start;
  let shot = shotAt(start);
  if (start - shot.start <= SNAP_SECONDS && shot.start >= limits.earliest) {
    end -= start - shot.start;
    start = shot.start;
  }
  if (shot.end < end - 0.05) {
    // The video cuts during the cutaway: end with it, or begin with it when too little
    // would be left before it.
    if (shot.end - start >= MIN_BROLL_SECONDS) end = shot.end;
    else {
      start = shot.end;
      shot = shotAt(start);
      end = Math.min(start + length, shot.end, limits.latest);
    }
  }
  if (shot.end - end <= SNAP_SECONDS && shot.end - start <= limits.longest) {
    end = Math.min(shot.end, limits.latest);
  }
  const before = start > shot.start + 0.05;
  const after = end < shot.end - 0.05;
  if (before && after && shot.end - shot.start <= SHORT_SHOT_SECONDS) {
    // Inside a short shot: cover all of it, or leave it be.
    if (
      shot.end - shot.start > limits.longest ||
      shot.start < limits.earliest ||
      shot.end > limits.latest + 0.5
    )
      return null;
    start = shot.start;
    end = Math.min(shot.end, limits.latest);
  }
  if (end - start < MIN_BROLL_SECONDS) return null;
  return { start, end };
}

/** A footage's score when choosing: the library a little ahead of stock. */
const rankOf = (one: Footage) => one.score + (one.kind === "library" ? LIBRARY_PREFERENCE : 0);

/**
 * Chooses the cutaways: the best match for each moment, if it is good enough, then the
 * strongest first, kept only where it fits (after the opening, not over another cutaway
 * or anything in `avoid`, with the gap the settings ask for), and no piece of footage
 * twice. With the video's camera `cuts`, each is lined up with its shots (`fitToShots`).
 * Returned in time order.
 */
export function chooseCutaways(
  moments: BrollMoment[],
  footage: Footage[][],
  settings: BrollSettings,
  options: { duration: number; avoid?: Span[]; threshold?: number; cuts?: number[] },
): Cutaway[] {
  const threshold = options.threshold ?? BROLL_THRESHOLDS[settings.match];
  const gap = BROLL_GAPS[settings.often];
  const latest = options.duration - 0.5;
  const candidates: Cutaway[] = [];
  moments.forEach((moment, index) => {
    const ranked = (footage[index] ?? [])
      .filter((one) => one.score >= threshold && one.duration >= MIN_BROLL_SECONDS)
      .sort((a, b) => rankOf(b) - rankOf(a));
    for (const one of ranked) {
      const first = Math.max(moment.start, settings.skipOpening);
      const length = Math.min(settings.seconds, one.duration);
      const fitted = fitToShots(
        { start: first, end: Math.min(first + length, latest) },
        options.cuts ?? [],
        {
          earliest: settings.skipOpening,
          latest,
          duration: options.duration,
          longest: Math.min(one.duration, MAX_BROLL_SECONDS),
        },
      );
      if (!fitted) continue;
      const { start, end } = fitted;
      if (end - start < MIN_BROLL_SECONDS) continue;
      // Centre the footage on its best moment, inside the footage.
      const span = end - start;
      const from = clamp(one.bestAt - span / 2, 0, Math.max(0, one.duration - span));
      candidates.push({
        start: round3(start),
        end: round3(end),
        said: moment.said,
        show: moment.show,
        footage: one,
        from: round3(from),
      });
    }
  });
  candidates.sort((a, b) => rankOf(b.footage) - rankOf(a.footage));

  const kept: Cutaway[] = [];
  const used = new Set<string>();
  const taken = new Set<string>();
  const blocked = options.avoid ?? [];
  for (const one of candidates) {
    if (kept.length >= MAX_CUTAWAYS) break;
    const momentKey = `${one.start}`;
    if (taken.has(momentKey) || used.has(one.footage.ref)) continue;
    if (blocked.some((span) => one.start < span.end && span.start < one.end)) continue;
    if (kept.some((other) => one.start < other.end + gap && other.start < one.end + gap)) continue;
    kept.push(one);
    used.add(one.footage.ref);
    taken.add(momentKey);
  }
  return kept.sort((a, b) => a.start - b.start);
}

type Option = { option: string; argument?: string | number };
const opt = (option: string, argument?: string | number): Option =>
  argument === undefined ? { option } : { option, argument };

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/** The size and place of the cutaway on a video of this size. */
export function cutawayBox(
  look: BrollLook,
  size: { width: number; height: number },
): { width: number; height: number; x: number; y: number } {
  if (look === "full") return { width: even(size.width), height: even(size.height), x: 0, y: 0 };
  // A window: a wide picture across most of a tall video, or a corner of a wide one.
  const tall = size.height > size.width;
  const width = even(size.width * (tall ? 0.86 : 0.42));
  const height = even((width * 9) / 16);
  const margin = Math.round(size.width * 0.04);
  return {
    width,
    height,
    x: tall ? Math.round((size.width - width) / 2) : size.width - width - margin,
    y: tall ? Math.round(size.height * 0.12) : margin,
  };
}

/**
 * The request for the toolkit's /v1/ffmpeg/compose that lays the cutaways over the video.
 * The video's own sound plays throughout; each cutaway's picture is cropped to fill its
 * box and shown from its start to its end.
 */
export function brollRequest(
  videoUrl: string,
  video: { width: number; height: number },
  cutaways: Cutaway[],
  look: BrollLook,
): Record<string, unknown> {
  const box = cutawayBox(look, video);
  const width = even(video.width);
  const height = even(video.height);
  const parts: string[] = [`[0:v]scale=${width}:${height},setsar=1[base]`];
  let last = "base";
  cutaways.forEach((cut, index) => {
    const input = index + 1;
    parts.push(
      `[${input}:v]scale=${box.width}:${box.height}:force_original_aspect_ratio=increase,` +
        `crop=${box.width}:${box.height},setsar=1,setpts=PTS-STARTPTS+${cut.start}/TB[b${input}]`,
    );
    const next = index === cutaways.length - 1 ? "v" : `o${input}`;
    parts.push(
      `[${last}][b${input}]overlay=${box.x}:${box.y}:eof_action=pass:` +
        `enable='between(t,${cut.start},${cut.end})'[${next}]`,
    );
    last = next;
  });
  if (cutaways.length === 0) parts[0] = `[0:v]scale=${width}:${height},setsar=1[v]`;
  return {
    inputs: [
      { file_url: videoUrl },
      ...cutaways.map((cut) => ({
        file_url: cut.footage.url,
        // Only the picture is read, from where the cutaway starts, for as long as it lasts.
        options: [opt("-ss", cut.from), opt("-t", round3(cut.end - cut.start + 0.2)), opt("-an")],
      })),
    ],
    filters: [{ filter: parts.join(";") }],
    outputs: [
      {
        options: [
          opt("-map", "[v]"),
          opt("-map", "0:a?"),
          opt("-c:v", "libx264"),
          opt("-preset", "veryfast"),
          opt("-crf", 21),
          opt("-pix_fmt", "yuv420p"),
          opt("-c:a", "aac"),
          opt("-b:a", "160k"),
          opt("-movflags", "+faststart"),
          opt("-f", "mp4"),
        ],
      },
    ],
  };
}

/** "Used 4 cutaways: 3 from your library, 1 from Pixabay." */
export function cutawaySummary(cutaways: Cutaway[]): string {
  if (cutaways.length === 0) return "No cutaways were added.";
  const library = cutaways.filter((cut) => cut.footage.kind === "library").length;
  const stock = cutaways.length - library;
  const sites = [
    ...new Set(cutaways.flatMap((cut) => (cut.footage.credit ? [cut.footage.credit.site] : []))),
  ];
  const parts = [
    library ? `${library} from your library` : "",
    stock ? `${stock} from ${sites.join(" and ") || "free stock"}` : "",
  ].filter(Boolean);
  return `Added ${cutaways.length} ${cutaways.length === 1 ? "cutaway" : "cutaways"}: ${parts.join(", ")}.`;
}

/**
 * How much of the frame a face covers, at least, to count as someone on camera. A person
 * in a medium shot (waist up, 720p) covers about 2.5%; faces in a crowd or a wide shot
 * stay under 1%.
 */
export const ON_CAMERA_FACE = 0.012;
/** Share of a file's frames with someone on camera that makes it a talking head. */
export const ON_CAMERA_SHARE = 0.4;

/**
 * Whether a library file looks like B-Roll rather than a talking head: a short video in
 * which nobody is on camera most of the time, faces stay small and little is said. A
 * person can say otherwise on the file.
 */
export function looksLikeBroll(file: {
  duration: number;
  /** How much of each sampled frame the largest face covers, 0 to 1. */
  faces: number[];
  /** Words said in it, when it has been transcribed. */
  spokenWords?: number;
}): boolean {
  if (!(file.duration > 0) || file.duration > 180) return false;
  const faces = [...file.faces].sort((a, b) => a - b);
  const middle = faces.length ? faces[Math.floor(faces.length / 2)] : 0;
  if (middle > 0.06) return false;
  const onCamera = faces.filter((face) => face >= ON_CAMERA_FACE).length;
  if (faces.length && onCamera / faces.length >= ON_CAMERA_SHARE) return false;
  const perMinute = ((file.spokenWords ?? 0) / file.duration) * 60;
  return perMinute < 40;
}

/** Cosine score of two unit vectors. */
export function scoreOf(a: number[], b: number[]): number {
  let total = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) total += a[i] * b[i];
  return total;
}
