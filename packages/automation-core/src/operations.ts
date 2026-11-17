/**
 * The changes that can be made to an automation, as plain data. The canvas and the agent
 * both build automations out of these, so anything one can do the other can too, and a
 * change is checked the same way wherever it comes from.
 */
import { graphProblem, MAX_NODES, NODE_GAP } from "./graph";
import type { AutomationEdge, AutomationNode } from "./graph";
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
      settings?: Record<string, unknown>;
      label?: string;
    }
  /** Removes steps and joins what fed each one to what it fed. */
  | { op: "remove"; ids: string[] }
  | { op: "connect"; source: string; target: string }
  | { op: "disconnect"; source: string; target: string }
  /** Merges into a step's settings. A value of null clears that setting. */
  | { op: "set"; id: string; settings: Record<string, unknown> }
  /**
   * Says where a file field gets its file: "auto" (the nearest fitting file before the
   * step), "trigger" (the file that started the run), or the id of an earlier step.
   */
  | { op: "use"; id: string; field: string; from: string }
  | { op: "rename"; id: string; label: string }
  | { op: "trigger"; trigger: StarterTrigger }
  | { op: "name"; name: string }
  /** Lays the steps out left to right. */
  | { op: "tidy" };

export class OperationError extends Error {}

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
export function bridgeEdges<E extends { id: string; source: string; target: string }>(
  removed: string[],
  edges: E[],
): (E | AutomationEdge)[] {
  let next: (E | AutomationEdge)[] = edges;
  for (const id of removed) {
    const sources = next.filter((edge) => edge.target === id).map((edge) => edge.source);
    const targets = next.filter((edge) => edge.source === id).map((edge) => edge.target);
    next = next.filter((edge) => edge.source !== id && edge.target !== id);
    for (const source of sources) {
      for (const target of targets) {
        if (!next.some((edge) => edge.source === source && edge.target === target)) {
          next = [...next, { id: `${source}>${target}`, source, target }];
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
  edges: { source: string; target: string }[],
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
  const positions = new Map<string, { x: number; y: number }>();
  for (const [column, ids] of columns) {
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

function withEdge(draft: AutomationDraft, source: string, target: string): AutomationEdge[] {
  if (draft.edges.some((edge) => edge.source === source && edge.target === target)) {
    return draft.edges;
  }
  return [...draft.edges, { id: `${source}>${target}`, source, target }];
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
  const after = op.after ? need(draft, op.after) : undefined;
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
    const feeding = after
      ? [after.id]
      : edges.filter((edge) => edge.target === before.id).map((edge) => edge.source);
    edges = edges.filter((edge) => !(edge.target === before.id && feeding.includes(edge.source)));
    edges = [
      ...edges,
      ...feeding.map((source) => ({ id: `${source}>${id}`, source, target: id })),
      { id: `${id}>${before.id}`, source: id, target: before.id },
    ];
  } else {
    const rightmost = nodes.reduce<AutomationNode | undefined>(
      (far, node) => (!far || node.position.x > far.position.x ? node : far),
      undefined,
    );
    const anchor = after ?? rightmost;
    position = anchor ? { x: anchor.position.x + NODE_GAP, y: anchor.position.y } : { x: 0, y: 0 };
    if (after) edges = [...edges, { id: `${after.id}>${id}`, source: after.id, target: id }];
  }

  const node: AutomationNode = {
    id,
    ...kind,
    ...(op.label ? { label: op.label.trim().slice(0, 60) } : {}),
    input: { ...defaultSettings(nodeType), ...(op.settings ?? {}) },
    position,
  };
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
      const edges = withEdge(draft, op.source, op.target);
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
        if (known && !(name in known)) {
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
export function draftProblems(draft: AutomationDraft): DraftProblem[] {
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
    const missing = missingSettingsOf(nodeType, node.input);
    if (missing.length > 0) {
      problems.push({
        nodeId: node.id,
        message: `${node.label ?? nodeType.title} still needs: ${missing.join(", ")}.`,
      });
    }
  }
  return problems;
}

/**
 * The automation as short text, in running order: what starts it, then each step with
 * its id, type, settings, what feeds it, and anything still missing. For a model to read
 * before it changes anything.
 */
export function outline(draft: AutomationDraft): string {
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
  const problems = draftProblems(draft);
  for (const node of sorted) {
    const sources = draft.edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => edge.source);
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
