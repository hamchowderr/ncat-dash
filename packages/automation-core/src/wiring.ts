/**
 * How a step gets its files without anyone wiring them by hand.
 *
 * Every step says which field takes a file and, by that field's name, what kind of file
 * it wants. When the run reaches the step it is given the nearest files of that kind
 * before it: the step straight before if that made some, otherwise further back, and
 * last the file that started the run. So captions placed after a transcript step still
 * get the video, not the transcript.
 *
 * A person or the agent can point a field somewhere else ("the file that started the
 * run", "the file from Add a logo"). That choice is kept in the settings as a reference
 * the runner fills in; nobody types one.
 */
import { getStep } from "@ncat-dash/step-catalog";

import { fileFamily } from "./files";
import type { AutomationEdge, AutomationNode } from "./graph";
import type { NodeType } from "./registry";

export type FileKind = "video" | "audio" | "image" | "media" | "any";

/** What kind of file a settings field wants, going by its name. */
export function wantedKind(field: string | null | undefined): FileKind {
  if (!field) return "any";
  if (/^(video|reaction)_urls?$/.test(field)) return "video";
  if (/^(audio|music)_urls?$/.test(field)) return "audio";
  if (/^(image|background|overlay|logo)_urls?$/.test(field)) return "image";
  if (/^media_urls?$/.test(field)) return "media";
  return "any";
}

export const KIND_WORDS: Record<FileKind, string> = {
  video: "video",
  audio: "audio file",
  image: "picture",
  media: "video or audio file",
  any: "file",
};

/** Whether a file at this address can be used where `kind` is wanted. */
export function fits(url: string, kind: FileKind): boolean {
  if (kind === "any") return true;
  const path = url.split(/[?#]/)[0];
  const family = fileFamily(path);
  // Captions, transcripts and data are never a video, a sound or a picture. Any other
  // address with no recognisable ending could be anything, so it is let through.
  if (family === "other") return !NOT_MEDIA.test(path);
  if (kind === "media") return family === "video" || family === "audio";
  return family === kind;
}

const NOT_MEDIA = /\.(srt|vtt|ass|ssa|json|txt|csv|md|html?|xml|pdf|zip)$/i;

/**
 * Picks a step's files from what came before it. `levels` holds the files nearest first:
 * the steps straight before, then the steps before those, and so on, ending with the
 * file that started the run. The first level with a file of the wanted kind wins. When
 * nothing fits anywhere, the nearest files are handed over as they are.
 */
export function chooseFiles(kind: FileKind, levels: string[][]): string[] {
  for (const level of levels) {
    const fitting = level.filter((url) => fits(url, kind));
    if (fitting.length > 0) return fitting;
  }
  return levels.find((level) => level.length > 0) ?? [];
}

/** The steps before `nodeId`, nearest first: its sources, then theirs, and so on. */
export function stepsBefore(nodeId: string, edges: AutomationEdge[]): string[][] {
  const levels: string[][] = [];
  const seen = new Set([nodeId]);
  let current = [nodeId];
  while (current.length > 0) {
    const next: string[] = [];
    for (const id of current) {
      for (const edge of edges) {
        if (edge.target === id && !seen.has(edge.source)) {
          seen.add(edge.source);
          next.push(edge.source);
        }
      }
    }
    if (next.length > 0) levels.push(next);
    current = next;
  }
  return levels;
}

/** Where a file field gets its file. */
export type Source =
  /** The nearest fitting file before the step. Only the step's main file field can be this. */
  | { from: "auto" }
  | { from: "trigger" }
  | { from: "step"; id: string }
  /** One fixed address, the same on every run. */
  | { from: "fixed"; value: string };

const TRIGGER_REF = "{{trigger.file_url}}";
const STEP_REF = /^\{\{\s*steps\.([A-Za-z0-9_]+)\.url\s*\}\}$/;
const ANY_STEP_REF = /\{\{\s*steps\.([A-Za-z0-9_]+)\./g;

/** Reads a saved setting back into where it points. */
export function readSource(value: unknown): Source {
  if (value === undefined || value === null || value === "") return { from: "auto" };
  if (typeof value !== "string") return { from: "fixed", value: JSON.stringify(value) };
  if (/^\{\{\s*trigger\.file_url\s*\}\}$/.test(value)) return { from: "trigger" };
  const step = STEP_REF.exec(value);
  if (step) return { from: "step", id: step[1] };
  return { from: "fixed", value };
}

/** The setting to save for a source. Undefined means leave the field empty. */
export function writeSource(source: Source): string | undefined {
  switch (source.from) {
    case "auto":
      return undefined;
    case "trigger":
      return TRIGGER_REF;
    case "step":
      return `{{steps.${source.id}.url}}`;
    case "fixed":
      return source.value || undefined;
  }
}

/** The settings of a node type that take a file address. */
export function fileFields(nodeType: NodeType): string[] {
  return Object.entries(nodeType.settings.properties ?? {})
    .filter(([, property]) => {
      const schema = property as { type?: string; format?: string };
      return schema.type === "string" && schema.format === "uri";
    })
    .map(([name]) => name);
}

/** The ids of every step a node's settings point at. */
export function referencedSteps(settings: unknown): string[] {
  const found = new Set<string>();
  for (const match of JSON.stringify(settings ?? {}).matchAll(ANY_STEP_REF)) found.add(match[1]);
  return [...found];
}

/** Settings with every field that points at one of `removed` cleared. */
export function withoutReferencesTo(
  settings: Record<string, unknown>,
  removed: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(settings).filter(
      ([, value]) => !referencedSteps(value).some((id) => removed.includes(id)),
    ),
  );
}

function blank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function at(result: unknown, path: string): unknown {
  let current = result;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Where each empty value setting of a step will be filled from: the nearest earlier step
 * that makes a value of that name. A setting with no such step before it is left out,
 * and the step then does what it does with the setting empty.
 */
export function valueSources(
  node: AutomationNode,
  nodes: AutomationNode[],
  edges: AutomationEdge[],
): { field: string; value: string; from: AutomationNode }[] {
  const wanted = Object.entries(getStep(node.stepId ?? "")?.valueInputs ?? {});
  if (node.kind !== "step" || wanted.length === 0) return [];
  const before = stepsBefore(node.id, edges)
    .flat()
    .flatMap((id) => nodes.find((candidate) => candidate.id === id) ?? []);
  return wanted.flatMap(([field, { value, when }]) => {
    if (!blank(node.input[field]) || (when && !when(node.input))) return [];
    const from = before.find(
      (other) => other.kind === "step" && getStep(other.stepId ?? "")?.values?.[value],
    );
    return from ? [{ field, value, from }] : [];
  });
}

/**
 * The settings to add to a step so it makes what later steps are waiting for. A
 * transcript step followed by captions is told to write caption timings too.
 */
export function settingsForLaterSteps(
  node: AutomationNode,
  nodes: AutomationNode[],
  edges: AutomationEdge[],
): Record<string, unknown> {
  const step = node.kind === "step" ? getStep(node.stepId ?? "") : undefined;
  if (!step?.valueSettings) return {};
  const extra: Record<string, unknown> = {};
  for (const later of nodes) {
    for (const source of valueSources(later, nodes, edges)) {
      if (source.from.id !== node.id) continue;
      for (const [name, value] of Object.entries(step.valueSettings[source.value] ?? {})) {
        if (blank(node.input[name])) extra[name] = value;
      }
    }
  }
  return extra;
}

/** Reads a named value out of a finished step's result. Undefined when it is not there. */
export function valueFrom(stepId: string, value: string, result: unknown): unknown {
  const path = getStep(stepId)?.values?.[value];
  if (!path) return undefined;
  const found = at(result, path);
  return blank(found) ? undefined : found;
}
