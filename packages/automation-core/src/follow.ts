/**
 * "Follow the speaker" after Clips. The two fit together on their own, with nothing to
 * set: a Clips step that hands its clips straight to Follow the speaker cuts them in the
 * video's own shape (so there is a whole wide picture to follow someone across), and
 * Follow the speaker then makes them in the platform's shape unless a shape was picked.
 */
import { type Frame, frameName, getPlatform } from "./clips";
import type { AutomationEdge, AutomationNode } from "./graph";
import { FAILURE_WAY } from "./logic";

/** The step that reframes a video to follow whoever is talking (toolkit /v1/video/reframe). */
export const FOLLOW_SPEAKER_STEP = "video-reframe";

const isFollow = (node: AutomationNode | undefined) =>
  node?.kind === "step" && node.stepId === FOLLOW_SPEAKER_STEP && !node.off;

/** True when the Clips step `clipsId` hands its clips straight to Follow the speaker. */
export function clipsKeepShape(
  clipsId: string,
  nodes: AutomationNode[],
  edges: AutomationEdge[],
): boolean {
  return edges.some(
    (edge) =>
      edge.source === clipsId &&
      edge.branch !== FAILURE_WAY &&
      isFollow(nodes.find((node) => node.id === edge.target)),
  );
}

/**
 * The shape Follow the speaker should make when it is left unpicked: the platform shape
 * of the Clips step right before it. Null when there is none to take.
 */
export function followShapeFrom(
  node: AutomationNode,
  nodes: AutomationNode[],
  edges: AutomationEdge[],
): Exclude<Frame, "original"> | null {
  if (!isFollow(node)) return null;
  for (const edge of edges) {
    if (edge.target !== node.id || edge.branch === FAILURE_WAY) continue;
    const source = nodes.find((candidate) => candidate.id === edge.source);
    if (source?.kind !== "clips") continue;
    const frame = getPlatform(source.input.platform)?.frame;
    if (frame && frame !== "original") return frame;
  }
  return null;
}

/**
 * The line shown under Follow the speaker's shape setting when it takes the shape from the
 * Clips step before it, keyed by that setting. Empty when it does not.
 */
export function followShapeLine(
  node: AutomationNode,
  nodes: AutomationNode[],
  edges: AutomationEdge[],
): Record<string, string> {
  const frame = followShapeFrom(node, nodes, edges);
  if (!frame) return {};
  const clips = edges
    .filter((edge) => edge.target === node.id)
    .map((edge) => nodes.find((candidate) => candidate.id === edge.source))
    .find((source) => source?.kind === "clips");
  const platform = getPlatform(clips?.input.platform)?.name ?? "platform";
  return {
    aspect: `Automatic. Makes the ${frameName(frame).toLowerCase()} shape ${platform} clips need. Pick one to use your own instead.`,
  };
}
