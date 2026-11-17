import { type AutomationNode, getPlatform, readFileDetails } from "@ncat-dash/automation-core";
import {
  type Cue,
  type CutList,
  type CutSource,
  type CutTimeline,
  clipsCutList,
  DEFAULT_EDITORS,
  type EditorId,
  isCuttingStep,
  parseSrt,
  stepTimelines,
} from "@ncat-dash/timeline-export";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// The picture size of a vertical clip, as the clips step makes it.
const VERTICAL = { width: 1080, height: 1920 };

/**
 * What is known about the file that started a run, when it was an upload whose details
 * were read. A timeline needs the frame rate and picture size, so without them: null.
 */
function triggerSource(run: Doc<"runs">): CutSource | null {
  const trigger = (run.trigger ?? {}) as { file_url?: unknown; details?: unknown };
  if (typeof trigger.file_url !== "string") return null;
  // Stored details are already in our own shape; this only checks what is there.
  const details = trigger.details as ReturnType<typeof readFileDetails>;
  if (!details?.fps || !details.width || !details.height || !details.duration) return null;
  return {
    url: trigger.file_url,
    fps: details.fps,
    width: details.width,
    height: details.height,
    duration: details.duration,
    hasAudio: details.hasAudio ?? true,
    ...(details.audioChannels ? { audioChannels: details.audioChannels } : {}),
    ...(details.audioSampleRate ? { audioSampleRate: details.audioSampleRate } : {}),
  };
}

/**
 * The cuts a run made, for opening in a video editor. A "clips" step gives one timeline
 * per clip. Trim, Cut and Split give theirs when they worked on the file that started the
 * run and its details are known. Null when there is nothing to open.
 */
export async function cutListOf(
  ctx: QueryCtx,
  run: Doc<"runs">,
  steps: Doc<"runSteps">[],
): Promise<CutList | null> {
  const nodes = run.nodes as AutomationNode[];
  const started = triggerSource(run);
  const timelines: CutTimeline[] = [];
  for (const step of steps) {
    const node = nodes.find((candidate) => candidate.id === step.nodeId);
    if (step.plan && step.sources) {
      const frame = getPlatform(node?.input.platform)?.frame === "9:16" ? VERTICAL : undefined;
      const sources: Record<string, CutSource> = Object.fromEntries(
        step.sources.map((source) => [source.url, source]),
      );
      timelines.push(...clipsCutList(run.automationName, step.plan, sources, frame).timelines);
      continue;
    }
    if (!started || step.status !== "done" || node?.kind !== "step") continue;
    if (!isCuttingStep(node.stepId)) continue;
    for (const jobId of step.jobIds) {
      const job = await ctx.db.get(jobId);
      const input = (job?.input ?? {}) as Record<string, unknown>;
      // Only cuts made on the original recording: a cut of a cut has no file to point at.
      if (input.video_url !== started.url) continue;
      timelines.push(...stepTimelines(node.stepId, input, started));
    }
  }
  return timelines.length > 0 ? { name: run.automationName, timelines } : null;
}

/**
 * Captions of whole recordings in a run, by the recording's URL: what a Transcribe step
 * wrote when it was asked for caption timings as text.
 */
export async function captionsOf(
  ctx: QueryCtx,
  run: Doc<"runs">,
  steps: Doc<"runSteps">[],
): Promise<Record<string, Cue[]>> {
  const nodes = run.nodes as AutomationNode[];
  const found: Record<string, Cue[]> = {};
  for (const step of steps) {
    const node = nodes.find((candidate) => candidate.id === step.nodeId);
    if (step.status !== "done" || node?.stepId !== "media-transcribe") continue;
    for (const jobId of step.jobIds) {
      const job = await ctx.db.get(jobId);
      const url = (job?.input as { media_url?: unknown } | undefined)?.media_url;
      const srt = (job?.result as { srt?: unknown } | undefined)?.srt;
      // The toolkit can also hand back a link to the captions; only the text is used here.
      if (typeof url !== "string" || typeof srt !== "string" || /^https?:\/\//.test(srt)) continue;
      const cues = parseSrt(srt);
      if (cues.length > 0) found[url] = cues;
    }
  }
  return found;
}

/** The files a run finished with: what its last steps handed on, in order, once each. */
export function finishedFiles(run: Doc<"runs">, steps: Doc<"runSteps">[]): string[] {
  const edges = run.edges as { source: string }[];
  const feeds = new Set(edges.map((edge) => edge.source));
  const files = steps
    .filter((step) => step.status === "done" && !feeds.has(step.nodeId))
    .flatMap((step) => step.outputs);
  return [...new Set(files)];
}

/** The video editors a team uses. Until it says, every editor that opens a timeline. */
export async function editorsOf(ctx: QueryCtx, organizationId: string): Promise<EditorId[]> {
  const settings = await ctx.db
    .query("teamSettings")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .first();
  return settings?.editors ?? DEFAULT_EDITORS;
}
