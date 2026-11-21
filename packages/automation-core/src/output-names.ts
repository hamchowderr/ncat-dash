import { getStep, userInputSchema } from "@ncat-dash/step-catalog";

import { isTakeLabel } from "./cleanup";

// Readable names for the files a run makes. The toolkit names what it makes after its own
// job ids ("ca4934e3-…_output_0.mp4", "…_captioned.mp4"), which tell a person nothing. A
// run's files are shown under the name of the file that started it instead, with what
// each one is: "Space interviews clip 1", "Space interviews thumbnail".

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

/**
 * Names for the files one step made, in their order. A file whose own name a person gave
 * keeps it; one named after a job id becomes `<stem> <noun>`, numbered when the step made
 * more than one of the same kind.
 */
export function nameFiles(stem: string, files: string[], stepId?: string | null): string[] {
  const nouns = files.map((file) => outputNoun(file, stepId));
  const totals = new Map<string, number>();
  for (const noun of nouns) totals.set(noun, (totals.get(noun) ?? 0) + 1);
  const counts = new Map<string, number>();
  return files.map((file, at) => {
    const own = fileNameOfLink(file);
    if (!isMachineName(own)) return own;
    const noun = nouns[at];
    const count = (counts.get(noun) ?? 0) + 1;
    counts.set(noun, count);
    return (totals.get(noun) ?? 0) > 1 ? `${stem} ${noun} ${count}` : `${stem} ${noun}`;
  });
}

/** What a run's files are named after: the file that started it, else the automation. */
export function runStem(startedWith: string | null | undefined, automationName: string): string {
  return plainName(startedWith) ?? (automationName.trim() || "Output");
}

/**
 * Readable names for every file a run made, by link. Steps are taken in the order given;
 * a file handed on unchanged keeps the name it got from the first step that made it.
 */
export function runOutputNames(
  stem: string,
  steps: { stepId?: string | null; outputs: string[]; labels?: FileLabel[] }[],
): Record<string, string> {
  const names: Record<string, string> = {};
  for (const step of steps) {
    const labels = new Map((step.labels ?? []).map((item) => [item.url, item.label]));
    const fresh = [...new Set(step.outputs)].filter((file) => !(file in names));
    nameFiles(stem, fresh, step.stepId).forEach((name, at) => {
      const label = labels.get(fresh[at]);
      names[fresh[at]] =
        label && isMachineName(fileNameOfLink(fresh[at])) ? `${stem} ${label}` : name;
    });
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
