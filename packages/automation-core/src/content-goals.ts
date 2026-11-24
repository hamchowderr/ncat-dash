import { type AutomationNode } from "./graph";
import { getPlatform } from "./clips";
import { type Starter, STARTERS } from "./starters";

/**
 * What a team makes, asked once while setting up (and changeable in Settings). Each kind
 * names the ready-made automations that fit it, so the team starts with ones it will use.
 * Every suggestion is an existing ready-made: nothing here is a separate kind of automation.
 */
export interface ContentKind {
  id: string;
  label: string;
  /** One line under the label: what this kind of team brings in. */
  detail: string;
  /** Ready-made automations, by id, in the order they are offered. */
  starters: string[];
}

export const CONTENT_KINDS: ContentKind[] = [
  {
    id: "coaching",
    label: "Coaching or Courses",
    detail: "Sessions, group calls, webinars and lessons",
    starters: ["coaching-session-pack", "recording-pack"],
  },
  {
    id: "podcast",
    label: "Podcast",
    detail: "Episodes recorded on video or audio",
    starters: ["podcast-master", "clips-follow-speaker"],
  },
  {
    id: "talks",
    label: "Sermons or Talks",
    detail: "Services, keynotes, panels and lectures",
    starters: ["recording-pack", "social-clips"],
  },
  {
    id: "music",
    label: "Music",
    detail: "Songs, releases and cover art",
    starters: ["music-release-pack", "lyric-video"],
  },
  {
    id: "streams",
    label: "Streams and Gaming",
    detail: "Stream recordings, reactions and gameplay",
    starters: ["reaction-vertical", "vertical-blur-captions"],
  },
  {
    id: "clients",
    label: "Client Work",
    detail: "An agency or editor delivering for others",
    starters: ["every-shape", "delivery-pass"],
  },
  {
    id: "entrepreneurs",
    label: "Entrepreneurs",
    detail: "Founders, personal brands and solo businesses",
    starters: ["clips-follow-speaker", "caption-uploads"],
  },
  {
    id: "business",
    label: "Business Videos",
    detail: "Product videos, ads and announcements",
    starters: ["branded-clip", "clip-with-end-card"],
  },
];

/**
 * Where a team posts, by app. Each app stands for the placement its clips are made for by
 * default, one of the Clips platforms; the agent is told the placements.
 */
export const POSTING_APPS = [
  { id: "instagram", label: "Instagram", placement: "Instagram Reels" },
  { id: "tiktok", label: "TikTok", placement: "TikTok" },
  { id: "youtube", label: "YouTube", placement: "YouTube Shorts" },
  { id: "facebook", label: "Facebook", placement: "Facebook Reels" },
  { id: "linkedin", label: "LinkedIn", placement: "LinkedIn" },
  { id: "x", label: "X", placement: "X" },
  { id: "threads", label: "Threads", placement: "Threads" },
  { id: "pinterest", label: "Pinterest", placement: "Pinterest" },
  { id: "snapchat", label: "Snapchat", placement: "Snapchat Spotlight" },
] as const satisfies readonly { id: string; label: string; placement: string }[];

export type PostingAppId = (typeof POSTING_APPS)[number]["id"];

export const MAX_CONTENT_KINDS = CONTENT_KINDS.length;

/** The placements the picked apps stand for, in the order the apps are listed. */
export function placementsFor(apps: readonly string[]): string[] {
  return POSTING_APPS.filter((app) => apps.includes(app.id)).map((app) => app.placement);
}

/** The apps the saved placements stand for: the reverse of placementsFor. */
export function appsForPlacements(placements: readonly string[]): PostingAppId[] {
  return POSTING_APPS.filter((app) => placements.includes(app.placement)).map((app) => app.id);
}

/** A plain-language problem with the answers, or null when they can be saved. */
export function contentGoalsProblem(goals: { kinds: string[]; apps: string[] }): string | null {
  if (goals.kinds.length === 0) return "Pick at least one kind of content you make.";
  if (goals.kinds.some((kind) => !CONTENT_KINDS.some((each) => each.id === kind))) {
    return "One of the kinds of content is not one we know.";
  }
  if (goals.apps.some((app) => !POSTING_APPS.some((each) => each.id === app))) {
    return "One of the apps is not one we know.";
  }
  return null;
}

const PICKS_A_PLATFORM = new Set<AutomationNode["kind"]>(["clips", "moments"]);

/** The kinds of file an upload-started ready-made runs on, or none for any other start. */
function uploadTypes(starter: Starter): Set<string> {
  if (starter.trigger.kind !== "upload") return new Set();
  const type = starter.trigger.fileType ?? "any";
  return new Set(type === "any" ? ["video", "audio", "image"] : [type]);
}

/**
 * Two ready-mades clash when both cut clips out of the same uploaded file: run together
 * they make two sets of clips from one video.
 */
export function clashes(one: Starter, other: Starter): boolean {
  const makesClips = (starter: Starter) =>
    starter.nodes.some((node) => PICKS_A_PLATFORM.has(node.kind));
  if (!makesClips(one) || !makesClips(other)) return false;
  const types = uploadTypes(other);
  return [...uploadTypes(one)].some((type) => types.has(type));
}

/**
 * The ready-made automations that fit what a team makes: one for each kind picked, in the
 * order the kinds are listed. Each kind gives its first suggestion that is not offered
 * already and does not clash with one that is, so no two of them make clips from the same
 * upload. A kind whose suggestions are all taken or clash adds none.
 */
export function suggestedStarters(kinds: readonly string[]): Starter[] {
  const picked: Starter[] = [];
  for (const kind of CONTENT_KINDS.filter((each) => kinds.includes(each.id))) {
    const pick = kind.starters
      .map((id) => STARTERS.find((starter) => starter.id === id))
      .find(
        (starter): starter is Starter =>
          starter !== undefined &&
          !picked.includes(starter) &&
          !picked.some((other) => clashes(starter, other)),
      );
    if (pick) picked.push(pick);
  }
  return picked;
}

/**
 * A ready-made's steps made for where the team posts: every step that makes clips for a
 * platform makes them for the first one picked. With no platform picked, or one that is
 * not a Clips platform, the ready-made keeps its own.
 */
export function nodesForPlatform(nodes: AutomationNode[], platform: string | undefined) {
  if (!platform || !getPlatform(platform)) return nodes;
  return nodes.map((node) =>
    PICKS_A_PLATFORM.has(node.kind) ? { ...node, input: { ...node.input, platform } } : node,
  );
}
