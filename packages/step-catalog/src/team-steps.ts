import { z } from "zod";
import { defineStep, type StepDefinition } from "./define";
import { composeProblem } from "./compose-guard";
import { ffmpegCompose } from "./steps/ffmpeg/compose";

/**
 * Team steps: FFmpeg jobs a team keeps as its own steps. The agent writes one when no
 * ready-made step fits, tries it on a real file, and saves it with a few plain settings
 * ("blanks"). From then on it is a step like any recipe: it sends one request to the
 * toolkit's /v1/ffmpeg/compose, filled in from its settings, with no AI per video.
 *
 * A team step is data, not code: `request` is a compose request whose strings may hold
 * `{{name}}` where a blank's value goes. A blank's value can only ever be what its kind
 * allows (a link, a number in range, a colour, one of its choices, plain words), so a
 * value can never change the FFmpeg command beyond the place it was put.
 */

export const TEAM_STEP_PREFIX = "team-";

export const BLANK_KINDS = ["file", "text", "number", "color", "choice"] as const;
export type BlankKind = (typeof BLANK_KINDS)[number];

export interface TeamStepBlank {
  /** Its name in `{{name}}`: lowercase letters, digits and underscores. */
  name: string;
  /** What it is, in a few plain words; shown under the setting. */
  label: string;
  kind: BlankKind;
  default?: string | number;
  min?: number;
  max?: number;
  /** The values a "choice" may take. */
  options?: string[];
  /** A number that must be whole. */
  whole?: boolean;
}

export interface TeamStepTemplate {
  title: string;
  description: string;
  blanks: TeamStepBlank[];
  /** The file blank that takes the file from the step before. */
  primary: string | null;
  /** A /v1/ffmpeg/compose request with `{{name}}` where values go. */
  request: Record<string, unknown>;
}

/** What a saved team step is: its template, plus the id it is saved under. */
export type SavedTeamStep = TeamStepTemplate & { id: string };

const NAME = /^[a-z][a-z0-9_]{0,39}$/;
const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]{0,39})\s*\}\}/g;
const WHOLE_PLACEHOLDER = /^\{\{\s*([a-z][a-z0-9_]{0,39})\s*\}\}$/;
// Words that can sit inside a filter graph without ending it: no quotes, backslashes,
// colons, semicolons, commas, brackets or equals signs.
const SAFE_TEXT = /^[\p{L}\p{N} .!?'’&()+\-#@%]{1,200}$/u;
const SAFE_CHOICE = /^[A-Za-z0-9 ._+\-:/=,]{1,80}$/;
const COLOR = /^[A-Za-z]{1,20}$|^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

/** The schema one blank's value must meet. */
function blankSchema(blank: TeamStepBlank): z.ZodType {
  switch (blank.kind) {
    case "file":
      return z.string().url().describe(blank.label);
    case "number": {
      let number = z.number();
      if (blank.whole) number = number.int();
      if (blank.min !== undefined) number = number.min(blank.min);
      if (blank.max !== undefined) number = number.max(blank.max);
      const described = number.describe(blank.label);
      return typeof blank.default === "number" ? described.default(blank.default) : described;
    }
    case "color": {
      const color = z
        .string()
        .regex(COLOR, "A colour name such as white, or a hex value such as #FFCC00")
        .describe(blank.label);
      return typeof blank.default === "string" ? color.default(blank.default) : color;
    }
    case "choice": {
      const options = blank.options ?? [];
      const choice = z.enum(options as [string, ...string[]]).describe(blank.label);
      return typeof blank.default === "string" ? choice.default(blank.default) : choice;
    }
    default: {
      // "text": plain words; the ' is turned into ’ so it cannot end a quoted value.
      const text = z
        .string()
        .transform((value) => value.replace(/'/g, "’").replace(/\s+/g, " ").trim())
        .pipe(z.string().regex(SAFE_TEXT, "Letters, numbers, spaces and . ! ? - & ( ) only"))
        .describe(blank.label);
      return typeof blank.default === "string" ? text.default(blank.default) : text;
    }
  }
}

/** Every `{{name}}` used anywhere in a request. */
export function placeholdersIn(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    for (const match of value.matchAll(PLACEHOLDER)) found.add(match[1]);
  } else if (Array.isArray(value)) {
    for (const item of value) placeholdersIn(item, found);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) placeholdersIn(item, found);
  }
  return found;
}

/**
 * The request with every `{{name}}` filled. A string that is only `{{name}}` takes the
 * value as it is (a number stays a number); elsewhere the value is written into the text.
 */
export function fillRequest(value: unknown, values: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const whole = WHOLE_PLACEHOLDER.exec(value);
    if (whole) return values[whole[1]];
    return value.replace(PLACEHOLDER, (_, name: string) => String(values[name] ?? ""));
  }
  if (Array.isArray(value)) return value.map((item) => fillRequest(item, values));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, fillRequest(item, values)]),
    );
  }
  return value;
}

/** A value of the right kind for a blank, to check a template with before it is saved. */
function sampleOf(blank: TeamStepBlank): unknown {
  if (blank.default !== undefined) return blank.default;
  switch (blank.kind) {
    case "file":
      return "https://example.com/sample.mp4";
    case "number":
      return blank.min ?? blank.max ?? 1;
    case "color":
      return "white";
    case "choice":
      return blank.options?.[0] ?? "";
    default:
      return "Sample words";
  }
}

/**
 * What is wrong with a template, in plain words, or null when it can be saved. Checks
 * the blanks, that every `{{name}}` is a blank and every blank is used, that file blanks
 * are the inputs' links, and that the filled request is a valid compose request.
 */
export function teamStepProblem(template: TeamStepTemplate): string | null {
  const title = template.title?.trim() ?? "";
  if (title.length < 3 || title.length > 60) return "Give the step a title of 3 to 60 characters.";
  const description = template.description?.trim() ?? "";
  if (description.length < 10 || description.length > 400) {
    return "Describe what the step does in 10 to 400 characters.";
  }
  if (!Array.isArray(template.blanks) || template.blanks.length > 12) {
    return "A step can have up to 12 settings.";
  }
  const names = new Set<string>();
  for (const blank of template.blanks) {
    if (!NAME.test(blank.name)) {
      return `"${blank.name}" is not a usable setting name: lowercase letters, digits and _ only, starting with a letter.`;
    }
    if (names.has(blank.name)) return `There are two settings called "${blank.name}".`;
    names.add(blank.name);
    if (!BLANK_KINDS.includes(blank.kind)) return `"${blank.name}" has an unknown kind.`;
    if (!blank.label?.trim() || blank.label.length > 120) {
      return `Say in a few words what "${blank.name}" is (120 characters at most).`;
    }
    if (blank.kind === "choice") {
      const options = blank.options ?? [];
      if (options.length < 2 || options.length > 20) {
        return `"${blank.name}" needs 2 to 20 choices.`;
      }
      const bad = options.find((option) => !SAFE_CHOICE.test(option));
      if (bad !== undefined)
        return `The choice "${bad}" of "${blank.name}" has characters FFmpeg could misread.`;
      if (blank.default !== undefined && !options.includes(String(blank.default))) {
        return `The default of "${blank.name}" is not one of its choices.`;
      }
    }
    if (blank.kind === "number") {
      if (blank.min !== undefined && blank.max !== undefined && blank.min > blank.max) {
        return `"${blank.name}" has a lowest value above its highest.`;
      }
    }
    if (blank.default !== undefined) {
      const checked = blankSchema({ ...blank, default: undefined }).safeParse(blank.default);
      if (!checked.success) return `The default of "${blank.name}" does not fit it.`;
    }
  }
  if (template.primary !== null) {
    const primary = template.blanks.find((blank) => blank.name === template.primary);
    if (!primary || primary.kind !== "file") {
      return "The step's main input must be one of its file settings.";
    }
  }
  const used = placeholdersIn(template.request);
  for (const name of used) {
    if (!names.has(name)) return `The request uses {{${name}}}, which is not one of the settings.`;
  }
  for (const name of names) {
    if (!used.has(name)) return `The setting "${name}" is never used in the request.`;
  }
  const inputs = (template.request as { inputs?: unknown }).inputs;
  const fileBlanks = template.blanks.filter((blank) => blank.kind === "file").map((b) => b.name);
  if (fileBlanks.length === 0) return "The step needs at least one file setting for its input.";
  const inputLinks = Array.isArray(inputs)
    ? inputs.map((input) => String((input as { file_url?: unknown }).file_url ?? ""))
    : [];
  for (const name of fileBlanks) {
    if (!inputLinks.some((link) => WHOLE_PLACEHOLDER.exec(link)?.[1] === name)) {
      return `The file setting "${name}" must be the whole file_url of one of the inputs, written as {{${name}}}.`;
    }
  }
  for (const link of inputLinks) {
    const whole = WHOLE_PLACEHOLDER.exec(link)?.[1];
    if (!whole || !fileBlanks.includes(whole)) {
      return "Every input's file_url must be one of the file settings, such as {{video_url}}.";
    }
  }
  const sample = Object.fromEntries(template.blanks.map((blank) => [blank.name, sampleOf(blank)]));
  const filled = fillRequest(template.request, sample);
  const checked = ffmpegCompose.input.safeParse(filled);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    return `The request is not a valid FFmpeg compose request: ${issue.path.join(".") || "request"}: ${issue.message}`;
  }
  // Nothing in it may read, write or load a file on the toolkit (compose-guard.ts).
  const unsafe = composeProblem(filled as Record<string, unknown>);
  if (unsafe) return unsafe;
  for (const field of ["webhook_url", "id"]) {
    if (field in (template.request as Record<string, unknown>)) {
      return `Leave ${field} out of the request: the dashboard sets it.`;
    }
  }
  return null;
}

/** The step a saved team step is: one compose request filled from its blanks. */
export function teamStepDefinition(saved: SavedTeamStep): StepDefinition {
  const shape = Object.fromEntries(saved.blanks.map((blank) => [blank.name, blankSchema(blank)]));
  return defineStep({
    id: `${TEAM_STEP_PREFIX}${saved.id}`,
    category: "team",
    title: saved.title,
    description: saved.description,
    endpoint: ffmpegCompose.endpoint,
    method: "POST",
    output: "files",
    primaryInput: saved.primary,
    input: z.object(shape),
    toRequest: (blanks) => fillRequest(saved.request, blanks) as Record<string, unknown>,
  }) as unknown as StepDefinition;
}

export function isTeamStepId(stepId: string): boolean {
  return stepId.startsWith(TEAM_STEP_PREFIX);
}
