import type { SpokenWord } from "./define";

/**
 * Finding where a paid creator says their video is an ad ("this is a paid partnership
 * with Boots", "#ad", "thanks to Boots for sponsoring this"), so every shorter cut and
 * every swapped hook keeps that line. The FTC wants a paid creator's ad to say so in the
 * video itself; a 6 second cut of the first seconds would otherwise lose it. Plain rules
 * on the transcript, no AI.
 */

/** Where a disclosure is said in a file, and what is said. */
export interface Disclosure {
  start: number;
  end: number;
  text: string;
}

/** The choices for whether a step keeps the disclosure. */
export const DISCLOSURE_CHOICES = ["Keep it in every cut", "Off"] as const;
export const KEEP_DISCLOSURE = DISCLOSURE_CHOICES[0];

/** A disclosure longer than this is cut down to the words around what gave it away. */
export const MAX_DISCLOSURE_SECONDS = 8;

/** Words that say a video is paid for, as they are heard (lower case, no punctuation). */
const CUES: string[][] = [
  ["paid", "partnership"],
  ["paid", "partner"],
  ["paid", "promotion"],
  ["paid", "ad"],
  ["paid", "advertisement"],
  ["paid", "me"],
  ["paid", "by"],
  ["paying", "me"],
  ["sponsored"],
  ["sponsor"],
  ["sponsoring"],
  ["sponsorship"],
  ["advertisement"],
  ["hashtag", "ad"],
  ["hashtag", "sponsored"],
  ["hashtag", "partner"],
  ["hashtag", "paid"],
  ["hashtag", "gifted"],
  ["is", "an", "ad"],
  ["its", "an", "ad"],
  ["an", "ad", "for"],
  ["in", "partnership", "with"],
  ["partnership", "with"],
  ["partnered", "with"],
  ["partnering", "with"],
  ["brand", "partner"],
  ["brand", "partnership"],
  ["gifted"],
  ["affiliate"],
];

/** Written tags, as a transcript sometimes has them: "#ad", "#sponsored". */
const TAGS = new Set(["#ad", "#ads", "#sponsored", "#paid", "#partner", "#gifted", "#paidpartner"]);

/** A word as it is matched: lower case letters and digits only. */
export function plainWord(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

const tagOf = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}#]+/gu, "");
const endsSentence = (text: string) => /[.!?…]["')\]]*$/.test(text.trim());

/** Where `cue` is said in `keys`, from index `from`, or -1. */
function findCue(keys: string[], cue: string[], from = 0): number {
  for (let at = from; at + cue.length <= keys.length; at++) {
    if (cue.every((word, offset) => keys[at + offset] === word)) return at;
  }
  return -1;
}

/**
 * Where what the team typed is said: the stretch of words that best matches it, when at
 * least two thirds of its words are heard in order. [first, last] word indexes, or null.
 */
function findSaid(keys: string[], said: string): [number, number] | null {
  const wanted = said.split(/\s+/).map(plainWord).filter(Boolean);
  if (wanted.length === 0) return null;
  let best: { score: number; first: number; last: number } | null = null;
  const reach = wanted.length + Math.ceil(wanted.length / 3);
  for (let start = 0; start < keys.length; start++) {
    if (keys[start] !== wanted[0] && keys[start] !== wanted[1]) continue;
    let matched = 0;
    let next = 0;
    let last = start;
    for (let at = start; at < Math.min(keys.length, start + reach) && next < wanted.length; at++) {
      const found = wanted.indexOf(keys[at], next);
      if (found === -1) continue;
      matched += 1;
      next = found + 1;
      last = at;
    }
    const score = matched / wanted.length;
    if (!best || score > best.score) best = { score, first: start, last };
  }
  return best && best.score >= 2 / 3 ? [best.first, best.last] : null;
}

/**
 * Widens a match out to its whole sentence: back to where the sentence starts and on to
 * where it ends, stopping at a long pause, and never longer than MAX_DISCLOSURE_SECONDS.
 */
function wholeSentence(words: SpokenWord[], first: number, last: number): [number, number] {
  const gap = 0.6;
  while (
    first > 0 &&
    !endsSentence(words[first - 1].text) &&
    words[first].start - words[first - 1].end < gap &&
    words[last].end - words[first - 1].start <= MAX_DISCLOSURE_SECONDS
  ) {
    first -= 1;
  }
  while (
    last < words.length - 1 &&
    !endsSentence(words[last].text) &&
    words[last + 1].start - words[last].end < gap &&
    words[last + 1].end - words[first].start <= MAX_DISCLOSURE_SECONDS
  ) {
    last += 1;
  }
  return [first, last];
}

/**
 * Where the paid-ad disclosure is said in a file's words, as the whole sentence it is in,
 * with a breath either side that never reaches into the next word. `said` is how the team
 * wrote it, for a creator who words it their own way; without it, or when it is not
 * heard, the usual ways of saying it are looked for. Null when none is said.
 */
export function findDisclosure(words: SpokenWord[], said?: string): Disclosure | null {
  if (words.length === 0) return null;
  const keys = words.map((word) => plainWord(word.text));
  let match = said?.trim() ? findSaid(keys, said) : null;
  if (!match) {
    let earliest: [number, number] | null = null;
    for (const cue of CUES) {
      const at = findCue(keys, cue);
      if (at !== -1 && (!earliest || at < earliest[0])) earliest = [at, at + cue.length - 1];
    }
    const tagged = words.findIndex((word) => TAGS.has(tagOf(word.text)));
    if (tagged !== -1 && (!earliest || tagged < earliest[0])) earliest = [tagged, tagged];
    match = earliest;
  }
  if (!match) return null;
  const [first, last] = wholeSentence(words, match[0], match[1]);
  const before = words[first - 1];
  const after = words[last + 1];
  const breath = 0.15;
  const start = Math.max(before ? before.end : 0, words[first].start - breath, 0);
  const end = after ? Math.min(after.start, words[last].end + breath) : words[last].end + breath;
  return {
    start: round(start),
    end: round(Math.max(end, start + 0.1)),
    text: words
      .slice(first, last + 1)
      .map((word) => word.text.trim())
      .join(" "),
  };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** A stretch of one input, as variant steps cut them. */
interface Stretch {
  input: number;
  start?: number;
  end?: number;
}

/** Whether `pieces` already hold all of `keep`, from the same input. */
export function holdsDisclosure(
  pieces: Stretch[],
  keep: { input: number; start: number; end: number },
): boolean {
  return pieces.some(
    (piece) =>
      piece.input === keep.input &&
      (piece.start ?? 0) <= keep.start + 0.05 &&
      (piece.end ?? Number.POSITIVE_INFINITY) >= keep.end - 0.05,
  );
}

/**
 * `pieces` with `keep` added: at `at` (an index), or among the other pieces of its input
 * in time order when `at` is "in order". Pieces of the same input that overlap it give up
 * the overlap, so nothing is said twice.
 */
export function withDisclosure<T extends Stretch>(
  pieces: T[],
  keep: { input: number; start: number; end: number },
  at: number | "in order",
): Stretch[] {
  const trimmed: Stretch[] = [];
  for (const piece of pieces) {
    if (piece.input !== keep.input) {
      trimmed.push(piece);
      continue;
    }
    const start = piece.start ?? 0;
    const end = piece.end ?? Number.POSITIVE_INFINITY;
    if (end <= keep.start || start >= keep.end) {
      trimmed.push(piece);
      continue;
    }
    if (start < keep.start) trimmed.push({ ...piece, end: keep.start });
    if (end > keep.end) trimmed.push({ ...piece, start: keep.end });
  }
  const added = { input: keep.input, start: keep.start, end: keep.end };
  if (at !== "in order") {
    const index = Math.min(at, trimmed.length);
    return [...trimmed.slice(0, index), added, ...trimmed.slice(index)];
  }
  const index = trimmed.findIndex(
    (piece) => piece.input === keep.input && (piece.start ?? 0) >= keep.end,
  );
  return index === -1
    ? [...trimmed, added]
    : [...trimmed.slice(0, index), added, ...trimmed.slice(index)];
}
