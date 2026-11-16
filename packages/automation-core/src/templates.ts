/**
 * What a placeholder can read while a step is being prepared.
 *
 *   {{input}}                    the file this step is working on
 *   {{inputs}}                   every file that came into this step
 *   {{trigger.file_url}}         the file that started the run
 *   {{trigger.body.title}}       a value from the webhook body that started the run
 *   {{steps.<id>.url}}           the first file an earlier step produced
 *   {{steps.<id>.urls}}          every file an earlier step produced
 *   {{steps.<id>.result.text}}   a value from an earlier step's result
 */
export interface TemplateContext {
  input?: string;
  inputs: string[];
  trigger: Record<string, unknown>;
  steps: Record<string, { url?: string; urls: string[]; result?: unknown }>;
}

const WHOLE = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/;
const PART = /\{\{\s*([^{}]+?)\s*\}\}/g;

function lookup(path: string, context: TemplateContext): unknown {
  let current: unknown = context;
  for (const key of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) current = current[Number(key)];
    else if (typeof current === "object") {
      if (!Object.prototype.hasOwnProperty.call(current, key)) return undefined;
      current = (current as Record<string, unknown>)[key];
    } else return undefined;
  }
  return current;
}

export class TemplateError extends Error {}

/**
 * Fills the placeholders in a step's settings. A value that is exactly one placeholder
 * keeps the type of what it points at (a list stays a list); a placeholder inside longer
 * text is written in as text. A placeholder that points at nothing is an error, so a
 * step never runs on a half-filled value.
 */
export function fillTemplates<T>(value: T, context: TemplateContext): T {
  if (typeof value === "string") {
    const whole = WHOLE.exec(value);
    if (whole) {
      const found = lookup(whole[1], context);
      if (found === undefined) throw new TemplateError(`Nothing to fill in for {{${whole[1]}}}.`);
      return found as T;
    }
    return value.replace(PART, (_, path: string) => {
      const found = lookup(path, context);
      if (found === undefined) throw new TemplateError(`Nothing to fill in for {{${path}}}.`);
      return typeof found === "string" ? found : JSON.stringify(found);
    }) as T;
  }
  if (Array.isArray(value)) return value.map((item) => fillTemplates(item, context)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, fillTemplates(item, context)]),
    ) as T;
  }
  return value;
}

/** How a step's incoming files are wired in when its settings leave the field empty. */
export interface StepWiring {
  /** The one field that takes a file URL, if the step has one. */
  primaryInput: string | null;
  /** A list field that takes every incoming file, such as video_urls on "join videos". */
  listInput?: { field: string; itemKey: string } | null;
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)
  );
}

/**
 * Turns one step's settings into the inputs of the jobs to run.
 *
 * - The step takes one file and the field is left empty: one job per incoming file, so
 *   five clips from a split are captioned as five jobs.
 * - The step takes a list of files and the list is left empty: one job with them all.
 * - Otherwise: one job, exactly as set.
 */
export function planJobs(
  wiring: StepWiring,
  settings: Record<string, unknown>,
  context: Omit<TemplateContext, "input">,
): Record<string, unknown>[] {
  const { primaryInput, listInput } = wiring;

  if (primaryInput && isEmpty(settings[primaryInput])) {
    if (context.inputs.length === 0) {
      throw new TemplateError("No file reached this step. Connect it to a step that makes one.");
    }
    return context.inputs.map((url) => ({
      ...fillTemplates(settings, { ...context, input: url }),
      [primaryInput]: url,
    }));
  }

  const first = context.inputs[0];
  const filled = fillTemplates(settings, { ...context, input: first });
  if (listInput && isEmpty(settings[listInput.field])) {
    if (context.inputs.length === 0) {
      throw new TemplateError("No file reached this step. Connect it to a step that makes one.");
    }
    return [
      {
        ...filled,
        [listInput.field]: context.inputs.map((url) => ({ [listInput.itemKey]: url })),
      },
    ];
  }
  return [filled];
}
