import { z } from "zod";

export type StepCategory =
    | "video"
  | "audio"
  | "media"
  | "image"
  | "recipe"
  | "team"
  | "ffmpeg"
  | "code"
  | "storage";

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
  /**
   * The toolkit's full request schema, including the runner fields. For a recipe it is
   * the blanks a person fills in, and `toRequest` turns them into the toolkit's request.
   */
  input: TInput;
  /**
   * Named things a finished step hands on besides files, such as a transcript: the name,
   * then where it sits in the step's result. A later step that takes that name gets it
   * without anyone wiring it.
   */
  values?: Record<string, string>;
  /**
   * Settings this step needs switched on to make one of its values. Applied by the runner
   * only when a later step is waiting for that value.
   */
  valueSettings?: Record<string, Record<string, unknown>>;
  /**
   * Settings that take a named value from an earlier step when they are left empty.
   * `when` says, from the step's own settings, whether taking it is safe.
   */
  valueInputs?: Record<
    string,
    { value: string; when?: (settings: Record<string, unknown>) => boolean }
  >;
  /**
   * Settings filled from the team's brand (its logo, colour, font or music in Settings)
   * when they are left empty on the step.
   */
  brandInputs?: Record<string, "logo" | "color" | "font" | "music" | "card" | "intro" | "outro">;
  /**
   * Settings filled from the file that started the run when they are left empty, such as
   * its name for a title. The name, then what is taken: only "file_name" today.
   */
  startInputs?: Record<string, "file_name">;
  /**
   * File settings whose length, picture size and sound are read from the toolkit just
   * before the request is built, so the request can fit them exactly. `toRequest` gets
   * what was read, by setting name.
   */
  readsFirst?: string[];
  /** Builds the toolkit request from the filled-in blanks. Only recipes have one. */
  toRequest?: (input: z.output<TInput>, facts: FileFacts) => Record<string, unknown>;
}

/** What was read about a file before the request was built. Missing when it could not be read. */
export interface MediaFacts {
  /** Length in seconds. */
  duration?: number;
  width?: number;
  height?: number;
  /** Frames per second. */
  fps?: number;
  hasVideo?: boolean;
  hasAudio?: boolean;
}

/** The facts read for each setting named in `readsFirst`. */
export type FileFacts = Record<string, MediaFacts | undefined>;

/**
 * A request that cannot be built from what was set or read, such as an outro when the team
 * has none. The message is shown to the person as it is, and trying again will not help.
 */
export class StepSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepSetupError";
  }
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
  // "input" so a blank with a default is shown as optional, with its default.
  return z.toJSONSchema(userInputSchema(step), { io: "input" });
}
