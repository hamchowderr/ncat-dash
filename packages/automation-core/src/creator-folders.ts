// A watched folder laid out one folder per creator, the way UGC teams hand over raw
// footage: <creator>/hooks/, <creator>/body/ and, when there are other calls to action,
// <creator>/endings/. Each creator's files together start one run of hook and ending
// variants, once nothing new has landed in their folders for a few minutes. No AI: the
// folder names say what each file is.

import { BODY_ONLY } from "@takewon/step-catalog";

import type { AutomationNode } from "./graph";

/** One file seen in the watched folder. */
export interface FolderObject {
  key: string;
  etag: string;
  size: number;
  lastModified: number;
}

export type TakePart = "hook" | "body" | "ending";

/** Folder names, in any case, and what they hold. */
const PART_NAMES: Record<string, TakePart> = {
  hook: "hook",
  hooks: "hook",
  body: "body",
  bodies: "body",
  ending: "ending",
  endings: "ending",
  cta: "ending",
  ctas: "ending",
};

/** The most takes the hook and ending variants step pairs up. */
export const MOST_HOOKS = 5;
export const MOST_ENDINGS = 3;

/** How long a creator's folders must stay still before their run starts: uploads come one by one. */
export const SETTLE_MS = 3 * 60 * 1000;

/**
 * Where a key sits under the watched folder: its creator ("" when the hooks and body
 * folders are straight inside the watched folder) and which part it is. Null for any
 * other file, such as one at the top or in a folder of another name.
 */
export function creatorPartOf(
  key: string,
  prefix: string,
): { creator: string; part: TakePart } | null {
  if (!key.startsWith(prefix) || key.endsWith("/")) return null;
  const parts = key.slice(prefix.length).split("/");
  if (parts.some((part) => part === "")) return null;
  if (parts.length === 3) {
    const part = PART_NAMES[parts[1].toLowerCase()];
    return part ? { creator: parts[0].trim(), part } : null;
  }
  if (parts.length === 2) {
    const part = PART_NAMES[parts[0].toLowerCase()];
    return part ? { creator: "", part } : null;
  }
  return null;
}

/** One creator's takes, ready to make variants from. */
export interface CreatorSet {
  /** The creator's folder name; "" when there is no creator folder. */
  creator: string;
  /** The newest file in body/. */
  body: FolderObject;
  /** Hook takes in name order, at most MOST_HOOKS. */
  hooks: FolderObject[];
  /** Ending takes in name order, at most MOST_ENDINGS. */
  endings: FolderObject[];
  /** Every file of the creator's, used or not, to mark as seen. */
  files: FolderObject[];
}

const byName = (a: FolderObject, b: FolderObject) =>
  a.key.localeCompare(b.key, undefined, { numeric: true });

/**
 * Groups the watched folder's files by creator. Only creators with a body and at least one
 * hook take come back, and only once their newest file is at least SETTLE_MS old, so a
 * set that is still uploading waits. `isVideo` says which files count.
 */
export function creatorSets(
  objects: FolderObject[],
  prefix: string,
  now: number,
  isVideo: (key: string) => boolean,
): CreatorSet[] {
  const groups = new Map<string, { part: TakePart; object: FolderObject }[]>();
  for (const object of objects) {
    if (object.size <= 0 || !isVideo(object.key)) continue;
    const place = creatorPartOf(object.key, prefix);
    if (!place) continue;
    const group = groups.get(place.creator) ?? [];
    group.push({ part: place.part, object });
    groups.set(place.creator, group);
  }
  const sets: CreatorSet[] = [];
  for (const [creator, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const newest = Math.max(...group.map(({ object }) => object.lastModified));
    if (now - newest < SETTLE_MS) continue;
    const of = (part: TakePart) =>
      group.filter((each) => each.part === part).map(({ object }) => object);
    const bodies = of("body").sort((a, b) => b.lastModified - a.lastModified);
    const hooks = of("hook").sort(byName).slice(0, MOST_HOOKS);
    if (bodies.length === 0 || hooks.length === 0) continue;
    sets.push({
      creator,
      body: bodies[0],
      hooks,
      endings: of("ending").sort(byName).slice(0, MOST_ENDINGS),
      files: group.map(({ object }) => object),
    });
  }
  return sets;
}

/** One take handed to the run: a link to read it and its name. */
export interface TakeLink {
  file_url: string;
  file_name: string;
}

/** What a creator set's run is started with, besides the body as its file. */
export interface CreatorTakes {
  creator: string;
  hooks: TakeLink[];
  endings: TakeLink[];
}

const VARIANTS_STEP = "recipe-hook-variants";
const CREATOR_STEPS = new Set([VARIANTS_STEP, "recipe-length-cuts"]);

/**
 * The run's steps with a creator set's takes filled in: the hook and ending variants step
 * gets the hook and ending takes, with the base cut being only the body, and it and the
 * length cuts step get the creator's name. Steps of other kinds are left as they are.
 */
export function withCreatorTakes(nodes: AutomationNode[], takes: CreatorTakes): AutomationNode[] {
  return nodes.map((node) => {
    if (node.kind !== "step" || !CREATOR_STEPS.has(node.stepId ?? "")) return node;
    const input: Record<string, unknown> = { ...node.input };
    if (takes.creator) input.creator = takes.creator.slice(0, 80);
    if (node.stepId === VARIANTS_STEP) {
      for (let n = 1; n <= MOST_HOOKS; n++) delete input[`hook_${n}_url`];
      for (let n = 1; n <= MOST_ENDINGS; n++) delete input[`ending_${n}_url`];
      input.base_cut = BODY_ONLY;
      takes.hooks
        .slice(0, MOST_HOOKS)
        .forEach((take, at) => (input[`hook_${at + 1}_url`] = take.file_url));
      takes.endings
        .slice(0, MOST_ENDINGS)
        .forEach((take, at) => (input[`ending_${at + 1}_url`] = take.file_url));
    }
    return { ...node, input };
  });
}
