import { getStep, userInputSchema } from "@takewon/step-catalog";

import { isTakeLabel } from "./cleanup";
import { madeWords } from "./made-words";

// Readable names for the files a run makes. The toolkit names what it makes after its own
// job ids ("ca4934e3-…_output_0.mp4", "…_captioned.mp4"), which tell a person nothing. A
// run's files are shown under the name of the file that started it instead, with what
// was done to each one: "Space interviews captioned", "Space interviews part 2",
// "Space interviews thumbnail" (made-words.ts).

const VIDEO = /\.(mp4|mov|webm|mkv|m4v|avi)$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;
const CAPTIONS = /\.(srt|vtt|ass|ssa)$/i;
const TEXT = /\.(txt|json|md)$/i;
const ARCHIVE = /\.(zip|tar|gz|tgz)$/i;
const EDITOR = /\.(xml|fcpxml|edl|otio|aaf)$/i;

// A uuid, or a long run of hex or random letters and digits such as a job id.
const MACHINE_PART = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}/gi;
// What the toolkit adds after a job id ("_output_0", "_captioned"), which says nothing on its own.
const TOOLKIT_WORDS =
  /^(output|outputs|captioned|caption|trimmed|trim|cut|split|converted|thumbnail|audio|video|final|part|clip|\d+|\s)+$/i;

/** The last part of a link or key, decoded: "https://x/a/b%20c.mp4" gives "b c.mp4". */
export function fileNameOfLink(link: string): string {
  let path = link;
  try {
    path = new URL(link).pathname;
  } catch {
    // A key or a plain name: use it as it is.
  }
  const last = path.split("/").filter(Boolean).pop() ?? link;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** Whether a file name was made by a machine (it carries a job id) rather than a person. */
export function isMachineName(name: string): boolean {
  return new RegExp(MACHINE_PART.source, "i").test(name);
}

/**
 * A file name said plainly, without its ending: "space-interviews_final.mp4" gives
 * "Space interviews final". Null when nothing readable is left, as with a job id.
 */
export function plainName(name: string | null | undefined): string | null {
  if (!name) return null;
  const words = name
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(MACHINE_PART, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!words || !/[a-z]/i.test(words)) return null;
  if (isMachineName(name) && TOOLKIT_WORDS.test(words)) return null;
  return words[0].toUpperCase() + words.slice(1);
}

/** What a file is, in one word, from its ending and the step that made it. */
export function outputNoun(link: string, stepId?: string | null): string {
  const name = fileNameOfLink(link);
  const step = stepId ?? "";
  if (VIDEO.test(name)) return "clip";
  if (AUDIO.test(name)) return "audio";
  if (IMAGE.test(name)) return /thumbnail/.test(step) ? "thumbnail" : "image";
  if (CAPTIONS.test(name)) return "captions";
  if (TEXT.test(name)) return /transcri/.test(step) ? "transcript" : "text";
  if (ARCHIVE.test(name)) return "files";
  if (EDITOR.test(name)) return "timeline";
  return "file";
}

// What a file is, as opposed to what was done to it: these keep their own word.
const DOCUMENT_NOUNS = new Set(["captions", "text", "transcript", "files", "timeline", "file"]);

/**
 * What one file a step made is called after its stem: what the step did to it
 * ("captioned", "part") when the step is known and the file is a picture, sound or video,
 * else what the file is ("transcript", "clip").
 */
export function outputWords(link: string, stepId?: string | null): string {
  const noun = outputNoun(link, stepId);
  const words = madeWords(stepId);
  return words && !DOCUMENT_NOUNS.has(noun) ? words : noun;
}

/**
 * Names for the files one step made, in their order. A file whose own name a person gave
 * keeps it; one named after a job id becomes `<stem> <what was done>`, numbered when the
 * step made more than one of the same kind: "Space interviews captioned",
 * "Space interviews part 2". With `bases`, one name per file, each file is named after
 * the file it was made from instead: "Space interviews part 2 captioned". A file made for
 * a platform says so before the step's words: "Space interviews TikTok captioned".
 */
export function nameFiles(
  stem: string,
  files: string[],
  stepId?: string | null,
  bases?: string[],
  platforms?: Record<string, string>,
): string[] {
  // The platform goes before the step's words, unless the file is named after one that
  // already says it.
  const words = files.map((file, at) => {
    const done = outputWords(file, stepId);
    const platform = platforms?.[file];
    return platform && !bases?.[at] ? `${platform} ${done}` : done;
  });
  const totals = new Map<string, number>();
  for (const word of words) totals.set(word, (totals.get(word) ?? 0) + 1);
  const counts = new Map<string, number>();
  return files.map((file, at) => {
    const own = fileNameOfLink(file);
    if (!isMachineName(own)) return own;
    const word = words[at];
    const base = bases?.[at];
    if (base) return base.endsWith(` ${word}`) ? base : `${base} ${word}`;
    const count = (counts.get(word) ?? 0) + 1;
    counts.set(word, count);
    return (totals.get(word) ?? 0) > 1 ? `${stem} ${word} ${count}` : `${stem} ${word}`;
  });
}

const MEDIA_NOUNS = new Set(["clip", "audio", "image", "thumbnail"]);
const isMedia = (link: string, stepId?: string | null) => MEDIA_NOUNS.has(outputNoun(link, stepId));

/** What a run's files are named after: the file that started it, else the automation. */
export function runStem(startedWith: string | null | undefined, automationName: string): string {
  return plainName(startedWith) ?? (automationName.trim() || "Output");
}

/**
 * Readable names for every file a run made, by link. Steps are taken in the order given;
 * a file handed on unchanged keeps the name it got from the first step that made it.
 * `platforms` holds the platform each clip was made for (platform-labels.ts runPlatforms).
 */
export function runOutputNames(
  stem: string,
  steps: { stepId?: string | null; outputs: string[]; labels?: FileLabel[] }[],
  platforms?: Record<string, string>,
): Record<string, string> {
  const names: Record<string, string> = {};
  // The numbered pieces the last step made (clips, parts), so a step that works on each
  // of them in turn names its files after them: "Space interviews part 2 captioned".
  let pieces: string[] = [];
  for (const step of steps) {
    const labels = new Map((step.labels ?? []).map((item) => [item.url, item.label]));
    const fresh = [...new Set(step.outputs)].filter((file) => !(file in names));
    const media = fresh.filter((file) => isMedia(file, step.stepId));
    const follows = pieces.length > 1 && media.length === pieces.length;
    const bases = follows ? fresh.map((file) => pieces[media.indexOf(file)] ?? "") : undefined;
    const made = nameFiles(stem, fresh, step.stepId, bases, platforms);
    made.forEach((name, at) => {
      const label = labels.get(fresh[at]);
      names[fresh[at]] =
        label && isMachineName(fileNameOfLink(fresh[at])) ? `${stem} ${label}` : name;
    });
    if (media.length > 0) pieces = media.length > 1 ? media.map((file) => names[file]) : [];
  }
  return names;
}

/** A variant code for one file a step made, such as "h02_c01_15s_9x16". */
export interface FileLabel {
  url: string;
  label: string;
}

/**
 * The variant codes for the files a finished step's jobs made. A step with codes of its
 * own (StepDefinition.outputLabels) adds them after the code of the file each job worked
 * on; one that only follows (a shape, captions) adds its code only to a file that has one.
 * `earlier` holds the codes the run's earlier steps gave their files.
 */
export function stepFileLabels(
  jobs: { stepId: string; input: unknown; outputs: string[] }[],
  earlier: FileLabel[],
): FileLabel[] {
  const known = new Map(earlier.map((item) => [item.url, item.label]));
  const made: FileLabel[] = [];
  for (const job of jobs) {
    const step = getStep(job.stepId);
    if (!step?.outputLabels || job.outputs.length === 0) continue;
    const input = (job.input ?? {}) as Record<string, unknown>;
    const from = step.primaryInput ? input[step.primaryInput] : undefined;
    // A cleaned recording's take ("hook02", "body") names where it is kept, not what a
    // later step makes of it, so it is not carried on.
    const found = typeof from === "string" ? known.get(from) : undefined;
    const base = isTakeLabel(found) ? undefined : found;
    if (step.labelsFollow && !base) continue;
    let own: string[] = [];
    try {
      // With the step's defaults filled in, as when it ran.
      const parsed = userInputSchema(step).safeParse(input);
      own = step.outputLabels(
        parsed.success ? (parsed.data as Record<string, unknown>) : input,
        job.outputs.length,
      );
    } catch {
      own = [];
    }
    job.outputs.forEach((url, at) => {
      const parts = [base, own[at]].filter(Boolean);
      if (parts.length > 0) made.push({ url, label: parts.join("_") });
    });
  }
  return made;
}

/**
 * A made file's name after the file it was made from was renamed: the old stem it starts
 * with gives way to the new one ("IMG 4521 captioned" becomes "Moon interview captioned").
 * Null when the name does not start with the old stem, as when a person renamed it.
 */
export function followedName(name: string, oldStem: string, newStem: string): string | null {
  const from = oldStem.trim();
  const to = newStem.trim();
  if (!from || !to || from === to) return null;
  if (name.slice(0, from.length).toLowerCase() !== from.toLowerCase()) return null;
  const rest = name.slice(from.length);
  if (rest && !/^[\s._-]/.test(rest)) return null;
  return `${to}${rest}`;
}
