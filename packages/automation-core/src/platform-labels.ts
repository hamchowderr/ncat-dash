import { frameSize, getPlatform, PLATFORMS, type Platform, type PlatformName } from "./clips";
import { POSTING_APPS, type PostingAppId } from "./content-goals";

// Which platform each clip was made for, so a clip says "Instagram Reels" and not only
// "clip 1, 1:33". A clip cut by Clips for a platform or Best moments is made for the
// platform picked on that step, and the files later steps make from it (captioned,
// reframed, with music) are for the same platform. Any video can also be checked against
// each platform's shape and length, to say where else it fits.

/** The steps that cut clips for a platform, by their kind on the canvas. */
const CUTS_FOR_PLATFORM = new Set(["clips", "moments"]);

// How far a picture's shape can be from a platform's and still count as that shape:
// 1080x1920 and 720x1280 are both 9:16; 1080x1350 is not 1:1.
const SHAPE_TOLERANCE = 0.03;
// A clip a fraction of a second over a limit, from rounding, still fits.
const LENGTH_TOLERANCE = 0.5;

/** The posting app a platform belongs to, for its logo: "Instagram Reels" gives "instagram". */
export function platformApp(name: string): PostingAppId | null {
  const lower = name.toLowerCase();
  const app = POSTING_APPS.find(
    (one) => lower === one.label.toLowerCase() || lower.startsWith(`${one.label.toLowerCase()} `),
  );
  return app?.id ?? null;
}

interface RunNode {
  id: string;
  kind: string;
  off?: boolean;
  input?: Record<string, unknown>;
}

interface RunStep {
  nodeId: string;
  outputs: string[];
  items?: { url: string; from: string | null; kind?: string }[];
}

/**
 * The platform each of a run's videos was made for, by link. Clips cut for a platform
 * are for it; a video a later step made from one of them is for the same platform. A
 * video nothing cut for a platform is left out.
 */
export function runPlatforms(
  nodes: readonly RunNode[],
  steps: readonly RunStep[],
): Record<string, PlatformName> {
  const byNode = new Map(steps.map((step) => [step.nodeId, step]));
  const direct = new Map<string, PlatformName>();
  for (const node of nodes) {
    if (!CUTS_FOR_PLATFORM.has(node.kind) || node.off) continue;
    const platform = getPlatform(node.input?.platform);
    const step = byNode.get(node.id);
    if (!platform || !step) continue;
    for (const url of step.outputs) if (!direct.has(url)) direct.set(url, platform.name);
  }
  if (direct.size === 0) return {};

  // Where each file came from, from the steps' items.
  const from = new Map<string, string>();
  const kinds = new Map<string, string>();
  for (const step of steps) {
    for (const item of step.items ?? []) {
      if (item.from && !from.has(item.url)) from.set(item.url, item.from);
      if (item.kind) kinds.set(item.url, item.kind);
    }
  }
  const platformOf = (url: string): PlatformName | null => {
    let at: string | undefined = url;
    for (let hops = 0; at && hops < 50; hops++) {
      const found = direct.get(at);
      if (found) return found;
      at = from.get(at);
    }
    return null;
  };

  const found: Record<string, PlatformName> = {};
  const urls = new Set([...direct.keys(), ...from.keys()]);
  for (const url of urls) {
    // Only videos: a thumbnail or caption file made from a clip is not posted as the clip.
    const kind = kinds.get(url);
    if (kind && kind !== "video") continue;
    const platform = platformOf(url);
    if (platform) found[url] = platform;
  }
  return found;
}

/** A video's picture size and length, as the toolkit read them. */
export interface VideoShape {
  width?: number;
  height?: number;
  duration?: number;
}

function sameShape(a: { width: number; height: number }, b: { width: number; height: number }) {
  const ratio = a.width / a.height;
  const other = b.width / b.height;
  return Math.abs(ratio - other) / other <= SHAPE_TOLERANCE;
}

/**
 * Whether a video still suits a platform: its shape is the platform's, and it is no longer
 * than the platform takes. Unknown sizes and lengths count as suiting it.
 */
export function suitsPlatform(platform: Platform, video: VideoShape): boolean {
  const size = frameSize(platform.frame);
  if (size && video.width && video.height) {
    if (!sameShape({ width: video.width, height: video.height }, size)) return false;
  }
  if (video.duration && video.duration > platform.maxSeconds + LENGTH_TOLERANCE) return false;
  if (video.duration && platform.minSeconds && video.duration < platform.minSeconds) return false;
  return true;
}

/**
 * The platforms a video fits by its shape and length, in the Clips list's order. Only
 * platforms with a shape of their own count (LinkedIn and X take any shape, so they would
 * fit every video). `apps` keeps the list to these apps' platforms, such as where a team
 * posts; empty or left out, every platform counts.
 */
export function platformsThatFit(
  video: VideoShape,
  apps?: readonly string[] | null,
): PlatformName[] {
  if (!video.width || !video.height || !video.duration) return [];
  return (PLATFORMS as readonly Platform[])
    .filter((platform) => frameSize(platform.frame) !== null)
    .filter((platform) => {
      if (!apps || apps.length === 0) return true;
      const app = platformApp(platform.name);
      return app !== null && apps.includes(app);
    })
    .filter((platform) => suitsPlatform(platform, video))
    .map((platform) => platform.name as PlatformName);
}
