/**
 * Picking the best moments of a recording, and grouping a long one into chapters.
 *
 * The AI only reads the transcript and quotes what it picks. Everything after that is
 * plain code: each quote is found in the transcript word for word (a quote that is not
 * there is dropped, never guessed at), and the clip's edges are set from the words' own
 * timestamps, snapped to the start and end of a sentence or word, with the padding the
 * team set. So a clip never starts or ends half way through a word.
 */
import { getPlatform } from "./clips";

/** One spoken word with when it starts and ends, in seconds. */
export interface Word {
  text: string;
  start: number;
  end: number;
}

/**
 * The words of a toolkit transcript made with word timestamps (`segments[].words[]`,
 * each `{ word, start, end }`), in order. Anything unreadable is left out.
 */
export function wordsFromSegments(segments: unknown): Word[] {
  if (!Array.isArray(segments)) return [];
  const words: Word[] = [];
  for (const segment of segments) {
    const list = (segment as { words?: unknown } | null)?.words;
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const raw = item as { word?: unknown; start?: unknown; end?: unknown } | null;
      const text = typeof raw?.word === "string" ? raw.word.trim() : "";
      const start = Number(raw?.start);
      const end = Number(raw?.end);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue;
      // Times only go forward; a word the model placed back in time is moved to follow.
      const last = words[words.length - 1];
      const from = last ? Math.max(start, last.start) : Math.max(0, start);
      words.push({ text, start: round3(from), end: round3(Math.max(end, from)) });
    }
  }
  return words;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** A word reduced to its letters and digits, lower case, for matching a quote. */
export function wordKey(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function quoteKeys(quote: string): string[] {
  return quote
    .split(/\s+/)
    .map(wordKey)
    .filter((key) => key !== "");
}

/**
 * Where a quote is said in the transcript, word for word (case and punctuation aside):
 * the index of its first and last word. Null when it is not there exactly. `from` skips
 * the words before it.
 */
export function findQuote(
  words: Word[],
  quote: string,
  from = 0,
): { first: number; last: number } | null {
  return findQuotes(words, quote, from, 1)[0] ?? null;
}

/** Every place a quote is said, word for word, in order (at most `limit`). */
export function findQuotes(
  words: Word[],
  quote: string,
  from = 0,
  limit = Infinity,
): { first: number; last: number }[] {
  const keys = quoteKeys(quote);
  const found: { first: number; last: number }[] = [];
  if (keys.length === 0) return found;
  const spoken = words.map((word) => wordKey(word.text));
  outer: for (let i = Math.max(0, from); i + keys.length <= spoken.length; i++) {
    for (let k = 0; k < keys.length; k++) {
      if (spoken[i + k] !== keys[k]) continue outer;
    }
    found.push({ first: i, last: i + keys.length - 1 });
    if (found.length >= limit) break;
  }
  return found;
}

/**
 * Where a pick is said: from its start words to its end words when it gives both, else
 * its whole quote. When the start words are said more than once, the first place
 * followed by the end words within the longest clip wins, then the first place followed
 * by them at all. Null when it is not in the transcript word for word.
 */
export function findPick(
  words: Word[],
  pick: Pick<MomentPick, "quote" | "start" | "end">,
  maxSeconds = Infinity,
): { first: number; last: number } | null {
  const start = pick.start?.trim() ?? "";
  const end = pick.end?.trim() ?? "";
  if (start && end) {
    let fallback: { first: number; last: number } | null = null;
    for (const opening of findQuotes(words, start)) {
      const closing = findQuote(words, end, opening.first);
      if (!closing) continue;
      const span = { first: opening.first, last: Math.max(opening.last, closing.last) };
      if (words[span.last].end - words[span.first].start <= maxSeconds) return span;
      fallback ??= span;
    }
    if (fallback) return fallback;
  }
  return pick.quote.trim() ? findQuote(words, pick.quote) : null;
}

// A pause this long between two words also ends a sentence, for speech with no full stops.
const SENTENCE_PAUSE = 1.2;

function endsSentence(words: Word[], index: number): boolean {
  if (index >= words.length - 1) return true;
  if (/[.!?…]["'”’)]*$/.test(words[index].text)) return true;
  return words[index + 1].start - words[index].end >= SENTENCE_PAUSE;
}

/** Where each sentence of the transcript starts and ends, as word indexes. */
export function sentencesOf(words: Word[]): { first: number; last: number }[] {
  const sentences: { first: number; last: number }[] = [];
  let first = 0;
  for (let i = 0; i < words.length; i++) {
    if (endsSentence(words, i)) {
      sentences.push({ first, last: i });
      first = i + 1;
    }
  }
  return sentences;
}

/** "1:05", "12:40", "1:02:03". */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// The longest transcript sent to the model, in characters (about two and a half hours).
export const MAX_TRANSCRIPT_CHARS = 180_000;

/**
 * The transcript as the model reads it: one sentence a line, each with the time it
 * starts, "[1:05] And that is when it clicked.". Long sentences are split so a line stays
 * readable.
 */
export function transcriptText(words: Word[], maxWordsPerLine = 40): string {
  const lines: string[] = [];
  for (const sentence of sentencesOf(words)) {
    for (let i = sentence.first; i <= sentence.last; i += maxWordsPerLine) {
      const last = Math.min(sentence.last, i + maxWordsPerLine - 1);
      const text = words
        .slice(i, last + 1)
        .map((word) => word.text)
        .join(" ");
      lines.push(`[${clock(words[i].start)}] ${text}`);
    }
  }
  const text = lines.join("\n");
  return text.length > MAX_TRANSCRIPT_CHARS ? text.slice(0, MAX_TRANSCRIPT_CHARS) : text;
}

// ---------------------------------------------------------------------------------------
// Best moments

export const MOMENT_EDGES = ["sentence", "word"] as const;
export type MomentEdges = (typeof MOMENT_EDGES)[number];

export const MAX_MOMENTS = 20;
export const MAX_PADDING = 2;

export interface MomentSettings {
  platform: string;
  count: number;
  minSeconds: number;
  maxSeconds: number;
  /** Subjects to favour, in the team's words. */
  topics: string;
  /** What makes a good moment for this team, in their words. */
  lookFor: string;
  /** Seconds of room kept before the first word and after the last. */
  padding: number;
  /** Whether each clip starts and ends on a whole sentence or only on a whole word. */
  edges: MomentEdges;
  /** Leave out moments already picked from the same video by an earlier run. */
  skipPicked: boolean;
}

export const MOMENT_DEFAULTS: Omit<MomentSettings, "platform"> = {
  count: 5,
  minSeconds: 15,
  maxSeconds: 60,
  topics: "",
  lookFor: "",
  padding: 0.25,
  edges: "sentence",
  skipPicked: true,
};

function numberOr(value: unknown, fallback: number): number {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : fallback;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * A step's saved settings as the picker uses them: defaults for what is blank, and every
 * number kept in range. The longest clip never goes past what the platform takes.
 */
export function momentSettings(input: Record<string, unknown>): MomentSettings {
  const platform = getPlatform(input.platform);
  const limit = platform?.maxSeconds ?? 180;
  const floor = platform?.minSeconds ?? 1;
  const maxSeconds = clamp(numberOr(input.maxSeconds, MOMENT_DEFAULTS.maxSeconds), floor, limit);
  const minSeconds = clamp(
    numberOr(input.minSeconds, MOMENT_DEFAULTS.minSeconds),
    floor,
    maxSeconds,
  );
  return {
    platform: platform?.name ?? "",
    count: Math.round(clamp(numberOr(input.count, MOMENT_DEFAULTS.count), 1, MAX_MOMENTS)),
    minSeconds,
    maxSeconds,
    topics: typeof input.topics === "string" ? input.topics.trim().slice(0, 500) : "",
    lookFor: typeof input.lookFor === "string" ? input.lookFor.trim().slice(0, 1000) : "",
    padding: clamp(numberOr(input.padding, MOMENT_DEFAULTS.padding), 0, MAX_PADDING),
    edges: input.edges === "word" ? "word" : "sentence",
    skipPicked: input.skipPicked !== false,
  };
}

/** What the model hands back for one moment. */
export interface MomentPick {
  /**
   * The moment's words, exactly as said, from its first word to its last. Older answers
   * give only this; on a long transcript models tend to quote just the opening line.
   */
  quote: string;
  /** The moment's first few words, exactly as said. With `end`, it marks the clip. */
  start?: string;
  /** The moment's last few words, exactly as said. */
  end?: string;
  title: string;
  why: string;
}

/** A moment that was found in the transcript, with the clip's edges. */
export interface Moment {
  start: number;
  end: number;
  title: string;
  why: string;
  /** The words of the clip, from the transcript. */
  text: string;
}

export interface MomentPlan {
  moments: Moment[];
  /** How many picks were left out, and why. */
  dropped: { notInTranscript: number; wrongLength: number; overlapping: number };
}

/** A stretch of the video already used, which a new moment may not overlap. */
export interface Span {
  start: number;
  end: number;
}

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

/**
 * Where a clip from word `first` to word `last` starts and ends. With sentence edges it
 * grows to the start and end of the sentences it touches, as far as the longest clip
 * allows. Padding adds a little room at each end but never reaches into the word before
 * or after, so no clip starts or ends on part of a word.
 */
export function snapMoment(
  words: Word[],
  span: { first: number; last: number },
  settings: Pick<MomentSettings, "padding" | "edges" | "maxSeconds">,
  duration?: number,
): { first: number; last: number; start: number; end: number } {
  let { first, last } = span;
  if (settings.edges === "sentence") {
    const sentences = sentencesOf(words);
    const opening = sentences.find((s) => s.first <= first && first <= s.last);
    const closing = sentences.find((s) => s.first <= last && last <= s.last);
    if (opening && words[last].end - words[opening.first].start <= settings.maxSeconds) {
      first = opening.first;
    }
    if (closing && words[closing.last].end - words[first].start <= settings.maxSeconds) {
      last = closing.last;
    }
  }
  const before = first > 0 ? words[first - 1].end : 0;
  const after = last < words.length - 1 ? words[last + 1].start : (duration ?? Infinity);
  const start = Math.max(before, 0, words[first].start - settings.padding);
  let end = Math.min(after, words[last].end + settings.padding);
  if (duration !== undefined) end = Math.min(end, duration);
  return { first, last, start: round3(start), end: round3(Math.max(end, words[last].end)) };
}

/**
 * Turns the model's picks into clips: each quote found word for word, its edges snapped,
 * and kept only when it fits the length asked for and does not overlap a moment already
 * kept or one in `avoid`. The model's order is kept (its best first), up to the count.
 */
export function planMoments(
  words: Word[],
  picks: MomentPick[],
  settings: MomentSettings,
  avoid: Span[] = [],
  duration?: number,
): MomentPlan {
  const dropped = { notInTranscript: 0, wrongLength: 0, overlapping: 0 };
  const moments: Moment[] = [];
  // A little slack so rounding never drops a clip that is a hair over.
  const slack = 0.05;
  for (const pick of picks) {
    if (moments.length >= settings.count) break;
    const found = findPick(words, pick, settings.maxSeconds);
    if (!found) {
      dropped.notInTranscript++;
      continue;
    }
    const snapped = snapMoment(words, found, settings, duration);
    const seconds = snapped.end - snapped.start;
    if (seconds > settings.maxSeconds + slack || seconds < settings.minSeconds - slack) {
      dropped.wrongLength++;
      continue;
    }
    const span = { start: snapped.start, end: snapped.end };
    if ([...avoid, ...moments].some((other) => overlaps(span, other))) {
      dropped.overlapping++;
      continue;
    }
    moments.push({
      ...span,
      title: pick.title.trim().slice(0, 120) || `Moment ${moments.length + 1}`,
      why: pick.why.trim().slice(0, 300),
      text: words
        .slice(snapped.first, snapped.last + 1)
        .map((word) => word.text)
        .join(" "),
    });
  }
  return { moments, dropped };
}

/** "2 picks were left out: 1 was not said word for word, 1 overlapped another." */
export function droppedWords(dropped: MomentPlan["dropped"]): string | null {
  const parts: string[] = [];
  if (dropped.notInTranscript) {
    parts.push(`${dropped.notInTranscript} did not match the transcript word for word`);
  }
  if (dropped.wrongLength) parts.push(`${dropped.wrongLength} came out too long or too short`);
  if (dropped.overlapping) parts.push(`${dropped.overlapping} overlapped another moment`);
  const total = dropped.notInTranscript + dropped.wrongLength + dropped.overlapping;
  if (total === 0) return null;
  return `${total} ${total === 1 ? "pick was" : "picks were"} left out: ${joinAnd(parts)}.`;
}

function joinAnd(parts: string[]): string {
  return parts.length < 2
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The address of a file without its query, so a fresh signed link to it still matches. */
export function sourceKey(url: string): string {
  return url.split(/[?#]/)[0];
}

// ---------------------------------------------------------------------------------------
// Chapters

export const MAX_CHAPTERS = 30;
// YouTube asks for chapters of at least 10 seconds, the first at 0:00.
export const MIN_CHAPTER_SECONDS = 10;

export interface ChapterSettings {
  /** How many chapters at most; 0 lets the model decide from the video. */
  count: number;
  /** Bullets of show notes under each chapter. */
  bullets: number;
}

export function chapterSettings(input: Record<string, unknown>): ChapterSettings {
  return {
    count: Math.round(clamp(numberOr(input.count, 0), 0, MAX_CHAPTERS)),
    bullets: Math.round(clamp(numberOr(input.bullets, 3), 0, 6)),
  };
}

/** What the model hands back for one chapter. */
export interface ChapterPick {
  title: string;
  /** The first words of the chapter, exactly as said. */
  opening: string;
  bullets: string[];
}

export interface Chapter {
  start: number;
  title: string;
  bullets: string[];
}

/**
 * Places the model's chapters on the timeline: each one starts at the sentence its
 * opening words are in, found word for word after the chapter before. A chapter whose
 * opening is not in the transcript, or that starts too soon after the last, is left out.
 * The first always starts at 0:00.
 */
export function planChapters(
  words: Word[],
  picks: ChapterPick[],
  settings: ChapterSettings,
  duration?: number,
): { chapters: Chapter[]; dropped: number } {
  const sentences = sentencesOf(words);
  const chapters: Chapter[] = [];
  let dropped = 0;
  let from = 0;
  const limit = settings.count > 0 ? settings.count : MAX_CHAPTERS;
  for (const pick of picks) {
    if (chapters.length >= limit) break;
    const clean = {
      title: pick.title.trim().slice(0, 100),
      bullets: pick.bullets
        .map((bullet) => bullet.trim().slice(0, 300))
        .filter(Boolean)
        .slice(0, settings.bullets),
    };
    if (!clean.title) {
      dropped++;
      continue;
    }
    if (chapters.length === 0) {
      chapters.push({ start: 0, ...clean });
      const found = findQuote(words, pick.opening);
      if (found) from = found.first + 1;
      continue;
    }
    const found = findQuote(words, pick.opening, from);
    if (!found) {
      dropped++;
      continue;
    }
    const sentence = sentences.find((s) => s.first <= found.first && found.first <= s.last);
    const start = words[sentence ? Math.max(sentence.first, from) : found.first].start;
    const previous = chapters[chapters.length - 1];
    const tooLate = duration !== undefined && duration - start < MIN_CHAPTER_SECONDS;
    if (start - previous.start < MIN_CHAPTER_SECONDS || tooLate) {
      dropped++;
      continue;
    }
    chapters.push({ start: round3(start), ...clean });
    from = found.first + 1;
  }
  return { chapters, dropped };
}

/** The chapter list as YouTube reads it in a description: "0:00 Welcome". */
export function youtubeChapters(chapters: Chapter[]): string {
  return chapters.map((chapter) => `${clock(chapter.start)} ${chapter.title}`).join("\n");
}

/** Show notes in Markdown: a heading per chapter with its time and bullets. */
export function showNotes(chapters: Chapter[], title?: string): string {
  const parts = title ? [`# ${title}`, ""] : [];
  for (const chapter of chapters) {
    parts.push(`## ${clock(chapter.start)} ${chapter.title}`);
    for (const bullet of chapter.bullets) parts.push(`- ${bullet}`);
    parts.push("");
  }
  return parts.join("\n").trimEnd() + "\n";
}

/**
 * Reads the model's answer, which should be JSON, sometimes wrapped in a code fence or
 * a sentence. Null when no JSON object is in it.
 */
export function readModelJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    // Sometimes the model answers, then adds a note or a corrected answer after it.
    // The last whole object that reads is its final word.
    const objects = jsonObjectsIn(body);
    for (let i = objects.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(objects[i]);
      } catch {
        // Not JSON after all; try the one before.
      }
    }
    return null;
  }
}

/** Each top-level {...} in a text, braces inside strings aside. */
function jsonObjectsIn(text: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let opened = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"' && depth > 0) inString = true;
    else if (char === "{") {
      if (depth === 0) opened = i;
      depth++;
    } else if (char === "}" && depth > 0) {
      depth--;
      if (depth === 0) found.push(text.slice(opened, i + 1));
    }
  }
  return found;
}

const str = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

/** The moments in a model answer, keeping only well-formed ones. */
export function momentPicksFrom(answer: unknown): MomentPick[] {
  const list = (answer as { moments?: unknown } | null)?.moments;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      const raw = item as { quote?: unknown; start?: unknown; end?: unknown } | null;
      const start = str(raw?.start, 1000);
      const end = str(raw?.end, 1000);
      return {
        quote: str(raw?.quote, 8000),
        ...(start.trim() ? { start } : {}),
        ...(end.trim() ? { end } : {}),
        title: str((item as { title?: unknown })?.title, 200),
        why: str((item as { why?: unknown })?.why, 500),
      };
    })
    .filter((pick) => pick.quote.trim() !== "" || (pick.start && pick.end))
    .slice(0, MAX_MOMENTS * 2);
}

/** The chapters in a model answer, keeping only well-formed ones. */
export function chapterPicksFrom(answer: unknown): ChapterPick[] {
  const list = (answer as { chapters?: unknown } | null)?.chapters;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      const raw = item as { title?: unknown; opening?: unknown; bullets?: unknown } | null;
      return {
        title: str(raw?.title, 200),
        opening: str(raw?.opening, 1000),
        bullets: Array.isArray(raw?.bullets)
          ? raw.bullets.map((bullet) => str(bullet, 400)).filter(Boolean)
          : [],
      };
    })
    .slice(0, MAX_CHAPTERS * 2);
}
