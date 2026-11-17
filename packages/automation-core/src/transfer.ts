/**
 * An automation as a file, so it can be kept, handed to someone else, or moved to another
 * team or another copy of the dashboard.
 *
 * The file holds what the canvas holds: the name, what starts it, the steps and their
 * settings, and the connections. It never holds anything that belongs to one team: a
 * setting that points at one of the team's own uploads (a logo, a music track) is left
 * out, and the step then takes it from the brand of whoever opens the file.
 *
 * A file can come from anywhere, so reading one trusts nothing in it. Everything is
 * checked and rebuilt, and what cannot be used is either left out with a note or stops
 * the import with a plain reason.
 */
import { getStep } from "@ncat-dash/step-catalog";

import { readUploadRef } from "./brand";
import { type AutomationEdge, type AutomationNode, graphProblem, MAX_NODES } from "./graph";
import { branchesOfKind, canFailOver, FAILURE_WAY } from "./logic";
import { type AutomationDraft, tidyPositions } from "./operations";
import { nodeTypeOf } from "./registry";
import { scheduleProblem } from "./schedule";
import type { StarterTrigger } from "./starters";

export const AUTOMATION_FILE_FORMAT = "ncat-dash-automation";
export const AUTOMATION_FILE_VERSION = 1;
/** The ending of an exported file's name. */
export const AUTOMATION_FILE_ENDING = ".automation.json";
/** The largest file that is read, in characters. The largest real one is far smaller. */
export const MAX_AUTOMATION_FILE_CHARS = 500_000;

export interface AutomationFile {
  format: typeof AUTOMATION_FILE_FORMAT;
  version: number;
  name: string;
  trigger: StarterTrigger;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  /** The team's sticky notes on the canvas. Files made before notes have none. */
  notes?: CanvasNote[];
}

/** A sticky note on an automation's canvas, as a file carries it. */
export interface CanvasNote {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MAX_CANVAS_NOTES = 30;
export const MAX_CANVAS_NOTE_CHARS = 2000;
export const CANVAS_NOTE_SIDES = { minWidth: 120, minHeight: 80, max: 800 };

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** A copy of some settings without anything that points at a team's own uploads. */
function withoutUploads(value: unknown, dropped: { count: number }): unknown {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (readUploadRef(item)) {
        dropped.count++;
        return [];
      }
      return [withoutUploads(item, dropped)];
    });
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) => {
        if (readUploadRef(item)) {
          dropped.count++;
          return [];
        }
        return [[key, withoutUploads(item, dropped)]];
      }),
    );
  }
  return value;
}

function uploadsNote(count: number, reader: "export" | "import"): string {
  const what = `${count} ${plural(count, "setting", "settings")} that pointed at ${
    reader === "export" ? "one of your own uploads" : "another team's uploads"
  }`;
  return reader === "export"
    ? `Left out ${what}, such as a logo or a music track. Whoever opens the file gets their own from Settings.`
    : `Left out ${what}. Those steps use your own logo and music from Settings.`;
}

/** The automation as a file, with a note for anything that was left out. */
export function exportAutomation(
  draft: AutomationDraft,
  canvasNotes: CanvasNote[] = [],
): {
  file: AutomationFile;
  notes: string[];
} {
  const dropped = { count: 0 };
  const nodes = draft.nodes.map((node) => ({
    ...node,
    input: withoutUploads(node.input, dropped) as Record<string, unknown>,
  }));
  return {
    file: {
      format: AUTOMATION_FILE_FORMAT,
      version: AUTOMATION_FILE_VERSION,
      name: draft.name,
      trigger: draft.trigger,
      nodes,
      edges: draft.edges.map(({ id, source, target, branch }) => ({
        id,
        source,
        target,
        ...(branch ? { branch } : {}),
      })),
      ...(canvasNotes.length > 0
        ? {
            notes: canvasNotes.map(({ text, x, y, width, height }) => ({
              text,
              x,
              y,
              width,
              height,
            })),
          }
        : {}),
    },
    notes: dropped.count > 0 ? [uploadsNote(dropped.count, "export")] : [],
  };
}

/** A file name for an automation: "Clips for social" becomes "clips-for-social.automation.json". */
export function automationFileName(name: string): string {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${stem || "automation"}${AUTOMATION_FILE_ENDING}`;
}

export type ReadAutomationFile =
  | { ok: true; draft: AutomationDraft; notes: string[]; canvasNotes: CanvasNote[] }
  | { ok: false; message: string };

const NOT_A_FILE =
  "This is not an automation file. Export one from an automation's page and choose that.";
const FILE_TYPES = ["any", "video", "audio", "image"];
const KINDS = ["step", "approval", "clips", "export", "if", "wait", "automation"];
const MAX_DEPTH = 12;
// Names the database accepts for a setting: plain text that does not start with $ or _.
const SAFE_KEY = /^(?![$_])[\x20-\x7e]{1,200}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class Unreadable extends Error {}

/** A copy of JSON-like data made of plain objects, arrays, text, numbers and yes/no only. */
function plain(value: unknown, depth: number, dropped: { keys: number }): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Unreadable();
    return value;
  }
  if (depth > MAX_DEPTH) throw new Unreadable();
  if (Array.isArray(value)) return value.map((item) => plain(item, depth + 1, dropped));
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) => {
        if (!SAFE_KEY.test(key)) {
          dropped.keys++;
          return [];
        }
        return [[key, plain(item, depth + 1, dropped)]];
      }),
    );
  }
  throw new Unreadable();
}

function readTrigger(value: unknown, notes: string[]): StarterTrigger {
  const fallback = (): StarterTrigger => {
    notes.push("The file did not say how the automation starts, so it starts by hand for now.");
    return { kind: "manual" };
  };
  if (!isObject(value)) return fallback();
  const fileType = FILE_TYPES.includes(value.fileType as string)
    ? (value.fileType as "any" | "video" | "audio" | "image")
    : "any";
  switch (value.kind) {
    case "manual":
    case "webhook":
      return { kind: value.kind };
    case "upload": {
      const seconds = (name: string) => {
        const amount = value[name];
        return typeof amount === "number" && Number.isFinite(amount) && amount >= 0
          ? { [name]: amount }
          : {};
      };
      return { kind: "upload", fileType, ...seconds("minSeconds"), ...seconds("maxSeconds") };
    }
    case "folder":
      return {
        kind: "folder",
        prefix: typeof value.prefix === "string" ? value.prefix.slice(0, 500) : "",
        fileType,
      };
    case "finished":
      // The automation it followed belongs to the team the file came from.
      notes.push(
        "It started when another automation finished. That automation is not part of the file, so it starts by hand for now.",
      );
      return { kind: "manual" };
    case "schedule": {
      const schedule = value.schedule;
      if (isObject(schedule)) {
        const read =
          schedule.mode === "interval" && typeof schedule.minutes === "number"
            ? { mode: "interval" as const, minutes: schedule.minutes }
            : schedule.mode === "daily" &&
                typeof schedule.time === "string" &&
                typeof schedule.timeZone === "string"
              ? { mode: "daily" as const, time: schedule.time, timeZone: schedule.timeZone }
              : null;
        if (read && !scheduleProblem(read)) return { kind: "schedule", schedule: read };
      }
      notes.push(
        "The file's timetable could not be read, so the automation starts by hand for now.",
      );
      return { kind: "manual" };
    }
    default:
      return fallback();
  }
}

function readNodes(
  value: unknown,
  notes: string[],
): { nodes: AutomationNode[]; placed: boolean } | string {
  if (!Array.isArray(value)) return NOT_A_FILE;
  if (value.length > MAX_NODES) return `An automation can have at most ${MAX_NODES} steps.`;
  const nodes: AutomationNode[] = [];
  const dropped = { keys: 0, uploads: { count: 0 }, unknown: [] as string[], automations: 0 };
  let placed = true;
  for (const raw of value) {
    if (!isObject(raw)) return NOT_A_FILE;
    const { id, kind, stepId, label, input, position } = raw;
    if (typeof id !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(id)) return NOT_A_FILE;
    if (nodes.some((node) => node.id === id)) return "Two steps in the file share the same id.";
    if (typeof kind !== "string" || !KINDS.includes(kind)) {
      return `The file has a kind of step this dashboard does not have${
        typeof kind === "string" ? `: ${kind.slice(0, 40)}` : ""
      }. It may come from a newer version.`;
    }
    if (kind === "step" && (typeof stepId !== "string" || !getStep(stepId))) {
      return `The file uses a step this dashboard does not have${
        typeof stepId === "string" ? `: ${stepId.slice(0, 60)}` : ""
      }. It may come from a newer version.`;
    }
    let settings: Record<string, unknown>;
    try {
      settings = withoutUploads(
        plain(isObject(input) ? input : {}, 0, dropped),
        dropped.uploads,
      ) as Record<string, unknown>;
    } catch {
      return "The file's settings could not be read.";
    }
    const node: AutomationNode = {
      id,
      kind: kind as AutomationNode["kind"],
      ...(kind === "step" ? { stepId: stepId as string } : {}),
      ...(typeof label === "string" && label.trim() ? { label: label.trim().slice(0, 60) } : {}),
      input: settings,
      position: { x: 0, y: 0 },
    };
    // The automation a "Run an automation" step ran belongs to the team the file came from.
    if (kind === "automation" && node.input.automation !== undefined) {
      delete node.input.automation;
      dropped.automations++;
    }
    // A setting this version does not know would be refused the next time it is changed.
    const known = nodeTypeOf(node)?.settings.properties ?? {};
    for (const name of Object.keys(node.input)) {
      if (!Object.hasOwn(known, name)) {
        delete node.input[name];
        dropped.unknown.push(name);
      }
    }
    if (
      isObject(position) &&
      typeof position.x === "number" &&
      typeof position.y === "number" &&
      Number.isFinite(position.x) &&
      Number.isFinite(position.y)
    ) {
      node.position = {
        x: Math.max(-100_000, Math.min(100_000, Math.round(position.x))),
        y: Math.max(-100_000, Math.min(100_000, Math.round(position.y))),
      };
    } else {
      placed = false;
    }
    nodes.push(node);
  }
  if (dropped.uploads.count > 0) notes.push(uploadsNote(dropped.uploads.count, "import"));
  if (dropped.automations > 0) {
    notes.push(
      `${plural(dropped.automations, "A Run an automation step needs", "Run an automation steps need")} the automation to run picked again, since it is not part of the file.`,
    );
  }
  const unknown = [...new Set(dropped.unknown)];
  if (unknown.length > 0 || dropped.keys > 0) {
    const count = unknown.length + dropped.keys;
    notes.push(
      `Left out ${count} ${plural(count, "setting", "settings")} this version does not use${
        unknown.length > 0 ? `: ${unknown.slice(0, 5).join(", ")}` : ""
      }.`,
    );
  }
  return { nodes, placed };
}

function readEdges(value: unknown, nodes: AutomationNode[]): AutomationEdge[] | string {
  if (!Array.isArray(value)) return NOT_A_FILE;
  if (value.length > MAX_NODES * 4) return "The file has too many connections.";
  const kinds = new Map(nodes.map((node) => [node.id, node.kind]));
  const edges: AutomationEdge[] = [];
  for (const raw of value) {
    if (!isObject(raw)) return NOT_A_FILE;
    const { source, target, branch } = raw;
    if (typeof source !== "string" || typeof target !== "string") return NOT_A_FILE;
    if (!kinds.has(source) || !kinds.has(target)) {
      return "A connection in the file points at a step that is not in it.";
    }
    if (edges.some((edge) => edge.source === source && edge.target === target)) continue;
    const ways = branchesOfKind(kinds.get(source));
    edges.push({
      id: `${source}>${target}`,
      source,
      target,
      // A line out of an If that names no way, or one that does not exist, leaves by the first.
      ...(ways.length > 0
        ? { branch: ways.includes(branch as string) ? (branch as string) : ways[0] }
        : branch === FAILURE_WAY && canFailOver(kinds.get(source))
          ? { branch: FAILURE_WAY }
          : {}),
    });
  }
  return edges;
}

/**
 * Reads what was parsed from an automation file into an automation that can be saved.
 * `notes` says, in plain words, what was changed or left out on the way.
 */
export function readAutomationFile(value: unknown): ReadAutomationFile {
  if (!isObject(value) || value.format !== AUTOMATION_FILE_FORMAT) {
    return { ok: false, message: NOT_A_FILE };
  }
  if (typeof value.version !== "number" || value.version > AUTOMATION_FILE_VERSION) {
    return {
      ok: false,
      message: "This file was made by a newer version of the dashboard. Update, then import it.",
    };
  }
  const notes: string[] = [];
  const name =
    (typeof value.name === "string" ? value.name.trim().slice(0, 80) : "") || "Imported automation";
  const trigger = readTrigger(value.trigger, notes);
  const read = readNodes(value.nodes, notes);
  if (typeof read === "string") return { ok: false, message: read };
  const edges = readEdges(value.edges ?? [], read.nodes);
  if (typeof edges === "string") return { ok: false, message: edges };

  let nodes = read.nodes;
  // A file with no usable places for its steps is laid out left to right.
  if (!read.placed) {
    const positions = tidyPositions(
      nodes.map((node) => node.id),
      edges,
    );
    nodes = nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? { x: 0, y: 0 } }));
  }
  // An automation with no steps yet is fine to import; one that loops is not.
  const problem = nodes.length > 0 ? graphProblem(nodes, edges) : null;
  if (problem) return { ok: false, message: `The file cannot be used. ${problem}` };
  const canvasNotes = readCanvasNotes(value.notes, notes);
  return { ok: true, draft: { name, trigger, nodes, edges }, notes, canvasNotes };
}

/** The file's sticky notes that can be used. Anything unreadable is left out, and said so. */
function readCanvasNotes(value: unknown, notes: string[]): CanvasNote[] {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [];
  const read: CanvasNote[] = [];
  let skipped = Array.isArray(value) ? 0 : 1;
  const place = (n: unknown) =>
    typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1_000_000;
  const side = (n: number, least: number) =>
    Math.min(CANVAS_NOTE_SIDES.max, Math.max(least, Math.round(n)));
  for (const item of list) {
    if (
      read.length >= MAX_CANVAS_NOTES ||
      !isObject(item) ||
      typeof item.text !== "string" ||
      ![item.x, item.y, item.width, item.height].every(place)
    ) {
      skipped++;
      continue;
    }
    read.push({
      text: item.text.slice(0, MAX_CANVAS_NOTE_CHARS),
      x: Math.round(item.x as number),
      y: Math.round(item.y as number),
      width: side(item.width as number, CANVAS_NOTE_SIDES.minWidth),
      height: side(item.height as number, CANVAS_NOTE_SIDES.minHeight),
    });
  }
  if (skipped > 0) {
    notes.push(
      `Left out ${skipped} ${plural(skipped, "note", "notes")} on the canvas that could not be read.`,
    );
  }
  return read;
}

/** Reads the text of an automation file. */
export function parseAutomationFile(text: string): ReadAutomationFile {
  if (text.length > MAX_AUTOMATION_FILE_CHARS) {
    return { ok: false, message: "This file is too large to be an automation." };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, message: NOT_A_FILE };
  }
  return readAutomationFile(value);
}
