/**
 * Steps that steer a run instead of changing a file: "if" sends each file one of two
 * ways by what is known about it, and "wait" holds the run for a length of time.
 *
 * An If reads the same details an upload gets (length, picture size, sound and so on; see
 * details.ts), so it can sit anywhere in an automation, also after a step that made a new
 * file. Its settings are a few words and a number that the canvas shows as a sentence.
 */
import { sendProblem } from "./send";
import { approvalProblem } from "./approval";
import { detailsKind, type FileDetails, formatDuration } from "./details";

/** The ways out of an If. Files that pass leave by "yes", the rest by "no". */
export const IF_BRANCHES = ["yes", "no"] as const;
export type IfBranch = (typeof IF_BRANCHES)[number];

/**
 * The way a step's files go when the step fails, if anything hangs off it. Steps that do
 * work have it besides their usual way out; it is used only when they fail.
 */
export const FAILURE_WAY = "failed";

export const BRANCH_LABELS: Record<string, string> = {
  yes: "Yes",
  no: "No",
  [FAILURE_WAY]: "If it fails",
};

/** The ways out of a node of this kind. Empty for every kind with a single way out. */
export function branchesOfKind(kind: string | undefined): readonly string[] {
  return kind === "if" ? IF_BRANCHES : [];
}

/** Whether a node of this kind can have a way for when it fails: steps that do work. */
export function canFailOver(kind: string | undefined): boolean {
  return (
    kind === "step" ||
    kind === "clips" ||
    kind === "moments" ||
    kind === "chapters" ||
    kind === "broll" ||
    kind === "broll-plan" ||
    kind === "motion" ||
    kind === "motion-plan" ||
    kind === "sound-effects" ||
    kind === "cleanup" ||
    kind === "footage-check" ||
    kind === "subtitles" ||
    kind === "export" ||
    kind === "automation" ||
    kind === "send"
  );
}

export type Check = "length" | "type" | "shape" | "size" | "sound" | "words";

interface CheckDescription {
  /** What is looked at, as the pick list names it. */
  label: string;
  /** The words `is` can be, each with how it reads in a sentence. */
  choices: { value: string; label: string }[];
  /** For a check that compares against a number: what the number counts. */
  value?: "seconds" | "pixels";
  /** For a check that looks for words: they are given as text. */
  text?: true;
}

/** Every check an If can make. The pick lists and the agent's schema both come from here. */
export const CHECKS: Record<Check, CheckDescription> = {
  length: {
    label: "Length",
    choices: [
      { value: "longer", label: "is longer than" },
      { value: "shorter", label: "is shorter than" },
    ],
    value: "seconds",
  },
  type: {
    label: "Type",
    choices: [
      { value: "video", label: "is a video" },
      { value: "audio", label: "is an audio file" },
      { value: "image", label: "is a picture" },
    ],
  },
  shape: {
    label: "Shape",
    choices: [
      { value: "wide", label: "is wide (landscape)" },
      { value: "tall", label: "is tall (vertical)" },
      { value: "square", label: "is square" },
    ],
  },
  size: {
    label: "Picture size",
    choices: [
      { value: "at_least", label: "is at least" },
      { value: "below", label: "is smaller than" },
    ],
    value: "pixels",
  },
  sound: {
    label: "Sound",
    choices: [
      { value: "present", label: "has sound" },
      { value: "absent", label: "has no sound" },
    ],
  },
  // What is said in it, from a Transcribe step before the If.
  words: {
    label: "What is said",
    choices: [
      { value: "mentions", label: "mentions" },
      { value: "not_mentions", label: "does not mention" },
    ],
    text: true,
  },
};

export const CHECK_NAMES = Object.keys(CHECKS) as Check[];

/** Picture sizes offered in the pick list, by the shorter side in pixels. */
export const PICTURE_SIZES: { value: number; label: string }[] = [
  { value: 480, label: "480p" },
  { value: 720, label: "720p (HD)" },
  { value: 1080, label: "1080p (Full HD)" },
  { value: 1440, label: "1440p" },
  { value: 2160, label: "4K" },
];

export interface Condition {
  check: Check;
  is: string;
  /** Seconds for a length check, pixels on the shorter side for a picture size check. */
  value?: number;
  /** The words a "What is said" check looks for. */
  text?: string;
}

/** What a new If starts with, so it works before anyone touches it. */
export const DEFAULT_CONDITION: Required<Omit<Condition, "text">> = {
  check: "length",
  is: "longer",
  value: 60,
};

/** The words `is` starts as when the check is changed, and the number that goes with them. */
export function conditionFor(check: Check): Condition {
  const { choices, value, text } = CHECKS[check];
  return {
    check,
    is: choices[0].value,
    ...(value === "seconds" ? { value: 60 } : value === "pixels" ? { value: 1080 } : {}),
    ...(text ? { text: "" } : {}),
  };
}

/** A problem with an If's settings in plain words, or null when they make a check. */
export function conditionProblem(input: Record<string, unknown>): string | null {
  const description = CHECKS[input.check as Check];
  if (typeof input.check !== "string" || !description) return "Choose what to check.";
  if (!description.choices.some((choice) => choice.value === input.is)) {
    return `Choose what the ${description.label.toLowerCase()} should be.`;
  }
  if (description.value) {
    const value = input.value;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return description.value === "seconds"
        ? "Give a length above zero."
        : "Choose a picture size.";
    }
  }
  if (description.text && (typeof input.text !== "string" || input.text.trim() === "")) {
    return "Say which words to look for.";
  }
  return null;
}

/** An If's settings as a condition, or null while they do not make one. */
export function readCondition(input: Record<string, unknown>): Condition | null {
  if (conditionProblem(input)) return null;
  return {
    check: input.check as Check,
    is: input.is as string,
    ...(CHECKS[input.check as Check].value ? { value: input.value as number } : {}),
    ...(CHECKS[input.check as Check].text ? { text: (input.text as string).trim() } : {}),
  };
}

function sizeLabel(pixels: number): string {
  return PICTURE_SIZES.find((size) => size.value === pixels)?.label ?? `${pixels} pixels`;
}

/** The check in a few words, for the canvas: "Longer than 1:00", "Is a video". */
export function conditionSentence(input: Record<string, unknown>): string {
  const condition = readCondition(input);
  if (!condition) return "Needs settings";
  const words =
    CHECKS[condition.check].choices.find((choice) => choice.value === condition.is)?.label ?? "";
  const sentence =
    condition.check === "length"
      ? `${words.replace(/^is /, "")} ${formatDuration(condition.value!)}`
      : condition.check === "size"
        ? `${words.replace(/^is /, "")} ${sizeLabel(condition.value!)}`
        : condition.check === "words"
          ? `${words} “${condition.text}”`
          : words;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

// A picture this close to square counts as square, so 1080 by 1088 is not "tall".
const SQUARE_TOLERANCE = 0.03;

/**
 * Whether a file passes the check. A file whose details could not be read, or that has
 * no such detail (the length of a picture, the shape of a sound), does not pass, so it
 * leaves by "no" and nothing is done to it by mistake.
 */
export function passes(
  condition: Condition,
  details: FileDetails | null | undefined,
  /** What is said in the file, for a "What is said" check; unknown words do not pass. */
  said?: string | null,
): boolean {
  if (condition.check === "words") {
    if (typeof said !== "string") return false;
    const found = said.toLowerCase().includes((condition.text ?? "").toLowerCase());
    return condition.is === "mentions" ? found : !found;
  }
  if (!details) return false;
  switch (condition.check) {
    case "length": {
      const { duration } = details;
      if (duration === undefined || detailsKind(details) === "image") return false;
      return condition.is === "longer" ? duration > condition.value! : duration < condition.value!;
    }
    case "type":
      return detailsKind(details) === condition.is;
    case "shape": {
      const { width, height } = details;
      if (!width || !height) return false;
      const square = Math.abs(width - height) / Math.max(width, height) <= SQUARE_TOLERANCE;
      if (condition.is === "square") return square;
      return !square && (condition.is === "wide" ? width > height : height > width);
    }
    case "size": {
      const { width, height } = details;
      if (!width || !height) return false;
      const shorter = Math.min(width, height);
      return condition.is === "at_least" ? shorter >= condition.value! : shorter < condition.value!;
    }
    case "sound": {
      if (details.hasAudio === undefined) return false;
      return condition.is === "present" ? details.hasAudio : !details.hasAudio;
    }
  }
  return false;
}

/** Sorts files into the two ways out of an If, keeping their order. */
export function sortFiles(
  condition: Condition,
  files: { url: string; details: FileDetails | null; said?: string | null }[],
): Record<IfBranch, string[]> {
  const sorted: Record<IfBranch, string[]> = { yes: [], no: [] };
  for (const file of files) {
    sorted[passes(condition, file.details, file.said) ? "yes" : "no"].push(file.url);
  }
  return sorted;
}

export const WAIT_UNITS = ["minutes", "hours", "days"] as const;
export type WaitUnit = (typeof WAIT_UNITS)[number];

const UNIT_MS: Record<WaitUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

/**
 * The longest a Wait can hold a run. A link to an uploaded file stops working after a
 * week, so a longer wait would hand the next step a file it can no longer open.
 */
export const MAX_WAIT_MS = 6 * UNIT_MS.days;

/** A problem with a Wait's settings in plain words, or null when they are fine. */
export function waitProblem(input: Record<string, unknown>): string | null {
  const { amount, unit } = input;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return "Say how long to wait.";
  }
  if (!WAIT_UNITS.includes(unit as WaitUnit)) return "Choose minutes, hours or days.";
  if (amount * UNIT_MS[unit as WaitUnit] > MAX_WAIT_MS) {
    return "A wait can be 6 days at most, because links to files stop working after a week.";
  }
  return null;
}

/** How long a Wait holds the run, in milliseconds, or null while its settings are not right. */
export function waitMs(input: Record<string, unknown>): number | null {
  if (waitProblem(input)) return null;
  return Math.round((input.amount as number) * UNIT_MS[input.unit as WaitUnit]);
}

/** The wait in a few words, for the canvas: "30 minutes", "1 hour". */
export function waitSentence(input: Record<string, unknown>): string {
  if (waitProblem(input)) return "Needs settings";
  const amount = input.amount as number;
  const unit = input.unit as string;
  return `${amount} ${amount === 1 ? unit.replace(/s$/, "") : unit}`;
}

/** A problem with a logic step's settings, or null. Null for every other kind of step. */
export function logicProblem(node: {
  kind: string;
  input: Record<string, unknown>;
}): string | null {
  if (node.kind === "if") return conditionProblem(node.input);
  if (node.kind === "wait") return waitProblem(node.input);
  if (node.kind === "approval") return approvalProblem(node.input);
  if (node.kind === "send") return sendProblem(node.input);
  return null;
}
