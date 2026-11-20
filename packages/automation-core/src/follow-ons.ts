/**
 * Follow-on automations: ready-made ones that start when another automation finishes
 * (see `follows` on a starter). This is how the dashboard knows which ones go well after
 * an automation, and how one is wired to the automation it is set up after.
 */
import { FOLLOW_SPEAKER_STEP } from "./follow";
import type { AutomationEdge, AutomationNode } from "./graph";
import { type Starter, type StarterTrigger, STARTERS } from "./starters";

/** The ready-made automations that start after another one finishes. */
export function isFollowOn(starter: Starter): boolean {
  return starter.trigger.kind === "finished" && (starter.follows?.length ?? 0) > 0;
}

/** The follow-ons made to run after the ready-made automation `starterId`, in list order. */
export function followOnsFor(starterId: string | null | undefined): Starter[] {
  if (!starterId) return [];
  return STARTERS.filter((starter) => isFollowOn(starter) && starter.follows!.includes(starterId));
}

/** The ready-made automations a follow-on is made to run after, by name, best fit first. */
export function followedNames(starter: Starter): string[] {
  return (starter.follows ?? []).flatMap(
    (id) => STARTERS.find((other) => other.id === id)?.name ?? [],
  );
}

/** What a follow-on's trigger becomes once it is set up after the automation `automationId`. */
export function followOnTrigger(starter: Starter, automationId: string): StarterTrigger {
  if (starter.trigger.kind !== "finished") return starter.trigger;
  return { ...starter.trigger, automationId };
}

/** The steps an automation is made of, as far as telling which ready-made it is goes. */
function shapeOf(
  trigger: Pick<StarterTrigger, "kind">,
  nodes: Pick<AutomationNode, "kind" | "stepId">[],
) {
  const steps = nodes.map((node) => `${node.kind}:${node.stepId ?? ""}`).sort();
  return `${trigger.kind}|${steps.join(",")}`;
}

/**
 * Which ready-made automation one was made from. Newer automations remember it; for older
 * ones, the ready-made with the same trigger and the same steps, when exactly one has them.
 */
export function starterOf(automation: {
  starterId?: string | null;
  trigger: Pick<StarterTrigger, "kind">;
  nodes: Pick<AutomationNode, "kind" | "stepId">[];
}): string | null {
  if (automation.starterId && STARTERS.some((starter) => starter.id === automation.starterId)) {
    return automation.starterId;
  }
  if (automation.nodes.length === 0) return null;
  const shape = shapeOf(automation.trigger, automation.nodes);
  const same = STARTERS.filter((starter) => shapeOf(starter.trigger, starter.nodes) === shape);
  return same.length === 1 ? same[0].id : null;
}

/** On a ready-made follow-on's card: which ready-made automations it is made to run after. */
export function followsLine(starter: Starter): string | null {
  const names = followedNames(starter);
  if (names.length === 0) return null;
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  return starter.trigger.kind === "finished" && starter.trigger.when === "failed"
    ? `Runs if ${list} fails`
    : `Runs after ${list}`;
}

/** Steps that make clips: what comes after them works on each clip. */
const CLIP_KINDS = new Set(["clips", "moments"]);
/** Steps whose files are finished videos. */
const VIDEO_KINDS = new Set(["clips", "moments", "broll", "motion", "sound-effects"]);
const VIDEO_STEPS = new Set([
  "video-caption",
  FOLLOW_SPEAKER_STEP,
  "recipe-logo",
  "recipe-video-card",
  "recipe-blur-fill",
  "recipe-crop-vertical",
  "recipe-intro-outro",
  "recipe-background-music",
  "recipe-picture-in-picture",
  "recipe-stack",
  "recipe-side-by-side",
  "recipe-green-screen",
  "recipe-web-ready",
  "recipe-loudness",
  "video-trim",
  "video-cut",
]);
/** Steps whose files are finished audio. */
const AUDIO_STEPS = new Set(["media-to-mp3", "recipe-voice-master"]);

/**
 * For an automation not made from a ready-made: follow-ons that suit what it ends with.
 * Clips get branded; a finished video gets made ready to post, reshaped or thumbnailed; an
 * MP3 becomes a video. Backups are left out, since they only make sense after one step.
 */
export function followOnsByEnd(
  nodes: Pick<AutomationNode, "id" | "kind" | "stepId">[],
  edges: Pick<AutomationEdge, "source" | "target">[],
): Starter[] {
  const leads = new Set(edges.map((edge) => edge.source));
  // An approval hands on what it was shown, so the steps before it count as the end.
  const ends = new Set<string>();
  const endOf = (id: string, seen: Set<string>) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = nodes.find((each) => each.id === id);
    if (node?.kind === "approval") {
      for (const edge of edges) if (edge.target === id) endOf(edge.source, seen);
    } else ends.add(id);
  };
  for (const node of nodes) if (!leads.has(node.id)) endOf(node.id, new Set());
  const last = nodes.filter((node) => ends.has(node.id));
  const isVideo = (node: (typeof last)[number]) =>
    VIDEO_KINDS.has(node.kind) || (node.kind === "step" && VIDEO_STEPS.has(node.stepId ?? ""));
  const ids: string[] = [];
  if (nodes.some((node) => CLIP_KINDS.has(node.kind)) && last.some(isVideo)) {
    ids.push("brand-every-clip");
  }
  if (last.some(isVideo)) {
    ids.push("ready-to-post", "every-shape-after-captions", "thumbnail-choices-after");
  }
  if (last.some((node) => node.kind === "step" && AUDIO_STEPS.has(node.stepId ?? ""))) {
    ids.push("episode-video-youtube");
  }
  return ids.flatMap((id) => STARTERS.find((starter) => starter.id === id) ?? []);
}
