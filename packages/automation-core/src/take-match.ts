/**
 * Matching recorded takes to the lines of a storyboard by what was said, and picking the
 * best take when a line was said more than once. Plain rules, no AI: each line is compared
 * word by word with every stretch of one to three sentences in the recordings, the way
 * script-sync tools line a script up with its takes. Of the takes that say the line, the
 * one closest to the words wins; when takes are about as close, the later one wins, since
 * the last good take of a line is usually the one the person meant to keep.
 */
import { sentencesOf, type Word, wordKey } from "./moments";

/** A recording to look for takes in: its words, in order, with their timings. */
export interface TakeRecording {
  id: string;
  words: Word[];
  /** How long the recording is, so no clip runs past its end. */
  length?: number;
}

/** A take found for a line: where it is said, and how close it is to the line's words. */
export interface MatchedTake {
  /** The line's place in the list given, from 0. */
  line: number;
  recording: string;
  start: number;
  end: number;
  /** How close the words are, from 0 to 1. */
  score: number;
  /** How many takes of the line were found, the picked one included. */
  takes: number;
}

/** How close a take must be to count as the line: most of its words, in order. */
export const MATCH_AT_LEAST = 0.6;
/** Takes this close to the best one count as just as good, and the later of them wins. */
const ABOUT_AS_GOOD = 0.05;
/** Each "um" or "uh" in a take counts this much against it. */
const PER_FILLER = 0.03;
/** At most this many sentences make one take: a line can be a few sentences long. */
const MOST_SENTENCES = 3;
/** Only the stretches sharing the most words with a line are compared word by word. */
const COMPARED = 24;

const LEAD = 0.08;
const TAIL = 0.15;
const FILLERS = new Set(["um", "uh", "er", "erm", "ah", "uhm", "hmm", "mm"]);

const keysOf = (text: string) =>
  text
    .split(/\s+/)
    .map(wordKey)
    .filter((key) => key !== "");

/** The longest run of words two takes share in order, as a share of both their lengths. */
export function closeness(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      row[j] = a[i - 1] === b[j - 1] ? previous[j - 1]! + 1 : Math.max(previous[j]!, row[j - 1]!);
    }
    previous = row;
  }
  return (2 * previous[b.length]!) / (a.length + b.length);
}

type Stretch = {
  recording: number;
  first: number;
  last: number;
  keys: string[];
  fillers: number;
  start: number;
  end: number;
};

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Every stretch of one to three sentences in the recordings, filler words set apart. */
function stretchesOf(recordings: TakeRecording[]): Stretch[] {
  const stretches: Stretch[] = [];
  recordings.forEach((recording, index) => {
    const { words } = recording;
    const sentences = sentencesOf(words);
    const end = recording.length && recording.length > 0 ? recording.length : Infinity;
    for (let at = 0; at < sentences.length; at++) {
      for (let size = 1; size <= MOST_SENTENCES && at + size <= sentences.length; size++) {
        const first = sentences[at]!.first;
        const last = sentences[at + size - 1]!.last;
        const said = words.slice(first, last + 1).map((word) => wordKey(word.text));
        const keys = said.filter((key) => key !== "" && !FILLERS.has(key));
        if (keys.length === 0) continue;
        stretches.push({
          recording: index,
          first,
          last,
          keys,
          fillers: said.length - keys.length - said.filter((key) => key === "").length,
          start: round3(Math.max(0, words[first]!.start - LEAD)),
          end: round3(Math.min(end, words[last]!.end + TAIL)),
        });
      }
    }
  });
  return stretches;
}

/**
 * The best take of each line that was said, by line. Lines nobody said are left out. A
 * stretch of a recording is used for one line at most, the line it matches best.
 */
export function matchTakes(lines: string[], recordings: TakeRecording[]): MatchedTake[] {
  const stretches = stretchesOf(recordings);
  // Which stretches hold each word, to find the few worth comparing word by word.
  const holding = new Map<string, number[]>();
  stretches.forEach((stretch, index) => {
    for (const key of new Set(stretch.keys)) {
      const list = holding.get(key);
      if (list) list.push(index);
      else holding.set(key, [index]);
    }
  });

  type Found = { stretch: number; score: number; quality: number };
  const wanted = lines.map((line) => keysOf(line).filter((key) => !FILLERS.has(key)));
  const found: Found[][] = wanted.map((keys) => {
    if (keys.length === 0) return [];
    const shared = new Map<number, number>();
    for (const key of new Set(keys)) {
      for (const index of holding.get(key) ?? []) shared.set(index, (shared.get(index) ?? 0) + 1);
    }
    const distinct = new Set(keys).size;
    return [...shared.entries()]
      .filter(([, count]) => count / distinct >= MATCH_AT_LEAST * 0.75)
      .sort((a, b) => b[1] - a[1])
      .slice(0, COMPARED * 4)
      .map(([index]) => {
        const score = closeness(keys, stretches[index]!.keys);
        return {
          stretch: index,
          score,
          quality: score - PER_FILLER * stretches[index]!.fillers,
        };
      })
      .filter((one) => one.score >= MATCH_AT_LEAST);
  });

  // The lines matched most surely pick first, so a near miss never takes another line's take.
  const order = found
    .map((candidates, line) => ({ line, best: Math.max(0, ...candidates.map((one) => one.score)) }))
    .filter((one) => one.best > 0)
    .sort((a, b) => b.best - a.best);
  const used: { recording: number; first: number; last: number }[] = [];
  const overlaps = (stretch: Stretch) =>
    used.some(
      (one) =>
        one.recording === stretch.recording &&
        one.first <= stretch.last &&
        stretch.first <= one.last,
    );
  const matched: MatchedTake[] = [];
  for (const { line } of order) {
    const free = found[line]!.filter((one) => !overlaps(stretches[one.stretch]!));
    if (free.length === 0) continue;
    const top = Math.max(...free.map((one) => one.quality));
    // Of the takes about as good as the best, the last one said.
    const pick = free
      .filter((one) => one.quality >= top - ABOUT_AS_GOOD)
      .sort((a, b) => {
        const x = stretches[a.stretch]!;
        const y = stretches[b.stretch]!;
        return y.recording - x.recording || y.start - x.start;
      })[0]!;
    const stretch = stretches[pick.stretch]!;
    used.push(stretch);
    // Each time the line was said counts once: the closest stretches that do not overlap.
    const counted: Stretch[] = [];
    for (const one of [...found[line]!].sort((a, b) => b.score - a.score)) {
      const each = stretches[one.stretch]!;
      const clash = counted.some(
        (other) =>
          other.recording === each.recording &&
          other.first <= each.last &&
          each.first <= other.last,
      );
      if (!clash) counted.push(each);
    }
    matched.push({
      line,
      recording: recordings[stretch.recording]!.id,
      start: stretch.start,
      end: stretch.end,
      score: Math.round(pick.score * 100) / 100,
      takes: counted.length,
    });
  }
  return matched.sort((a, b) => a.line - b.line);
}
