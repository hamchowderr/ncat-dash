/**
 * Undo and redo for the canvas, and what differs between a draft and the live automation.
 * Both work on whole automations as plain data, so they need nothing from the canvas.
 */
import type { AutomationNode } from "./graph";
import type { AutomationDraft } from "./operations";
import { nodeTypeOf } from "./registry";

/** JSON with keys in a fixed order, so two copies of the same thing compare equal. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );
}

/** How many steps back undo can go. */
export const HISTORY_LIMIT = 100;
/** Changes closer together than this count as one, so a word typed is one undo. */
export const HISTORY_MERGE_MS = 700;

export interface History {
  /** Earlier states, oldest first. Undo goes to the last one. */
  past: AutomationDraft[];
  /** The automation as it is now. */
  present: AutomationDraft;
  /** States that were undone, nearest first. Redo goes to the first one. */
  future: AutomationDraft[];
  /** When `present` last changed, for merging quick changes. Null stops the next merge. */
  changedAt: number | null;
}

export function startHistory(present: AutomationDraft): History {
  return { past: [], present, future: [], changedAt: null };
}

/**
 * Notes a new state. A change that follows the last one closely replaces it instead of
 * adding a step, unless `merge` is false. Anything that was undone can no longer be redone.
 * Returns the same history when nothing changed.
 */
export function record(
  history: History,
  next: AutomationDraft,
  now: number,
  options: { merge?: boolean } = {},
): History {
  if (canonical(next) === canonical(history.present)) return history;
  const merging =
    options.merge !== false &&
    history.changedAt !== null &&
    history.past.length > 0 &&
    now - history.changedAt < HISTORY_MERGE_MS;
  if (merging) {
    // Back where the run of changes began: drop the step instead of keeping an empty one.
    const before = history.past[history.past.length - 1];
    if (canonical(before) === canonical(next)) {
      return { past: history.past.slice(0, -1), present: next, future: [], changedAt: now };
    }
    return { ...history, present: next, future: [], changedAt: now };
  }
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
    changedAt: options.merge === false ? null : now,
  };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

/** Goes back one step. Returns the same history when there is nothing to undo. */
export function undo(history: History): History {
  if (history.past.length === 0) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
    changedAt: null,
  };
}

/** Goes forward one step. Returns the same history when there is nothing to redo. */
export function redo(history: History): History {
  if (history.future.length === 0) return history;
  return {
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1),
    changedAt: null,
  };
}

function withoutPosition(node: AutomationNode): Partial<AutomationNode> {
  const content: Partial<AutomationNode> = { ...node };
  delete content.position;
  return content;
}

/**
 * What a draft changes about the live automation, one short line each, in plain words.
 * Empty when the two would run the same; moving steps around the canvas does not count.
 */
export function draftChanges(live: AutomationDraft, draft: AutomationDraft): string[] {
  const lines: string[] = [];
  const title = (node: AutomationNode) => node.label ?? nodeTypeOf(node)?.title ?? "a step";
  if (live.name !== draft.name) lines.push(`Renamed to "${draft.name}"`);
  if (canonical(live.trigger) !== canonical(draft.trigger)) lines.push("Changed what starts it");
  const before = new Map(live.nodes.map((node) => [node.id, node]));
  const after = new Map(draft.nodes.map((node) => [node.id, node]));
  for (const node of draft.nodes) {
    const old = before.get(node.id);
    if (!old) lines.push(`Added ${title(node)}`);
    else {
      // Turning a step off or on is said as such; any other change to it as a change.
      if (Boolean(old.off) !== Boolean(node.off)) {
        lines.push(`${node.off ? "Turned off" : "Turned on"} ${title(node)}`);
      }
      const rest = (step: AutomationNode) => {
        const content = withoutPosition(step);
        delete content.off;
        return canonical(content);
      };
      if (rest(old) !== rest(node)) lines.push(`Changed ${title(node)}`);
    }
  }
  for (const node of live.nodes) {
    if (!after.has(node.id)) lines.push(`Removed ${title(node)}`);
  }
  const joins = (automation: AutomationDraft) =>
    automation.edges
      .map((edge) => `${edge.source}>${edge.target}${edge.branch ? `:${edge.branch}` : ""}`)
      .sort();
  // Adding or removing a step always moves lines, so it is only worth saying by itself.
  const sameSteps =
    live.nodes.length === draft.nodes.length && draft.nodes.every((node) => before.has(node.id));
  if (sameSteps && canonical(joins(live)) !== canonical(joins(draft))) {
    lines.push("Changed how the steps are joined");
  }
  return lines;
}
