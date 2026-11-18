import { getPlatform, type PlatformName } from "./clips";
import { type AutomationEdge, type AutomationNode, NODE_GAP } from "./graph";

/**
 * The few choices behind a "clips for social" automation, which the canvas shows as
 * steps.
 */
export interface ClipsSetup {
  platform: PlatformName;
  /** Burn captions into each clip. */
  captions: boolean;
  /** Wait for a person to look at the clips before the run finishes. */
  approve: boolean;
}

const CLIPS = "clips";
const CAPTIONS = "captions";
const APPROVAL = "approval";
// Steps run left to right on the canvas.
const at = (column: number) => ({ x: column * NODE_GAP, y: 0 });

/** The steps for a clips automation with these choices. */
export function clipsGraph(setup: ClipsSetup): {
  nodes: AutomationNode[];
  edges: AutomationEdge[];
} {
  const nodes: AutomationNode[] = [
    { id: CLIPS, kind: "clips", input: { platform: setup.platform }, position: at(0) },
  ];
  if (setup.captions) {
    nodes.push({
      id: CAPTIONS,
      kind: "step",
      stepId: "video-caption",
      // No look of its own: it takes the team's caption style for the clip's shape.
      input: {},
      position: at(1),
    });
  }
  if (setup.approve) {
    nodes.push({
      id: APPROVAL,
      kind: "approval",
      input: {},
      position: at(nodes.length),
    });
  }
  const edges = nodes.slice(1).map((node, index) => ({
    id: `${nodes[index].id}>${node.id}`,
    source: nodes[index].id,
    target: node.id,
  }));
  return { nodes, edges };
}

/**
 * Reads the choices back from an automation's steps. Null when the steps are not the
 * ones clipsGraph makes, which means someone reshaped it on the canvas.
 */
export function readClipsSetup(
  nodes: AutomationNode[],
  edges: AutomationEdge[],
): ClipsSetup | null {
  const clips = nodes.find((node) => node.id === CLIPS);
  const platform = getPlatform(clips?.input.platform);
  if (!clips || clips.kind !== "clips" || !platform) return null;
  const captions = nodes.some(
    (node) => node.id === CAPTIONS && node.kind === "step" && node.stepId === "video-caption",
  );
  const approve = nodes.some((node) => node.id === APPROVAL && node.kind === "approval");
  const setup = { platform: platform.name, captions, approve };
  const expected = clipsGraph(setup);
  const sameShape =
    nodes.length === expected.nodes.length &&
    edges.length === expected.edges.length &&
    expected.edges.every((edge) =>
      edges.some((other) => other.source === edge.source && other.target === edge.target),
    );
  return sameShape ? setup : null;
}
