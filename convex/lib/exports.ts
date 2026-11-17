import { type AutomationNode, getPlatform } from "@ncat-dash/automation-core";
import {
  type CutList,
  type CutSource,
  type CutTimeline,
  clipsCutList,
  DEFAULT_EDITORS,
  type EditorId,
} from "@ncat-dash/timeline-export";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// The picture size of a vertical clip, as the clips step makes it.
const VERTICAL = { width: 1080, height: 1920 };

/**
 * The cuts a run made, for opening in a video editor: one timeline per clip a "clips" step
 * cut. Null when the run cut nothing, or its videos' details were not kept.
 */
export function cutListOf(run: Doc<"runs">, steps: Doc<"runSteps">[]): CutList | null {
  const nodes = run.nodes as AutomationNode[];
  const timelines: CutTimeline[] = [];
  for (const step of steps) {
    if (!step.plan || !step.sources) continue;
    const node = nodes.find((candidate) => candidate.id === step.nodeId);
    const frame = getPlatform(node?.input.platform)?.frame === "9:16" ? VERTICAL : undefined;
    const sources: Record<string, CutSource> = Object.fromEntries(
      step.sources.map((source) => [source.url, source]),
    );
    timelines.push(...clipsCutList(run.automationName, step.plan, sources, frame).timelines);
  }
  return timelines.length > 0 ? { name: run.automationName, timelines } : null;
}

/** The video editors a team uses. Until it says, every editor that opens a timeline. */
export async function editorsOf(ctx: QueryCtx, organizationId: string): Promise<EditorId[]> {
  const settings = await ctx.db
    .query("teamSettings")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .first();
  return settings?.editors ?? DEFAULT_EDITORS;
}
