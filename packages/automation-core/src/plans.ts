/**
 * Plan steps hand their plan to the step that carries it out: Plan B-Roll to Add B-Roll,
 * and the motion graphics plan to Add Motion Graphics. The plan is kept on the Plan
 * step's run step as `aiPlan`; the step that uses it finds the nearest Plan step of the
 * right kind upstream of itself.
 */
import type { AutomationEdge, AutomationNode } from "./graph";

/**
 * The closest node of `kind` that feeds `nodeId`, following connections backwards, or
 * null when none does. A Plan step that is turned off does not count.
 */
export function nearestUpstreamOfKind(
  nodeId: string,
  kind: AutomationNode["kind"],
  nodes: AutomationNode[],
  edges: AutomationEdge[],
): AutomationNode | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>([nodeId]);
  let frontier = [nodeId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const edge of edges) {
        if (edge.target !== id || seen.has(edge.source)) continue;
        seen.add(edge.source);
        const node = byId.get(edge.source);
        if (node?.kind === kind && !node.off) return node;
        next.push(edge.source);
      }
    }
    frontier = next;
  }
  return null;
}
