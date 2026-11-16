/** One box on the canvas. */
export interface AutomationNode {
  id: string;
  /**
   * "step" runs a catalog step on the toolkit; "approval" waits for a person; "clips"
   * cuts each incoming video into clips that fit the platform in `input.platform`.
   */
  kind: "step" | "approval" | "clips";
  /** Catalog step id, for kind "step". */
  stepId?: string;
  /** Optional name shown on the canvas instead of the step title. */
  label?: string;
  /** The step's settings. Text may hold {{placeholders}}; see templates.ts. */
  input: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface AutomationEdge {
  id: string;
  source: string;
  target: string;
}

export const MAX_NODES = 50;

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

/** Nodes that have not started and whose every upstream node is done. */
export function readyNodes(
  nodes: AutomationNode[],
  edges: AutomationEdge[],
  status: Record<string, NodeStatus>,
): AutomationNode[] {
  return nodes.filter(
    (node) =>
      status[node.id] === "pending" &&
      upstreamOf(node.id, edges).every((source) => status[source] === "done"),
  );
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
