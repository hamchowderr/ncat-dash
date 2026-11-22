// Check Footage: catches footage that will not edit well before anyone edits it. The
// toolkit measures each file with FFmpeg alone (/v1/media/check); these plain rules decide
// what counts as a problem: the wrong shape, too few pixels, no sound, sound too quiet or
// clipped, black or frozen picture, or a take too short. No AI.

/** What the toolkit measured in one file. Anything it could not tell is left out. */
export interface FootageMeasure {
  duration?: number | null;
  has_video?: boolean;
  has_audio?: boolean;
  width?: number | null;
  height?: number | null;
  rotation?: number;
  fps?: number | null;
  checked_seconds?: number;
  black?: { start: number; end: number }[];
  frozen?: { start: number; end: number }[];
  loudness_lufs?: number | null;
  peak_db?: number | null;
  peak_count?: number;
  samples?: number | null;
}

export const FOOTAGE_SHAPES = ["vertical", "horizontal", "square", "any"] as const;
export type FootageShape = (typeof FOOTAGE_SHAPES)[number];
export const FOOTAGE_ACTIONS = ["stop", "tell"] as const;
export type FootageAction = (typeof FOOTAGE_ACTIONS)[number];

export interface FootageSettings {
  /** The shape the footage must be filmed in. */
  shape: FootageShape;
  /** The fewest pixels on the short side: 1080 for 1080x1920. */
  minShortSide: number;
  /** The shortest a body or single video may be, in seconds. */
  minSeconds: number;
  /** The shortest a hook or ending take may be, in seconds. */
  minTakeSeconds: number;
  /** Sound quieter than this, in LUFS, is too quiet. */
  quietBelow: number;
  /** "stop": the run stops before editing. "tell": the team is told and editing goes on. */
  whenFound: FootageAction;
}

export const FOOTAGE_DEFAULTS: FootageSettings = {
  shape: "vertical",
  minShortSide: 720,
  minSeconds: 5,
  minTakeSeconds: 1,
  quietBelow: -35,
  whenFound: "stop",
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (value === undefined || value === null || value === "" || !Number.isFinite(number))
    return fallback;
  return Math.min(max, Math.max(min, number));
}

/** The step's settings, each falling back to its usual value. */
export function footageSettings(input: Record<string, unknown>): FootageSettings {
  return {
    shape: FOOTAGE_SHAPES.includes(input.shape as FootageShape)
      ? (input.shape as FootageShape)
      : FOOTAGE_DEFAULTS.shape,
    minShortSide: Math.round(clamp(input.minShortSide, 0, 4320, FOOTAGE_DEFAULTS.minShortSide)),
    minSeconds: clamp(input.minSeconds, 0, 600, FOOTAGE_DEFAULTS.minSeconds),
    minTakeSeconds: clamp(input.minTakeSeconds, 0, 60, FOOTAGE_DEFAULTS.minTakeSeconds),
    quietBelow: clamp(input.quietBelow, -70, -10, FOOTAGE_DEFAULTS.quietBelow),
    whenFound: FOOTAGE_ACTIONS.includes(input.whenFound as FootageAction)
      ? (input.whenFound as FootageAction)
      : FOOTAGE_DEFAULTS.whenFound,
  };
}

export type FootageRole = "file" | "body" | "hook" | "ending";

export type FootageProblemKind =
  | "unreadable"
  | "shape"
  | "resolution"
  | "no-sound"
  | "quiet"
  | "clipped"
  | "black"
  | "frozen"
  | "short";

export interface FootageProblem {
  kind: FootageProblemKind;
  /** The problem in plain words, for the team and the creator. */
  says: string;
}

// A black stretch at least this long, in seconds, is a problem: shorter is a fade.
const BLACK_SECONDS = 1;
// A frozen stretch at least this long, outside black picture, is a problem.
const FROZEN_SECONDS = 2;
// Sound that hits full scale this many times or more is clipped. Clean sound hits its
// own loudest sample once or twice.
const CLIP_HITS = 20;
const FULL_SCALE_DB = -0.1;
// A picture counts as one shape when its sides differ by no more than this.
const SQUARE_SLACK = 0.1;

const SHAPE_WORDS: Record<Exclude<FootageShape, "any">, string> = {
  vertical: "vertical (9:16)",
  horizontal: "landscape (16:9)",
  square: "square (1:1)",
};

/** The shape a picture is, as it plays. */
export function footageShapeOf(width: number, height: number): Exclude<FootageShape, "any"> {
  if (Math.abs(width - height) <= SQUARE_SLACK * Math.max(width, height)) return "square";
  return height > width ? "vertical" : "horizontal";
}

/** Seconds as people say them: "0:04", "1:02". */
function clockOf(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

const secondsWords = (seconds: number) => `${Math.round(seconds * 10) / 10} s`;

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }) {
  return Math.min(a.end, b.end) - Math.max(a.start, b.start);
}

/** What is wrong with one file, by the rules. Empty when it is fine to edit. */
export function footageProblems(
  measure: FootageMeasure | null,
  settings: FootageSettings,
  role: FootageRole,
): FootageProblem[] {
  if (!measure) return [{ kind: "unreadable", says: "The file could not be read." }];
  const problems: FootageProblem[] = [];
  const width = measure.width ?? 0;
  const height = measure.height ?? 0;

  if (measure.has_video === false) {
    problems.push({ kind: "unreadable", says: "It has no picture." });
  } else if (width > 0 && height > 0) {
    const shape = footageShapeOf(width, height);
    if (settings.shape !== "any" && shape !== settings.shape) {
      problems.push({
        kind: "shape",
        says: `It is ${SHAPE_WORDS[shape]} (${width}×${height}); ${SHAPE_WORDS[settings.shape]} is needed.`,
      });
    }
    const short = Math.min(width, height);
    if (settings.minShortSide > 0 && short < settings.minShortSide) {
      problems.push({
        kind: "resolution",
        says: `It is only ${width}×${height}; at least ${settings.minShortSide} pixels on the short side is needed.`,
      });
    }
  }

  if (measure.has_audio === false) {
    problems.push({ kind: "no-sound", says: "It has no sound." });
  } else if (measure.has_audio) {
    const loudness = measure.loudness_lufs;
    if (loudness === null || loudness === undefined) {
      if ("loudness_lufs" in measure)
        problems.push({ kind: "quiet", says: "The sound is silent." });
    } else if (loudness < settings.quietBelow) {
      problems.push({
        kind: "quiet",
        says: `The sound is very quiet (${Math.round(loudness)} LUFS; ${settings.quietBelow} or louder is needed).`,
      });
    }
    if (
      typeof measure.peak_db === "number" &&
      measure.peak_db >= FULL_SCALE_DB &&
      (measure.peak_count ?? 0) >= CLIP_HITS
    ) {
      problems.push({
        kind: "clipped",
        says: `The sound is clipped: it hits full volume ${measure.peak_count} times, so it will crackle.`,
      });
    }
  }

  const black = (measure.black ?? []).filter(
    (stretch) => stretch.end - stretch.start >= BLACK_SECONDS,
  );
  if (black.length > 0) {
    const total = black.reduce((sum, stretch) => sum + (stretch.end - stretch.start), 0);
    problems.push({
      kind: "black",
      says: `The picture is black for ${secondsWords(total)}, from ${clockOf(black[0].start)}.`,
    });
  }
  // A black stretch is frozen too; only a still picture that is not black counts here.
  const frozen = (measure.frozen ?? []).filter((stretch) => {
    const still = stretch.end - stretch.start;
    const inBlack = (measure.black ?? []).reduce(
      (sum, dark) => sum + Math.max(0, overlaps(stretch, dark)),
      0,
    );
    return still - inBlack >= FROZEN_SECONDS;
  });
  if (frozen.length > 0) {
    const longest = frozen.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
    problems.push({
      kind: "frozen",
      says: `The picture freezes for ${secondsWords(longest.end - longest.start)} at ${clockOf(longest.start)}.`,
    });
  }

  const least =
    role === "hook" || role === "ending" ? settings.minTakeSeconds : settings.minSeconds;
  if (typeof measure.duration === "number" && least > 0 && measure.duration < least) {
    problems.push({
      kind: "short",
      says: `It is only ${secondsWords(measure.duration)} long; at least ${secondsWords(least)} is needed.`,
    });
  }
  return problems;
}

/** One checked file, as the run keeps it. */
export interface CheckedFile {
  url: string;
  name: string;
  role: FootageRole;
  problems: FootageProblem[];
  width?: number;
  height?: number;
  duration?: number;
  loudness?: number;
}

const ROLE_WORDS: Record<FootageRole, string> = {
  file: "",
  body: "body",
  hook: "hook",
  ending: "ending",
};

/** A file's name with what it is, such as "hook02.mp4 (hook)". */
export function checkedName(file: Pick<CheckedFile, "name" | "role">): string {
  const role = ROLE_WORDS[file.role];
  return role && !file.name.toLowerCase().includes(role) ? `${file.name} (${role})` : file.name;
}

/** How the check went, in one sentence: "2 of 4 files need new footage." */
export function footageSummary(files: { problems: readonly unknown[] }[]): string {
  const bad = files.filter((file) => file.problems.length > 0).length;
  if (files.length === 0) return "No footage reached the check.";
  if (bad === 0)
    return files.length === 1
      ? "The footage is fine to edit."
      : `All ${files.length} files are fine to edit.`;
  if (files.length === 1) return "The footage needs another look before editing.";
  return `${bad} of ${files.length} files need another look before editing.`;
}

/** The alert's text: the summary, then each file with its problems, kept short for chat. */
export function footageMessage(files: CheckedFile[], stopped: boolean, creator?: string): string {
  const bad = files.filter((file) => file.problems.length > 0);
  const who = creator ? ` from ${creator}` : "";
  const head = `${footageSummary(files).replace(/\.$/, "")}${who}. ${
    stopped ? "Editing has not started." : "Editing went ahead anyway."
  }`;
  const lines = bad
    .slice(0, 6)
    .map((file) => `${checkedName(file)}: ${file.problems.map((p) => p.says).join(" ")}`);
  if (bad.length > 6) lines.push(`and ${bad.length - 6} more.`);
  return [head, ...lines].join("\n");
}

/** The note left in the creator's folder, so they see what to film again. */
export function footageNote(files: CheckedFile[], stopped: boolean, checkedAt: Date): string {
  const bad = files.filter((file) => file.problems.length > 0);
  const when = checkedAt.toISOString().slice(0, 16).replace("T", " ");
  if (bad.length === 0) {
    return `Footage check, ${when} UTC\n\nEvery file passed: ${files.map((f) => f.name).join(", ")}.\nNothing to film again.\n`;
  }
  const lines = [
    `Footage check, ${when} UTC`,
    "",
    stopped
      ? "These files need to be filmed again or fixed before editing can start:"
      : "These files have problems. Editing went ahead, but they may not look or sound right:",
    "",
  ];
  for (const file of bad) {
    lines.push(`- ${checkedName(file)}`);
    for (const problem of file.problems) lines.push(`    ${problem.says}`);
  }
  lines.push(
    "",
    "Upload the new take with the same name to replace it. The check runs again by itself.",
  );
  return `${lines.join("\n")}\n`;
}

/** The name of the note left in a creator's folder. */
export const FOOTAGE_NOTE = "Footage check.txt";

/** The step on the canvas, in a few words: "Vertical, stops on a problem". */
export function footageCheckSentence(input: Record<string, unknown>): string {
  const settings = footageSettings(input);
  const shape =
    settings.shape === "any"
      ? "Any shape"
      : settings.shape === "vertical"
        ? "Vertical"
        : settings.shape === "horizontal"
          ? "Landscape"
          : "Square";
  return `${shape}, ${settings.whenFound === "stop" ? "stops on a problem" : "tells, then edits"}`;
}
