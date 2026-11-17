/**
 * The changes that can be made to an automation, as plain data. The canvas and the agent
 * both build automations out of these, so anything one can do the other can too, and a
 * change is checked the same way wherever it comes from.
 */
import { type Brand, BRAND_WORDS } from "./brand";
import { graphProblem, MAX_NODES, NODE_GAP } from "./graph";
import type { AutomationEdge, AutomationNode } from "./graph";
import { branchesOfKind, canFailOver, FAILURE_WAY, logicProblem } from "./logic";
import {
  defaultSettings,
  getNodeType,
  missingSettingsOf,
  nodeTypeOf,
  savedKind,
  triggerTypeOf,
  typeNameOf,
} from "./registry";
import { scheduleProblem } from "./schedule";
import type { StarterTrigger } from "./starters";
import {
  fileFields,
  referencedSteps,
  type Source,
  stepsBefore,
  withoutReferencesTo,
  writeSource,
} from "./wiring";

export interface AutomationDraft {
  name: string;
  trigger: StarterTrigger;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
}

export type Operation =
  /** Adds a step. `after` connects it behind that step; `before` too puts it on that line. */
  | {
      op: "add";
      type: string;
      /** Optional id for the new step; one is made up when it is left out or taken. */
      id?: string;
      after?: string;
      before?: string;
      /**
       * Which way out of `after` to hang it on, when `after` is an If: "yes" or "no".
       * Left out, it takes the first way nothing is connected to yet.
       */
      branch?: string;
      settings?: Record<string, unknown>;
      label?: string;
      /**
       * More steps the new one also follows, besides `after`. It then waits until all of
       * them have finished and runs once, with the files from all of them.
       */
      join?: string[];
    }
  /** Removes steps and joins what fed each one to what it fed. */
  | { op: "remove"; ids: string[] }
  /** `branch` says which way out of an If the connection leaves by: "yes" or "no". */
  | { op: "connect"; source: string; target: string; branch?: string }
  | { op: "disconnect"; source: string; target: string }
  /** Merges into a step's settings. A value of null clears that setting. */
  | { op: "set"; id: string; settings: Record<string, unknown> }
  /**
   * Says where a file field gets its file: "auto" (the nearest fitting file before the
   * step), "trigger" (the file that started the run), or the id of an earlier step.
   */
  | { op: "use"; id: string; field: string; from: string }
  | { op: "rename"; id: string; label: string }
  /** Turns a step off (its files go straight on) or back on. */
  | { op: "switch"; id: string; on: boolean }
  /**
   * Copies steps, with the lines between them, and puts the copy beside them: fed by
   * whatever feeds the originals, with nothing after it yet.
   */
  | { op: "duplicate"; ids: string[] }
  /**
   * Puts copied steps on the canvas. With `after`, the copy carries on from that step
   * (by `branch`, for an If); without, it starts straight from the start.
   */
  | { op: "paste"; steps: StepsOnClipboard; after?: string; branch?: string }
  | { op: "trigger"; trigger: StarterTrigger }
  | { op: "name"; name: string }
  /** Lays the steps out left to right. */
  | { op: "tidy" };

export class OperationError extends Error {}

/** Steps copied from a canvas, with the lines between them. */
export interface StepsOnClipboard {
  nodes: AutomationNode[];
  edges: AutomationEdge[];
}

/** The steps with these ids and the lines that join them to each other. */
export function copySteps(
  draft: { nodes: AutomationNode[]; edges: AutomationEdge[] },
  ids: string[],
): StepsOnClipboard {
  const chosen = new Set(ids);
  return {
    nodes: draft.nodes.filter((node) => chosen.has(node.id)),
    edges: draft.edges.filter((edge) => chosen.has(edge.source) && chosen.has(edge.target)),
  };
}

/**
 * Adds a copy of `clip` to the draft, with new ids. Settings that point at a copied step
 * point at its copy; settings that point at a step outside the copy are kept only when
 * that step runs before the copy (`before`), and otherwise go back to being filled in by
 * themselves. `feeds` gives the lines into each step with nothing before it in the copy.
 */
function pasteCopy(
  draft: AutomationDraft,
  clip: StepsOnClipboard,
  place: { x: number; y: number },
  before: Set<string>,
  feeds: (original: AutomationNode) => { source: string; branch?: string }[],
): { draft: AutomationDraft; ids: string[] } {
  if (clip.nodes.length === 0) throw new OperationError("There is nothing to paste.");
  if (draft.nodes.length + clip.nodes.length > MAX_NODES) {
    throw new OperationError(`An automation can have at most ${MAX_NODES} steps.`);
  }
  const renamed = new Map<string, string>();
  const taken: { id: string }[] = [...draft.nodes];
  for (const node of clip.nodes) {
    const id = newNodeId(taken, node.stepId ?? node.kind);
    renamed.set(node.id, id);
    taken.push({ id });
  }
  const left = Math.min(...clip.nodes.map((node) => node.position.x));
  const top = Math.min(...clip.nodes.map((node) => node.position.y));
  const outside = clip.nodes
    .flatMap((node) => referencedSteps(node.input))
    .filter((id) => !renamed.has(id) && !before.has(id));
  const copies: AutomationNode[] = clip.nodes.map((node) => {
    const kept = withoutReferencesTo(node.input, outside);
    const input = JSON.parse(
      JSON.stringify(kept).replace(/(\{\{\s*steps\.)([A-Za-z0-9_]+)\./g, (whole, start, id) =>
        renamed.has(id) ? `${start}${renamed.get(id)}.` : whole,
      ),
    ) as Record<string, unknown>;
    return {
      ...node,
      id: renamed.get(node.id)!,
      input,
      position: { x: place.x + node.position.x - left, y: place.y + node.position.y - top },
    };
  });
  const inside = clip.edges
    .filter((edge) => renamed.has(edge.source) && renamed.has(edge.target))
    .map((edge) => link(renamed.get(edge.source)!, renamed.get(edge.target)!, edge.branch));
  const into = clip.nodes
    .filter((node) => !clip.edges.some((edge) => edge.target === node.id))
    .flatMap((node) =>
      feeds(node).map((feed) => link(feed.source, renamed.get(node.id)!, feed.branch)),
    );
  const edges = [...draft.edges, ...inside, ...into];
  const nodes = [...draft.nodes, ...copies];
  const problem = graphProblem(nodes, edges);
  if (problem) throw new OperationError(problem);
  return { draft: { ...draft, nodes, edges }, ids: copies.map((node) => node.id) };
}

/** What a paste or duplicate adds, and the ids of the new steps, for selecting them. */
export function pasteSteps(
  draft: AutomationDraft,
  op: Extract<Operation, { op: "paste" | "duplicate" }>,
): { draft: AutomationDraft; ids: string[] } {
  const lowest = (nodes: AutomationNode[]) =>
    nodes.length ? Math.max(...nodes.map((node) => node.position.y)) : -ROW_GAP;
  if (op.op === "duplicate") {
    if (op.ids.length === 0) throw new OperationError("Choose the steps to duplicate.");
    const originals = op.ids.map((id) => need(draft, id));
    const clip = copySteps(draft, op.ids);
    const before = new Set(originals.flatMap((node) => stepsBefore(node.id, draft.edges).flat()));
    // The copy sits just below the steps it copies.
    const place = {
      x: Math.min(...originals.map((node) => node.position.x)),
      y: lowest(originals) + ROW_GAP,
    };
    return pasteCopy(draft, clip, place, before, (original) =>
      draft.edges
        .filter((edge) => edge.target === original.id && !op.ids.includes(edge.source))
        .map((edge) => ({ source: edge.source, branch: edge.branch })),
    );
  }
  const after = op.after ? need(draft, op.after) : undefined;
  if (!after) {
    if (op.branch !== undefined) throw new OperationError("A way out needs a step to leave from.");
    // Nothing to carry on from: below everything, starting from the start.
    return pasteCopy(
      draft,
      op.steps,
      { x: 0, y: lowest(draft.nodes) + ROW_GAP },
      new Set(),
      () => [],
    );
  }
  const branch = wayOut(draft, after, op.branch);
  const lift =
    branch === undefined
      ? 0
      : branch === FAILURE_WAY
        ? ROW_GAP
        : (branch === "no" ? 1 : -1) * (ROW_GAP / 2);
  const before = new Set([after.id, ...stepsBefore(after.id, draft.edges).flat()]);
  // Steps already hanging off that way: the copy goes below them.
  const beside = draft.edges
    .filter((edge) => edge.source === after.id && edge.branch === branch)
    .map((edge) => need(draft, edge.target));
  const place = {
    x: after.position.x + NODE_GAP,
    y: beside.length ? lowest(beside) + ROW_GAP : after.position.y + lift,
  };
  return pasteCopy(draft, op.steps, place, before, () => [{ source: after.id, branch }]);
}

const ROW_GAP = 150;

/** A short readable id such as "caption_2", used in {{steps.caption_2.url}}. */
export function newNodeId(existing: { id: string }[], base: string): string {
  const stem =
    (base.split(/[-:]/).pop() ?? "step").replace(/[^a-z0-9]/gi, "").toLowerCase() || "step";
  const taken = new Set(existing.map((node) => node.id));
  for (let n = 1; ; n++) {
    const id = `${stem}_${n}`;
    if (!taken.has(id)) return id;
  }
}

/** Edges left after removing steps, with each removed step's neighbours joined up. */
export function bridgeEdges<
  E extends { id: string; source: string; target: string; branch?: string },
>(removed: string[], edges: E[]): (E | AutomationEdge)[] {
  let next: (E | AutomationEdge)[] = edges;
  for (const id of removed) {
    const feeding = next.filter((edge) => edge.target === id);
    // What hung off the way for when it fails is not joined up: it was never the main flow.
    const targets = next
      .filter((edge) => edge.source === id && edge.branch !== FAILURE_WAY)
      .map((edge) => edge.target);
    next = next.filter((edge) => edge.source !== id && edge.target !== id);
    for (const { source, branch } of feeding) {
      for (const target of targets) {
        if (!next.some((edge) => edge.source === source && edge.target === target)) {
          // What followed the removed step stays on the same way out of an If before it.
          next = [
            ...next,
            { id: `${source}>${target}`, source, target, ...(branch ? { branch } : {}) },
          ];
        }
      }
    }
  }
  return next;
}

/**
 * Positions that read left to right: each step one place right of the furthest step
 * feeding it, and steps that share a place stacked and centred.
 */
export function tidyPositions(
  nodeIds: string[],
  edges: { source: string; target: string; branch?: string }[],
): Map<string, { x: number; y: number }> {
  const depth = new Map<string, number>();
  const depthOf = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const sources = edges.filter((edge) => edge.target === id).map((edge) => edge.source);
    const value = sources.length ? Math.max(...sources.map((s) => depthOf(s, seen))) + 1 : 0;
    depth.set(id, value);
    return value;
  };
  const columns = new Map<number, string[]>();
  for (const id of nodeIds) {
    const column = depthOf(id, new Set());
    columns.set(column, [...(columns.get(column) ?? []), id]);
  }
  // What hangs off an If's "no" sits below what hangs off its "yes", and what runs when a
  // step fails sits below the rest.
  const below = (id: string) =>
    edges.some((e) => e.target === id && e.branch === FAILURE_WAY)
      ? 2
      : edges.some((e) => e.target === id && e.branch === "no")
        ? 1
        : 0;
  const positions = new Map<string, { x: number; y: number }>();
  for (const [column, unsorted] of columns) {
    const ids = [...unsorted].sort((a, b) => below(a) - below(b));
    ids.forEach((id, row) =>
      positions.set(id, { x: column * NODE_GAP, y: (row - (ids.length - 1) / 2) * ROW_GAP }),
    );
  }
  return positions;
}

function need(draft: AutomationDraft, id: string): AutomationNode {
  const node = draft.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new OperationError(`There is no step called "${id}".`);
  return node;
}

/**
 * The way out of `source` a new connection leaves by: the one asked for, or the first
 * nothing hangs off yet. Undefined for a step with a single way out.
 */
function wayOut(
  draft: AutomationDraft,
  source: AutomationNode,
  asked: string | undefined,
): string | undefined {
  const ways = branchesOfKind(source.kind);
  const title = source.label ?? nodeTypeOf(source)?.title ?? source.id;
  if (asked === FAILURE_WAY) {
    if (!canFailOver(source.kind)) {
      throw new OperationError(`${title} cannot have a way for when it fails.`);
    }
    return asked;
  }
  if (ways.length === 0) {
    if (asked !== undefined) throw new OperationError(`${title} has only one way out.`);
    return undefined;
  }
  if (asked !== undefined) {
    if (!ways.includes(asked)) {
      throw new OperationError(
        `${title} has no way out called "${asked}". Use ${ways.join(" or ")}.`,
      );
    }
    return asked;
  }
  const used = draft.edges.filter((edge) => edge.source === source.id).map((edge) => edge.branch);
  return ways.find((way) => !used.includes(way)) ?? ways[0];
}

function link(source: string, target: string, branch: string | undefined): AutomationEdge {
  return { id: `${source}>${target}`, source, target, ...(branch ? { branch } : {}) };
}

function withEdge(
  draft: AutomationDraft,
  source: string,
  target: string,
  asked?: string,
): AutomationEdge[] {
  const existing = draft.edges.find((other) => other.source === source && other.target === target);
  // Connecting two steps again only matters when it moves the line to another way out.
  if (existing && (asked === undefined || existing.branch === asked)) return draft.edges;
  const branch = wayOut(draft, need(draft, source), asked);
  return [...draft.edges.filter((other) => other !== existing), link(source, target, branch)];
}

function add(draft: AutomationDraft, op: Extract<Operation, { op: "add" }>): AutomationDraft {
  const nodeType = getNodeType(op.type);
  const kind = savedKind(op.type);
  if (!nodeType || !kind) {
    throw new OperationError(`"${op.type}" is not a step that can be added.`);
  }
  if (draft.nodes.length >= MAX_NODES) {
    throw new OperationError(`An automation can have at most ${MAX_NODES} steps.`);
  }
  // "after the trigger" is what a step with no `after` already does, so take it that way
  // rather than as a step called "trigger" (unless there really is one).
  const afterTrigger =
    (op.after === "trigger" || op.after === "__trigger") &&
    !draft.nodes.some((node) => node.id === op.after);
  const after = op.after && !afterTrigger ? need(draft, op.after) : undefined;
  const before = op.before ? need(draft, op.before) : undefined;
  const taken = op.id && draft.nodes.some((node) => node.id === op.id);
  const id =
    op.id && !taken && /^[a-z][a-z0-9_]{0,39}$/.test(op.id)
      ? op.id
      : newNodeId(draft.nodes, op.type);

  let nodes = draft.nodes;
  let edges = draft.edges;
  let position: { x: number; y: number };
  if (before) {
    // The new step takes the place of the one after it, and everything from there moves along.
    position = { ...before.position };
    nodes = nodes.map((node) =>
      node.position.x >= before.position.x
        ? { ...node, position: { ...node.position, x: node.position.x + NODE_GAP } }
        : node,
    );
    const feeding = edges.filter(
      (other) => other.target === before.id && (!after || other.source === after.id),
    );
    edges = edges.filter((other) => !feeding.includes(other));
    edges = [
      ...edges,
      // Each line that fed the step after keeps the way out it left by.
      ...(feeding.length > 0 || !after
        ? feeding.map((other) => link(other.source, id, other.branch))
        : [link(after.id, id, wayOut(draft, after, op.branch))]),
      // A new If carries on by its first way out.
      link(id, before.id, branchesOfKind(kind.kind)[0]),
    ];
  } else {
    const rightmost = nodes.reduce<AutomationNode | undefined>(
      (far, node) => (!far || node.position.x > far.position.x ? node : far),
      undefined,
    );
    const anchor = after ?? rightmost;
    const branch = after ? wayOut(draft, after, op.branch) : undefined;
    // The two ways out of an If fan apart, "yes" above and "no" below; what runs when a
    // step fails hangs a row below it.
    const lift =
      branch === undefined
        ? 0
        : branch === FAILURE_WAY
          ? ROW_GAP
          : (branch === "no" ? 1 : -1) * (ROW_GAP / 2);
    position = anchor
      ? { x: anchor.position.x + NODE_GAP, y: anchor.position.y + lift }
      : { x: 0, y: 0 };
    if (after) edges = [...edges, link(after.id, id, branch)];
  }

  const joined = (op.join ?? []).filter((other) => other !== after?.id);
  if (joined.length > 0) {
    if (!after || before) {
      throw new OperationError("To join steps, say which step it comes after too.");
    }
    const sources = [after, ...joined.map((other) => need(draft, other))];
    // It sits one place right of the furthest step it waits for, level with their middle.
    position = {
      x: Math.max(...sources.map((source) => source.position.x)) + NODE_GAP,
      y: Math.round(sources.reduce((sum, source) => sum + source.position.y, 0) / sources.length),
    };
    for (const source of sources.slice(1)) {
      edges = [...edges, link(source.id, id, wayOut({ ...draft, edges }, source, undefined))];
    }
  }

  const node: AutomationNode = {
    id,
    ...kind,
    ...(op.label ? { label: op.label.trim().slice(0, 60) } : {}),
    input: { ...defaultSettings(nodeType), ...(op.settings ?? {}) },
    position,
  };
  const problem = joined.length > 0 ? graphProblem([...nodes, node], edges) : null;
  if (problem) throw new OperationError(problem);
  return { ...draft, nodes: [...nodes, node], edges };
}

/** Applies one change and returns the new draft. Throws OperationError when it cannot. */
export function applyOperation(draft: AutomationDraft, op: Operation): AutomationDraft {
  switch (op.op) {
    case "add":
      return add(draft, op);
    case "remove": {
      for (const id of op.ids) need(draft, id);
      return {
        ...draft,
        // A setting that pointed at a removed step goes back to being filled in by itself.
        nodes: draft.nodes
          .filter((node) => !op.ids.includes(node.id))
          .map((node) => ({ ...node, input: withoutReferencesTo(node.input, op.ids) })),
        edges: bridgeEdges(op.ids, draft.edges),
      };
    }
    case "connect": {
      need(draft, op.source);
      need(draft, op.target);
      const edges = withEdge(draft, op.source, op.target, op.branch);
      const problem = graphProblem(draft.nodes, edges);
      if (problem) throw new OperationError(problem);
      return { ...draft, edges };
    }
    case "disconnect":
      return {
        ...draft,
        edges: draft.edges.filter(
          (edge) => !(edge.source === op.source && edge.target === op.target),
        ),
      };
    case "set": {
      const node = need(draft, op.id);
      const known = nodeTypeOf(node)?.settings.properties;
      const input = { ...node.input };
      for (const [name, value] of Object.entries(op.settings)) {
        if (known && !Object.hasOwn(known, name)) {
          throw new OperationError(
            `"${name}" is not a setting of ${nodeTypeOf(node)?.title ?? "this step"}.`,
          );
        }
        if (value === null) delete input[name];
        else input[name] = value;
      }
      return {
        ...draft,
        nodes: draft.nodes.map((other) => (other.id === op.id ? { ...other, input } : other)),
      };
    }
    case "use": {
      const node = need(draft, op.id);
      const nodeType = nodeTypeOf(node);
      const title = node.label ?? nodeType?.title ?? "This step";
      if (!nodeType || !fileFields(nodeType).includes(op.field)) {
        throw new OperationError(`"${op.field}" is not a file setting of ${title}.`);
      }
      let source: Source;
      if (op.from === "auto") {
        if (nodeType.automatic !== op.field) {
          throw new OperationError(
            `${title} cannot find "${op.field}" by itself. Point it at a step, the start, or set a fixed address.`,
          );
        }
        source = { from: "auto" };
      } else if (op.from === "trigger") {
        if (triggerTypeOf(draft.trigger).gives !== "file") {
          throw new OperationError("This automation's start hands over no file.");
        }
        source = { from: "trigger" };
      } else {
        const other = need(draft, op.from);
        if (!stepsBefore(node.id, draft.edges).flat().includes(other.id)) {
          throw new OperationError(
            `${other.label ?? nodeTypeOf(other)?.title ?? other.id} does not run before ${title}. Connect it first.`,
          );
        }
        source = { from: "step", id: other.id };
      }
      const input = { ...node.input };
      const value = writeSource(source);
      if (value === undefined) delete input[op.field];
      else input[op.field] = value;
      return {
        ...draft,
        nodes: draft.nodes.map((other) => (other.id === op.id ? { ...other, input } : other)),
      };
    }
    case "duplicate":
    case "paste":
      return pasteSteps(draft, op).draft;
    case "switch": {
      const node = need(draft, op.id);
      if (!op.on && node.kind === "if") {
        throw new OperationError("An If cannot be turned off. Remove it instead.");
      }
      return {
        ...draft,
        nodes: draft.nodes.map((other) => {
          if (other.id !== op.id) return other;
          const rest = { ...other };
          delete rest.off;
          return op.on ? rest : { ...rest, off: true };
        }),
      };
    }
    case "rename": {
      need(draft, op.id);
      const label = op.label.trim().slice(0, 60);
      return {
        ...draft,
        nodes: draft.nodes.map((node) => {
          if (node.id !== op.id) return node;
          const rest = { ...node };
          delete rest.label;
          return label ? { ...rest, label } : rest;
        }),
      };
    }
    case "trigger": {
      if (op.trigger.kind === "schedule") {
        const problem = scheduleProblem(op.trigger.schedule);
        if (problem) throw new OperationError(problem);
      }
      return { ...draft, trigger: op.trigger };
    }
    case "name": {
      const name = op.name.trim().slice(0, 80);
      if (!name) throw new OperationError("Give the automation a name.");
      return { ...draft, name };
    }
    case "tidy": {
      const positions = tidyPositions(
        draft.nodes.map((node) => node.id),
        draft.edges,
      );
      return {
        ...draft,
        nodes: draft.nodes.map((node) => ({
          ...node,
          position: positions.get(node.id) ?? node.position,
        })),
      };
    }
  }
}

/** Applies changes in order. Stops at the first that cannot be made and says which. */
export function applyOperations(draft: AutomationDraft, ops: Operation[]): AutomationDraft {
  return ops.reduce((current, op, index) => {
    try {
      return applyOperation(current, op);
    } catch (caught) {
      if (caught instanceof OperationError) {
        throw new OperationError(`Change ${index + 1} (${op.op}): ${caught.message}`);
      }
      throw caught;
    }
  }, draft);
}

export interface DraftProblem {
  /** The step the problem is on, or null when it is about the automation as a whole. */
  nodeId: string | null;
  message: string;
}

/** Everything that stops the automation from running, in plain language. Empty when it can. */
export function draftProblems(draft: AutomationDraft, brand: Brand = {}): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const graph = graphProblem(draft.nodes, draft.edges);
  if (graph) problems.push({ nodeId: null, message: graph });
  if (draft.trigger.kind === "schedule") {
    const schedule = scheduleProblem(draft.trigger.schedule);
    if (schedule) problems.push({ nodeId: null, message: schedule });
  }
  for (const node of draft.nodes) {
    const nodeType = nodeTypeOf(node);
    if (!nodeType) {
      problems.push({ nodeId: node.id, message: `"${typeNameOf(node)}" is not a known step.` });
      continue;
    }
    const before = stepsBefore(node.id, draft.edges).flat();
    for (const id of referencedSteps(node.input)) {
      const other = draft.nodes.find((candidate) => candidate.id === id);
      const title = node.label ?? nodeType.title;
      if (!other) {
        problems.push({
          nodeId: node.id,
          message: `${title} uses a file from a step that is no longer there. Choose where it comes from again.`,
        });
      } else if (!before.includes(id)) {
        problems.push({
          nodeId: node.id,
          message: `${title} uses a file from ${other.label ?? nodeTypeOf(other)?.title ?? id}, which does not run before it. Connect them, or choose another.`,
        });
      }
    }
    const missing = missingSettingsOf(nodeType, node.input, brand);
    const fromBrand = missing.flatMap((name) => nodeType.brand?.[name] ?? []);
    const own = missing.filter((name) => !nodeType.brand?.[name]);
    if (fromBrand.length > 0) {
      problems.push({
        nodeId: node.id,
        message: `${node.label ?? nodeType.title} needs your team's ${fromBrand
          .map((key) => BRAND_WORDS[key])
          .join(" and ")}. Add it in Settings, under Brand.`,
      });
    }
    if (own.length > 0) {
      problems.push({
        nodeId: node.id,
        message: `${node.label ?? nodeType.title} still needs: ${own.join(", ")}.`,
      });
    }
    const logic = own.length === 0 ? logicProblem(node) : null;
    if (logic)
      problems.push({ nodeId: node.id, message: `${node.label ?? nodeType.title}: ${logic}` });
  }
  return problems;
}

/**
 * The automation as short text, in running order: what starts it, then each step with
 * its id, type, settings, what feeds it, and anything still missing. For a model to read
 * before it changes anything.
 */
export function outline(draft: AutomationDraft, brand: Brand = {}): string {
  const lines = [
    `Automation "${draft.name}"`,
    `Starts: ${triggerTypeOf(draft.trigger).type} ${JSON.stringify(
      Object.fromEntries(Object.entries(draft.trigger).filter(([key]) => key !== "kind")),
    )}`,
  ];
  const order = tidyPositions(
    draft.nodes.map((node) => node.id),
    draft.edges,
  );
  const sorted = [...draft.nodes].sort(
    (a, b) =>
      (order.get(a.id)?.x ?? 0) - (order.get(b.id)?.x ?? 0) ||
      (order.get(a.id)?.y ?? 0) - (order.get(b.id)?.y ?? 0),
  );
  const problems = draftProblems(draft, brand);
  for (const node of sorted) {
    const sources = draft.edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => (edge.branch ? `${edge.source} (${edge.branch})` : edge.source));
    const issue = problems.find((problem) => problem.nodeId === node.id);
    lines.push(
      `- ${node.id} [${typeNameOf(node)}]${node.label ? ` "${node.label}"` : ""} from ${
        sources.length ? sources.join(", ") : "the start"
      } settings ${JSON.stringify(node.input)}${issue ? ` PROBLEM: ${issue.message}` : ""}`,
    );
  }
  for (const problem of problems.filter((entry) => entry.nodeId === null)) {
    lines.push(`PROBLEM: ${problem.message}`);
  }
  return lines.join("\n");
}
