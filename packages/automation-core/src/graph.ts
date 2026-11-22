import type { Brand } from "./brand";
import { branchesOfKind, canFailOver, FAILURE_WAY } from "./logic";
import { missingSettingsOf, nodeTypeOf } from "./registry";
import { fileFields } from "./wiring";

/** One box on the canvas. */
export interface AutomationNode {
  id: string;
  /**
   * "step" runs a catalog step on the toolkit; "approval" waits for a person; "clips"
   * cuts each incoming video into clips that fit the platform in `input.platform`;
   * "export" makes the timeline files that open the run's cuts in a video editor; "if"
   * sends each file one of two ways; "wait" holds the run for a length of time;
   * "automation" runs another of the team's automations on its files (chain.ts);
   * "moments" picks the best moments of each video and cuts them as clips; "chapters"
   * groups a long video into chapters (both moments.ts); "broll" lays cutaway footage over
   * each video, and "broll-plan" has the AI say where and what to show first (broll.ts);
   * "motion-plan" has the AI say which pieces go where first,
   * "motion" draws motion graphics and "sound-effects" adds sound effects onto each video
   * (motion.ts); "cleanup" takes long pauses and retakes out of each recording and can
   * split its hook takes into files of their own (cleanup.ts); "footage-check" measures
   * each video and stops or warns before editing when one has a problem (footage.ts);
   * "subtitles" writes each video's subtitles in other languages (translated-captions.ts);
   * "send" posts the files that reach it, with the run's details, to an address (send.ts).
   */
  kind:
    | "step"
    | "approval"
    | "clips"
    | "export"
    | "if"
    | "wait"
    | "automation"
    | "moments"
    | "chapters"
    | "broll"
    | "broll-plan"
    | "motion"
    | "motion-plan"
    | "sound-effects"
    | "cleanup"
    | "footage-check"
    | "subtitles"
    | "send";
  /** Catalog step id, for kind "step". */
  stepId?: string;
  /** Optional name shown on the canvas instead of the step title. */
  label?: string;
  /**
   * Turned off: a run does not do this step's work and hands the files that reached it
   * straight on, so it can be switched back on later with its settings intact. An If
   * cannot be turned off, since it has no one way to hand files on.
   */
  off?: boolean;
  /**
   * How it treats files when two or more lines meet at it; "all" when unset. See join.ts.
   */
  join?: "all" | "source" | "position" | "first";
  /** The step's settings. Text may hold {{placeholders}}; see templates.ts. */
  input: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface AutomationEdge {
  id: string;
  source: string;
  target: string;
  /** Which way out of the source this is, for a step with more than one: "yes" or "no". */
  branch?: string;
}

export const MAX_NODES = 50;
/** How far apart steps sit on the canvas, which reads left to right. */
export const NODE_GAP = 220;

/**
 * The settings a step still needs before it can run: required blanks that are empty and
 * that the step before does not fill in. Reads the node's description in registry.ts.
 * Nothing for a step that is turned off.
 */
export function missingSettings(node: AutomationNode, brand?: Brand): string[] {
  // A step that is turned off does no work, so it needs nothing.
  if (node.off) return [];
  const nodeType = nodeTypeOf(node);
  if (!nodeType) return [];
  const missing = missingSettingsOf(nodeType, node.input, brand);
  // A step that pairs the files of the lines meeting at it gets its other files from them.
  if (node.join === "source" || node.join === "position") {
    const files = fileFields(nodeType);
    return missing.filter((name) => !files.includes(name));
  }
  return missing;
}

export type NodeStatus = "pending" | "running" | "waiting_approval" | "done" | "failed" | "skipped";

/** Returns a plain-language problem with the graph, or null when it can run. */
export function graphProblem(nodes: AutomationNode[], edges: AutomationEdge[]): string | null {
  if (nodes.length === 0) return "Add at least one step.";
  if (nodes.length > MAX_NODES) return `An automation can have at most ${MAX_NODES} steps.`;

  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) return "Two steps share the same id.";
    ids.add(node.id);
    if (node.kind === "step" && !node.stepId) return "A step has no action chosen.";
  }

  const seen = new Set<string>();
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      return "A connection points at a step that no longer exists.";
    }
    if (edge.source === edge.target) return "A step cannot feed itself.";
    const key = `${edge.source}>${edge.target}`;
    if (seen.has(key)) return "Two steps are connected twice.";
    seen.add(key);
    const kind = nodes.find((node) => node.id === edge.source)?.kind;
    const ways = branchesOfKind(kind);
    if (edge.branch === FAILURE_WAY) {
      if (!canFailOver(kind)) return "Only a step that does work can have a way for when it fails.";
    } else if (ways.length > 0 ? !ways.includes(edge.branch ?? "") : edge.branch !== undefined) {
      return ways.length > 0
        ? `A connection out of an If step has to leave by ${ways.join(" or ")}.`
        : "Only an If step has more than one way out.";
    }
  }

  // Kahn's algorithm: if some nodes can never be reached in order, there is a loop.
  const incoming = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited++;
    for (const edge of edges) {
      if (edge.source !== id) continue;
      const left = (incoming.get(edge.target) ?? 0) - 1;
      incoming.set(edge.target, left);
      if (left === 0) queue.push(edge.target);
    }
  }
  if (visited !== nodes.length) return "The steps form a loop. Remove one connection.";
  return null;
}

/** Ids of the nodes that feed `nodeId`, in the order the connections were drawn. */
export function upstreamOf(nodeId: string, edges: AutomationEdge[]): string[] {
  return edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source);
}

/** Whether something hangs off the way for when this step fails. */
export function failsOver(nodeId: string, edges: AutomationEdge[]): boolean {
  return edges.some((edge) => edge.source === nodeId && edge.branch === FAILURE_WAY);
}

/**
 * Which ways out a finished step used, by step id. Only a step with more than one way out
 * (an If) has an entry; a way that got no files is left out and what hangs off it is skipped.
 */
export type Taken = Record<string, string[] | undefined>;

type EdgeState = "live" | "dead" | "open";

function edgeState(
  edge: AutomationEdge,
  status: Record<string, NodeStatus>,
  taken: Taken,
): EdgeState {
  const source = status[edge.source];
  // The way for when a step fails carries files only when it did fail.
  if (source === "failed") return edge.branch === FAILURE_WAY ? "live" : "dead";
  if (source === "done") {
    if (edge.branch === FAILURE_WAY) return "dead";
    const used = taken[edge.source];
    return edge.branch !== undefined && used && !used.includes(edge.branch) ? "dead" : "live";
  }
  return source === "skipped" ? "dead" : "open";
}

function incomingStates(
  node: AutomationNode,
  edges: AutomationEdge[],
  status: Record<string, NodeStatus>,
  taken: Taken,
): EdgeState[] {
  return edges
    .filter((edge) => edge.target === node.id)
    .map((edge) => edgeState(edge, status, taken));
}

/**
 * Nodes that have not started and can: nothing feeding them is still under way, and at
 * least one connection into them carries files. Without an If that is the same as "every
 * upstream node is done".
 */
export function readyNodes(
  nodes: AutomationNode[],
  edges: AutomationEdge[],
  status: Record<string, NodeStatus>,
  taken: Taken = {},
): AutomationNode[] {
  return nodes.filter((node) => {
    if (status[node.id] !== "pending") return false;
    const states = incomingStates(node, edges, status, taken);
    // A step that takes whichever line finishes first starts as soon as one has.
    if (node.join === "first" && states.includes("live")) return true;
    return states.length === 0 || (!states.includes("open") && states.includes("live"));
  });
}

/**
 * Nodes that have not started and never will: every connection into them comes from a way
 * an If did not go, or from a step that was itself passed over.
 */
export function passedOverNodes(
  nodes: AutomationNode[],
  edges: AutomationEdge[],
  status: Record<string, NodeStatus>,
  taken: Taken = {},
): AutomationNode[] {
  return nodes.filter((node) => {
    if (status[node.id] !== "pending") return false;
    const states = incomingStates(node, edges, status, taken);
    return states.length > 0 && states.every((state) => state === "dead");
  });
}

/**
 * The ways out of `sourceId` that lead to `targetId`, directly or through other steps.
 * Tells a later step which of an If's files are meant for it.
 */
export function branchesToward(
  sourceId: string,
  targetId: string,
  edges: AutomationEdge[],
): string[] {
  const reaches = new Set([targetId]);
  const queue = [targetId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const edge of edges) {
      if (edge.target === id && !reaches.has(edge.source)) {
        reaches.add(edge.source);
        queue.push(edge.source);
      }
    }
  }
  const found = new Set<string>();
  for (const edge of edges) {
    if (edge.source === sourceId && edge.branch !== undefined && reaches.has(edge.target)) {
      found.add(edge.branch);
    }
  }
  return [...found];
}

/** Every node downstream of `nodeId`, however far. Used to skip what a failure cuts off. */
export function downstreamOf(nodeId: string, edges: AutomationEdge[]): string[] {
  const found = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const edge of edges) {
      if (edge.source === id && !found.has(edge.target)) {
        found.add(edge.target);
        queue.push(edge.target);
      }
    }
  }
  return [...found];
}
