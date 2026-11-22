/**
 * A storyboard drafted from an upload's transcript, by plain rules and no AI: a line for
 * every sentence said, each with the stretch of the recording it is said in, so every
 * line comes with its own clip. Lines said again are kept only as their last take, the
 * way Clean Up Pauses And Retakes keeps them, and the pauses between lines fall away
 * because each clip holds only its own sentence. A long pause, or a spoken marker such as
 * "next", "step two" or "moving on", starts a new chapter.
 */
import { findRetakes } from "./cleanup";
import { sentencesOf, type Word, wordKey } from "./moments";

/** One line of the draft and the stretch of the recording it is said in, in seconds. */
export interface DraftTake {
  line: string;
  start: number;
  end: number;
}

export interface DraftChapter {
  title: string;
  takes: DraftTake[];
}

export interface StoryboardDraft {
  chapters: DraftChapter[];
  /** How many lines said again were left out, so the person knows what was dropped. */
  retakesDropped: number;
}

export const DRAFT_LIMITS = { chapters: 60, takes: 400, line: 2000, title: 120 };

// Speech is kept from just before its first word to just after its last, as Clean Up does.
const LEAD = 0.08;
const TAIL = 0.15;
// A silence at least this long before a sentence starts a new chapter.
export const CHAPTER_PAUSE = 4;
// A chapter has at least this many lines before a spoken marker starts the next one, so a
// "next" said in passing does not leave a chapter of one line.
const MIN_CHAPTER_TAKES = 3;
// Words a chapter's name is made from: the start of its first line.
const TITLE_WORDS = 8;

const NUMBERS = new Set([
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "final",
  "last",
]);

/** Whether a sentence opens with a spoken marker of a new part of the talk. */
export function opensTopic(keys: string[]): boolean {
  const [a, b, c] = keys;
  if (!a) return false;
  if (a === "next" || a === "nextup") return true;
  if (["step", "part", "chapter", "section", "lesson", "tip"].includes(a)) {
    return !!b && (NUMBERS.has(b) || /^\d+$/.test(b) || (b === "number" && !!c));
  }
  if (a === "moving" && b === "on") return true;
  if ((a === "lets" || a === "let") && (b === "move" || b === "talk" || b === "look")) return true;
  if (a === "let" && b === "us" && (c === "move" || c === "talk" || c === "look")) return true;
  if (a === "now" && (b === "lets" || b === "let")) return true;
  if (a === "so" && b === "now" && (c === "lets" || c === "let")) return true;
  if (["finally", "lastly"].includes(a)) return true;
  return false;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

function titleFrom(line: string): string {
  const words = line.split(/\s+/).filter(Boolean);
  const head = words
    .slice(0, TITLE_WORDS)
    .join(" ")
    .replace(/[\s.,;:!?…-]+$/u, "");
  const title = words.length > TITLE_WORDS ? `${head}…` : head;
  return title.slice(0, DRAFT_LIMITS.title) || "Chapter";
}

/** Joins neighbouring lines of each chapter so the whole draft has at most `limit` lines. */
function fitTakes(chapters: DraftChapter[], limit: number): DraftChapter[] {
  const total = chapters.reduce((sum, chapter) => sum + chapter.takes.length, 0);
  if (total <= limit) return chapters;
  const group = Math.ceil(total / limit);
  let kept = chapters.map((chapter) => {
    const takes: DraftTake[] = [];
    for (let at = 0; at < chapter.takes.length; at += group) {
      const run = chapter.takes.slice(at, at + group);
      takes.push({
        line: run
          .map((take) => take.line)
          .join(" ")
          .slice(0, DRAFT_LIMITS.line),
        start: run[0]!.start,
        end: run[run.length - 1]!.end,
      });
    }
    return { ...chapter, takes };
  });
  // Each chapter rounds up, so a few may still be over; the last lines go, never a chapter.
  let over = kept.reduce((sum, chapter) => sum + chapter.takes.length, 0) - limit;
  kept = kept.map((chapter) => {
    if (over <= 0 || chapter.takes.length <= 1) return chapter;
    const cut = Math.min(over, chapter.takes.length - 1);
    over -= cut;
    return { ...chapter, takes: chapter.takes.slice(0, chapter.takes.length - cut) };
  });
  return kept;
}

/**
 * Drafts a storyboard from the words of a recording. Empty when nothing is said in it.
 * `length` is how long the recording is, so no clip runs past its end.
 */
export function draftStoryboard(words: Word[], length?: number): StoryboardDraft {
  const dropped = new Array<boolean>(words.length).fill(false);
  const retakes = findRetakes(words);
  for (const retake of retakes) {
    for (let at = retake.first; at <= retake.last; at++) dropped[at] = true;
  }
  // The words kept, each with its place in the whole recording.
  const keptAt: number[] = [];
  for (let at = 0; at < words.length; at++) if (!dropped[at]) keptAt.push(at);
  const kept = keptAt.map((at) => words[at]!);
  const end = length && length > 0 ? length : Infinity;

  const chapters: DraftChapter[] = [];
  for (const sentence of sentencesOf(kept)) {
    const first = kept[sentence.first]!;
    const last = kept[sentence.last]!;
    const line = kept
      .slice(sentence.first, sentence.last + 1)
      .map((word) => word.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, DRAFT_LIMITS.line);
    if (!line) continue;
    // The silence before it in the recording itself, so a dropped retake is no pause.
    const before = keptAt[sentence.first]! - 1;
    const pause = before >= 0 ? first.start - words[before]!.end : 0;
    const keys = kept.slice(sentence.first, sentence.first + 3).map((word) => wordKey(word.text));
    const current = chapters[chapters.length - 1];
    const startsChapter =
      !current ||
      (chapters.length < DRAFT_LIMITS.chapters &&
        (pause >= CHAPTER_PAUSE ||
          (opensTopic(keys) && current.takes.length >= MIN_CHAPTER_TAKES)));
    const take: DraftTake = {
      line,
      start: round3(Math.max(0, first.start - LEAD)),
      end: round3(Math.min(end, last.end + TAIL)),
    };
    if (startsChapter) chapters.push({ title: titleFrom(line), takes: [take] });
    else current.takes.push(take);
  }
  // A chapter opening on a short line ("Next.") is named from its next line as well.
  for (const chapter of chapters) {
    const [one, two] = chapter.takes;
    if (one && two && one.line.split(/\s+/).length < 3) {
      chapter.title = titleFrom(`${one.line.replace(/[.!?…]+$/u, ",")} ${two.line}`);
    }
  }
  return {
    chapters: fitTakes(chapters, DRAFT_LIMITS.takes),
    retakesDropped: retakes.length,
  };
}
