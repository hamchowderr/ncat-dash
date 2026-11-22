/**
 * Translating what was said in a video, for subtitles and captions in other languages.
 *
 * A video is translated once per language, from the transcript it already has: the
 * transcript is cut into the same cues its own subtitles use, each cue's words are
 * translated, and the cue keeps its times. So a translation lines up with the video the
 * way the original subtitles do, and nothing is transcribed again. Each language is kept,
 * so captions, downloads and every later automation read it instead of paying again.
 */
import { captionCues, wrapCue, type Cue, type TimedPiece } from "./subtitles";

export type Language = { code: string; name: string };

/** The languages a video can be translated into, by their usual name, in order of name. */
export const LANGUAGES: Language[] = [
  { code: "ar", name: "Arabic" },
  { code: "bn", name: "Bengali" },
  { code: "zh", name: "Chinese (Simplified)" },
  { code: "zh-TW", name: "Chinese (Traditional)" },
  { code: "cs", name: "Czech" },
  { code: "da", name: "Danish" },
  { code: "nl", name: "Dutch" },
  { code: "en", name: "English" },
  { code: "fil", name: "Filipino" },
  { code: "fi", name: "Finnish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "el", name: "Greek" },
  { code: "he", name: "Hebrew" },
  { code: "hi", name: "Hindi" },
  { code: "hu", name: "Hungarian" },
  { code: "id", name: "Indonesian" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "ms", name: "Malay" },
  { code: "no", name: "Norwegian" },
  { code: "fa", name: "Persian" },
  { code: "pl", name: "Polish" },
  { code: "pt-BR", name: "Portuguese (Brazil)" },
  { code: "pt", name: "Portuguese (Portugal)" },
  { code: "ro", name: "Romanian" },
  { code: "ru", name: "Russian" },
  { code: "es", name: "Spanish" },
  { code: "es-419", name: "Spanish (Latin America)" },
  { code: "sw", name: "Swahili" },
  { code: "sv", name: "Swedish" },
  { code: "ta", name: "Tamil" },
  { code: "th", name: "Thai" },
  { code: "tr", name: "Turkish" },
  { code: "uk", name: "Ukrainian" },
  { code: "ur", name: "Urdu" },
  { code: "vi", name: "Vietnamese" },
];

const BY_CODE = new Map(LANGUAGES.map((language) => [language.code.toLowerCase(), language]));

/** The language with this code, or null for one not on the list. */
export function languageOf(code: string): Language | null {
  return BY_CODE.get(code.trim().toLowerCase()) ?? null;
}

/** A language's name for people, or the code itself when it is not on the list. */
export function languageName(code: string): string {
  return languageOf(code)?.name ?? code;
}

/** The cues a translation is made of: the same cues the original subtitles use. */
export function cuesToTranslate(pieces: TimedPiece[]): Cue[] {
  // One line per cue for the model; the line break is put back after translating.
  return captionCues(pieces).map((cue) => ({ ...cue, text: cue.text.replace(/\n/g, " ") }));
}

// Lines sent in one question: small enough that a long video's answer never runs out of
// room, large enough that the model sees the conversation around each line.
export const TRANSLATE_BATCH_LINES = 120;
export const TRANSLATE_BATCH_CHARS = 8_000;

/** Where the next batch of lines ends, starting at `from`. Always at least one line. */
export function nextBatchEnd(lines: string[], from: number): number {
  let chars = 0;
  let end = from;
  while (end < lines.length && end - from < TRANSLATE_BATCH_LINES) {
    chars += lines[end]!.length + 1;
    if (end > from && chars > TRANSLATE_BATCH_CHARS) break;
    end++;
  }
  return Math.max(end, Math.min(from + 1, lines.length));
}

/**
 * Reads the model's answer: a JSON list of translated lines, one for each line sent, in
 * order. Returns null when it is not that, so the batch can be asked again.
 */
export function readTranslatedLines(answer: string, count: number): string[] | null {
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
  if (!Array.isArray(parsed) || parsed.length !== count) return null;
  if (!parsed.every((line) => typeof line === "string")) return null;
  return (parsed as string[]).map((line) => line.replace(/\s+/g, " ").trim());
}

/** Translated lines back on their cues' times, wrapped for the screen like the original. */
export function translatedCues(cues: Cue[], lines: string[]): Cue[] {
  return cues.map((cue, index) => ({ ...cue, text: wrapCue(lines[index] ?? "") }));
}

/** A file name for a translated download: the file's title, the language, the format. */
export function translationFileName(
  title: string,
  code: string,
  format: "srt" | "vtt" | "txt",
): string {
  const safe = title
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${safe || "transcript"}.${code}.${format}`;
}
