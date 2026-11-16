import { z } from "zod";

export type StepCategory = "video" | "audio" | "media" | "image" | "ffmpeg" | "code" | "storage";

/**
 * What a finished step hands to the next one.
 * - file: one output URL
 * - files: several output URLs (for example one per clip)
 * - json: structured data (metadata, a transcript, silence ranges)
 */
export type StepOutputKind = "file" | "files" | "json";

/** Fields the runner sets itself, so they never appear in a form or a saved workflow. */
export const RUNNER_FIELDS = ["webhook_url", "id"] as const;

export interface StepDefinition<TInput extends z.ZodObject = z.ZodObject> {
  /** Stable id, saved in workflows. Never rename one that has shipped. */
  id: string;
  category: StepCategory;
  /** Short label for the canvas node and the form heading. */
  title: string;
  /** One or two sentences; also the tool description the agent reads. */
  description: string;
  /** Path on the NCA Toolkit, for example /v1/video/trim. */
  endpoint: string;
  method: "GET" | "POST";
  output: StepOutputKind;
  /** The field that takes the previous step's output URL, when there is exactly one. */
  primaryInput: string | null;
  /** A list field that takes every incoming file, such as video_urls on "Join videos". */
  listInput?: { field: string; itemKey: string };
  /** The toolkit's full request schema, including the runner fields. */
  input: TInput;
}

export function defineStep<TInput extends z.ZodObject>(
  step: StepDefinition<TInput>,
): StepDefinition<TInput> {
  return step;
}

/** The schema a person or the agent fills in: the toolkit schema minus the runner fields. */
export function userInputSchema(step: StepDefinition): z.ZodObject {
  const shape = { ...step.input.shape };
  for (const field of RUNNER_FIELDS) delete shape[field];
  return z.object(shape);
}

/** JSON Schema for building a form or describing the step to a model. */
export function userInputJsonSchema(step: StepDefinition) {
  return z.toJSONSchema(userInputSchema(step));
}
