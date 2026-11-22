/**
 * Captions in another language, with the word being said lit up (highlight, karaoke,
 * underline, one word at a time) like captions in the video's own language.
 *
 * The toolkit lights up words from the times it heard them, so it can only caption in the
 * language that was spoken. For another language the "Caption video" step does it itself:
 *
 * 1. The video's words and their times (heard once, kept for every later step).
 * 2. The words, cut into short lines, go to the model in one question. It translates each
 *    line and, with every translated word, names the spoken words it stands for (a word
 *    alignment, the way subtitlers and aligners such as SimAlign pair words up).
 * 3. Plain code times each translated word from the spoken words it stands for. The lit
 *    word only ever moves forward: where the new language puts words in another order (an
 *    adjective after its noun, the verb at the end), the words that would jump back share
 *    the time around them by length instead. A line the model gave no pairs for is shared
 *    out by length, start to end, so a line is never left untimed.
 * 4. The timed words become a caption file drawn the same way as the toolkit's own (same
 *    styles, colours, sizes and places), which is burned into the video.
 */
import { CAPTION_LANGUAGE_SETTING } from "./captions";
import type { Word } from "./moments";
import { languageOf } from "./translation";

/** The language a caption step captions in, when it is not the one spoken, else null. */
export function captionLanguageOf(input: Record<string, unknown>): string | null {
  const code = input[CAPTION_LANGUAGE_SETTING];
  if (typeof code !== "string") return null;
  return languageOf(code)?.code ?? null;
}

// Languages written without spaces between words: their words are joined as they are.
const NO_SPACES = new Set(["ja", "zh", "zh-tw", "yue", "th", "lo", "km", "my"]);

export function writtenWithoutSpaces(code: string): boolean {
  return NO_SPACES.has(code.trim().toLowerCase());
}

/**
 * Fonts the toolkit has for scripts its usual fonts cannot draw. A caption in Japanese in
 * Arial would show empty boxes, so the look's font gives way to one that has the letters.
 */
const SCRIPT_FONTS: Record<string, string> = {
  ja: "Noto Sans CJK JP",
  zh: "Noto Sans CJK SC",
  "zh-tw": "Noto Sans CJK TC",
  yue: "Noto Sans CJK TC",
  ko: "Noto Sans CJK KR",
  ar: "Noto Sans Arabic",
  fa: "Noto Sans Arabic",
  ur: "Noto Sans Arabic",
  ps: "Noto Sans Arabic",
  sd: "Noto Sans Arabic",
  ug: "Noto Sans Arabic",
  ku: "Noto Sans Arabic",
  hi: "Noto Sans Devanagari",
  mr: "Noto Sans Devanagari",
  ne: "Noto Sans Devanagari",
  bn: "Noto Sans Bengali",
  as: "Noto Sans Bengali",
  pa: "Noto Sans Gurmukhi",
  gu: "Noto Sans Gujarati",
  or: "Noto Sans Oriya",
  ta: "Noto Sans Tamil",
  te: "Noto Sans Telugu",
  kn: "Noto Sans Kannada",
  ml: "Noto Sans Malayalam",
  si: "Noto Sans Sinhala",
  th: "Noto Sans Thai",
  lo: "Noto Sans Lao",
  km: "Noto Sans Khmer",
  my: "Noto Sans Myanmar",
  he: "Noto Sans Hebrew",
  yi: "Noto Sans Hebrew",
  hy: "Noto Sans Armenian",
  ka: "Noto Sans Georgian",
  am: "Noto Sans Ethiopic",
  ti: "Noto Sans Ethiopic",
};

export function scriptFontFor(code: string): string | null {
  return SCRIPT_FONTS[code.trim().toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------------------
// 1. Lines to translate

// A line ends at the end of a sentence, at a pause this long, or at this many words.
const LINE_PAUSE_SECONDS = 0.7;
const LINE_WORDS = 18;
// Lines sent in one question: a long video is asked in several.
export const ALIGN_BATCH_LINES = 40;

/** The spoken words cut into short lines, by their places in `words`. */
export function spokenLines(words: Word[]): number[][] {
  const lines: number[][] = [];
  let current: number[] = [];
  words.forEach((word, index) => {
    const last = current[current.length - 1];
    if (last !== undefined && word.start - words[last]!.end > LINE_PAUSE_SECONDS) {
      lines.push(current);
      current = [];
    }
    current.push(index);
    if (/[.?!…。？！]["'”’)\]]*$/.test(word.text) || current.length >= LINE_WORDS) {
      lines.push(current);
      current = [];
    }
  });
  if (current.length > 0) lines.push(current);
  return lines;
}

// ---------------------------------------------------------------------------------------
// 2. The model's answer

/** One translated word, with the places (in its spoken line) of the words it stands for. */
export type AlignedWord = { t: string; src: number[] };

/**
 * Reads the model's answer: a JSON list with one entry per line, each a list of
 * [word, [numbers]] pairs. Null when it is not that, so the question can be asked again.
 * A word with numbers it could not have (past the line's end) keeps only the good ones.
 */
export function readAlignedLines(answer: string, sizes: number[]): AlignedWord[][] | null {
  const text = answer.trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== sizes.length) return null;
  const lines: AlignedWord[][] = [];
  for (const [index, line] of parsed.entries()) {
    if (!Array.isArray(line)) return null;
    const words: AlignedWord[] = [];
    for (const pair of line) {
      if (!Array.isArray(pair) || typeof pair[0] !== "string") return null;
      const t = pair[0].replace(/\s+/g, " ").trim();
      if (!t) continue;
      const numbers = Array.isArray(pair[1]) ? pair[1] : [];
      const src = [
        ...new Set(
          numbers.filter(
            (n): n is number => Number.isInteger(n) && n >= 0 && n < (sizes[index] ?? 0),
          ),
        ),
      ];
      words.push({ t, src });
    }
    lines.push(words);
  }
  return lines;
}

// ---------------------------------------------------------------------------------------
// 3. Timing

/** A translated word on the video's clock. */
export type TimedWord = { t: string; s: number; e: number };

// Every word is lit for at least this long, so none flashes by unread.
const MIN_WORD_SECONDS = 0.12;

const weight = (text: string) => Math.max([...text].length, 2);
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Times the translated words of one line from the spoken words they stand for. The line
 * keeps the spoken line's start and end; inside it the lit word only moves forward.
 */
export function timeAlignedLine(spoken: Word[], aligned: AlignedWord[]): TimedWord[] {
  const n = aligned.length;
  if (n === 0 || spoken.length === 0) return [];
  const start = spoken[0]!.start;
  const end = Math.max(spoken[spoken.length - 1]!.end, start + MIN_WORD_SECONDS * n);
  // Where each word would start if the line's time were shared out by length alone.
  const total = aligned.reduce((sum, word) => sum + weight(word.t), 0);
  const even: number[] = [];
  let before = 0;
  for (const word of aligned) {
    even.push(start + ((end - start) * before) / total);
    before += weight(word.t);
  }
  // Each word's own start: the first spoken word it stands for.
  const own = aligned.map((word) =>
    word.src.length > 0 ? Math.min(...word.src.map((k) => spoken[k]!.start)) : null,
  );

  // The words that keep their own start: the longest run of them that only goes forward,
  // with room for every word in between. Ties go to the run nearest even sharing.
  type Knot = { index: number; at: number };
  const knots: Knot[] = [{ index: 0, at: start }];
  for (let i = 1; i < n; i++) {
    const at = own[i];
    if (at !== null && at !== undefined) knots.push({ index: i, at });
  }
  const best: { count: number; drift: number; from: number | null }[] = [];
  knots.forEach((knot, j) => {
    if (j === 0) {
      best.push({ count: 1, drift: 0, from: null });
      return;
    }
    let pick = { count: -1, drift: 0, from: null as number | null };
    if (end - knot.at >= MIN_WORD_SECONDS * (n - knot.index)) {
      for (let p = 0; p < j; p++) {
        const prev = knots[p]!;
        const chain = best[p]!;
        if (chain.count < 0 || knot.at - prev.at < MIN_WORD_SECONDS * (knot.index - prev.index)) {
          continue;
        }
        const count = chain.count + 1;
        const drift = chain.drift + Math.abs(knot.at - even[knot.index]!);
        if (count > pick.count || (count === pick.count && drift < pick.drift)) {
          pick = { count, drift, from: p };
        }
      }
    }
    best.push(pick);
  });
  let last = 0;
  best.forEach((chain, j) => {
    const top = best[last]!;
    if (chain.count > top.count || (chain.count === top.count && chain.drift < top.drift)) {
      last = j;
    }
  });
  const kept: Knot[] = [];
  for (let j: number | null = last; j !== null; j = best[j]!.from) kept.unshift(knots[j]!);
  kept.push({ index: n, at: end });

  // Between kept words, the time is shared by length.
  const timed: TimedWord[] = [];
  for (let k = 0; k + 1 < kept.length; k++) {
    const from = kept[k]!;
    const to = kept[k + 1]!;
    const words = aligned.slice(from.index, to.index);
    const sum = words.reduce((acc, word) => acc + weight(word.t), 0);
    let at = from.at;
    for (const word of words) {
      const next = at + ((to.at - from.at) * weight(word.t)) / sum;
      timed.push({ t: word.t, s: round3(at), e: round3(next) });
      at = next;
    }
  }
  return timed;
}

/** Every line of a video timed: the lines' translated words with their places on the clock. */
export function timeTranslatedLines(
  words: Word[],
  lines: number[][],
  aligned: AlignedWord[][],
): TimedWord[][] {
  return lines.map((line, index) =>
    timeAlignedLine(
      line.map((k) => words[k]!),
      aligned[index] ?? [],
    ),
  );
}

// ---------------------------------------------------------------------------------------
// 4. The caption file

/** The look settings a caption file is drawn with (the "Caption video" step's settings). */
export type CaptionFileLook = {
  style?: string;
  line_color?: string;
  word_color?: string;
  outline_color?: string;
  all_caps?: boolean;
  max_words_per_line?: number;
  x?: number;
  y?: number;
  position?: string;
  alignment?: string;
  font_family?: string;
  font_size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikeout?: boolean;
  outline_width?: number;
  spacing?: number;
  angle?: number;
  shadow_offset?: number;
};

/** "#F2B33D" as the caption file writes colours (&H00BBGGRR). White when it is not a colour. */
export function assColour(hex: string | undefined, fallback = "#FFFFFF"): string {
  const value = /^#?[0-9A-Fa-f]{6}$/.test(hex ?? "") ? hex! : fallback;
  const clean = value.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((at) => clean.slice(at, at + 2).toUpperCase());
  return `&H00${b}${g}${r}`;
}

/** Seconds as the caption file writes times: H:MM:SS.cc. */
export function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360_000);
  const m = Math.floor(cs / 6_000) % 60;
  const s = Math.floor(cs / 100) % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs % 100)}`;
}

/** Where captions sit, the way the toolkit places them: a 3 by 3 grid, or the x and y given. */
export function captionPlace(
  look: CaptionFileLook,
  width: number,
  height: number,
): { an: number; x: number; y: number } {
  const horizontal = look.alignment === "left" ? 1 : look.alignment === "right" ? 3 : 2;
  if (typeof look.x === "number" && typeof look.y === "number") {
    return { an: 4 + horizontal - 1, x: look.x, y: look.y };
  }
  const position = (look.position ?? "middle_center").toLowerCase();
  const row = position.includes("top")
    ? { base: 7, y: height / 6 }
    : position.includes("middle")
      ? { base: 4, y: height / 2 }
      : { base: 1, y: (5 * height) / 6 };
  const column = position.includes("left")
    ? { left: 0, right: width / 3, centre: width / 6 }
    : position.includes("right")
      ? { left: (2 * width) / 3, right: width, centre: (5 * width) / 6 }
      : { left: width / 3, right: (2 * width) / 3, centre: width / 2 };
  const x = horizontal === 1 ? column.left : horizontal === 3 ? column.right : column.centre;
  return { an: row.base + horizontal - 1, x: Math.trunc(x), y: Math.trunc(row.y) };
}

/** A word as it is written into the caption file: braces would start an override tag. */
function drawn(text: string, caps: boolean, code: string): string {
  let shown = text;
  if (caps) {
    try {
      shown = text.toLocaleUpperCase(code || undefined);
    } catch {
      shown = text.toUpperCase();
    }
  }
  return shown.replace(/[{}]/g, "").replace(/\\/g, "");
}

const flag = (on: boolean | undefined) => (on ? "1" : "0");

/**
 * A caption file (ASS) for translated words, drawn as the toolkit draws its own: the same
 * style line, place, colours and word effects, so a translated caption looks like the team's
 * captions in any other video.
 */
export function translatedCaptionFile(
  lines: TimedWord[][],
  look: CaptionFileLook,
  video: { width: number; height: number },
  code: string,
): string {
  const { width, height } = video;
  const fontSize = look.font_size ?? Math.trunc(height * 0.05);
  const font = scriptFontFor(code) ?? look.font_family ?? "Arial";
  const lineColour = assColour(look.line_color, "#FFFFFF");
  const wordColour = assColour(look.word_color, "#FFFF00");
  const style = [
    "Style: Default",
    font,
    fontSize,
    lineColour,
    lineColour,
    assColour(look.outline_color, "#000000"),
    assColour("#000000"),
    flag(look.bold),
    flag(look.italic),
    flag(look.underline),
    flag(look.strikeout),
    100,
    100,
    look.spacing ?? 0,
    look.angle ?? 0,
    1,
    look.outline_width ?? 2,
    look.shadow_offset ?? 0,
    5,
    20,
    20,
    20,
    0,
  ].join(",");

  const place = captionPlace(look, width, height);
  const at = `{\\an${place.an}\\pos(${place.x},${place.y})}`;
  const join = writtenWithoutSpaces(code) ? "" : " ";
  const caps = look.all_caps === true;
  const perLine = Math.max(0, Math.trunc(look.max_words_per_line ?? 0));
  const effect = look.style ?? "classic";
  const events: string[] = [];
  const dialogue = (layer: number, from: number, to: number, text: string) =>
    events.push(`Dialogue: ${layer},${assTime(from)},${assTime(to)},Default,,0,0,0,,${at}${text}`);

  for (const line of lines) {
    const words = line
      .map((word) => ({ ...word, t: drawn(word.t, caps, code) }))
      .filter((word) => word.t !== "");
    if (words.length === 0) continue;
    const groups: TimedWord[][] = [];
    if (perLine > 0) {
      for (let i = 0; i < words.length; i += perLine) groups.push(words.slice(i, i + perLine));
    } else groups.push(words);

    if (effect === "karaoke") {
      // One event for the line; each word turns from the line colour to the word colour.
      const text = groups
        .map((group) =>
          group.map((word) => `{\\k${Math.round((word.e - word.s) * 100)}}${word.t}`).join(join),
        )
        .join("\\N");
      dialogue(0, words[0]!.s, words[words.length - 1]!.e, `{\\c${wordColour}}${text}`);
      continue;
    }
    for (const group of groups) {
      const plain = group.map((word) => word.t);
      const from = group[0]!.s;
      const to = group[group.length - 1]!.e;
      if (effect === "classic") {
        dialogue(0, from, to, plain.join(join));
        continue;
      }
      if (effect === "highlight") dialogue(0, from, to, `{\\c${lineColour}}${plain.join(join)}`);
      group.forEach((word, index) => {
        if (effect === "word_by_word") {
          dialogue(0, word.s, word.e, `{\\c${wordColour}}${word.t}`);
          return;
        }
        const marked = plain
          .map((text, other) =>
            other !== index
              ? text
              : effect === "underline"
                ? `{\\u1}${text}{\\u0}`
                : `{\\c${wordColour}}${text}{\\c${lineColour}}`,
          )
          .join(join);
        dialogue(effect === "highlight" ? 1 : 0, word.s, word.e, `{\\c${lineColour}}${marked}`);
      });
    }
  }

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    style,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}
