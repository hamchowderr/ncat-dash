/**
 * Free stock footage for B-Roll: Pixabay and Pexels. Both let footage be used in edited
 * videos with no credit needed; both ask apps to show where results come from, so the run
 * page names the site and links each clip's page. Pixabay also asks that searches be kept
 * for 24 hours, which stockSearches does.
 */

export type StockSite = "pixabay" | "pexels";

export const STOCK_SITE_NAMES: Record<StockSite, string> = { pixabay: "Pixabay", pexels: "Pexels" };

/** Searches are kept this long before the site is asked again. */
export const STOCK_CACHE_MS = 24 * 60 * 60 * 1000;
/** Results looked at per search. */
export const STOCK_PER_SEARCH = 4;

/** One stock video, with the rendition a cutaway will read. */
export interface StockHit {
  id: string;
  /** A rendition about 1080 pixels on its short side, or the nearest there is. */
  url: string;
  /** A still from it, for the picture model. */
  thumbnail: string;
  /** Its page on the site. */
  page: string;
  /** Who made it. */
  by: string;
  /** What the site says it shows. */
  title: string;
  duration: number;
  width: number;
  height: number;
}

/** The words a stock search sends: plain, short, no symbols. */
export function stockQuery(words: string): string {
  return words
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export function pixabaySearchUrl(key: string, query: string, tall: boolean): string {
  const params = new URLSearchParams({
    key,
    q: stockQuery(query),
    video_type: "film",
    safesearch: "true",
    per_page: String(Math.max(3, STOCK_PER_SEARCH)),
    ...(tall ? {} : { min_width: "1280" }),
  });
  return `https://pixabay.com/api/videos/?${params}`;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** The hits in a Pixabay video search answer. */
export function pixabayHits(answer: unknown): StockHit[] {
  const hits = (answer as { hits?: unknown } | null)?.hits;
  if (!Array.isArray(hits)) return [];
  const found: StockHit[] = [];
  for (const raw of hits) {
    const hit = raw as Record<string, unknown>;
    const videos = (hit.videos ?? {}) as Record<string, Record<string, unknown> | undefined>;
    // The rendition nearest 1080 pixels on its short side: sizes differ from video to
    // video ("large" is 4K on some and 1080 on others), and 4K is slow to read.
    const short = (one: Record<string, unknown>) => Math.min(number(one.width), number(one.height));
    const rendition = [videos.large, videos.medium, videos.small, videos.tiny]
      .filter((one): one is Record<string, unknown> => !!one && text(one.url) !== "")
      .sort((a, b) => Math.abs(short(a) - 1080) - Math.abs(short(b) - 1080))[0];
    if (!rendition) continue;
    found.push({
      id: `pixabay:${number(hit.id)}`,
      url: text(rendition.url),
      thumbnail: text(rendition.thumbnail) || text(videos.tiny?.thumbnail),
      page: text(hit.pageURL),
      by: text(hit.user),
      title: text(hit.tags),
      duration: number(hit.duration),
      width: number(rendition.width),
      height: number(rendition.height),
    });
  }
  return found.filter((hit) => hit.thumbnail !== "").slice(0, STOCK_PER_SEARCH);
}

export function pexelsSearchUrl(query: string, tall: boolean): string {
  const params = new URLSearchParams({
    query: stockQuery(query),
    orientation: tall ? "portrait" : "landscape",
    size: "medium",
    per_page: String(STOCK_PER_SEARCH),
  });
  return `https://api.pexels.com/v1/videos/search?${params}`;
}

/** The hits in a Pexels video search answer. */
export function pexelsHits(answer: unknown): StockHit[] {
  const videos = (answer as { videos?: unknown } | null)?.videos;
  if (!Array.isArray(videos)) return [];
  const found: StockHit[] = [];
  for (const raw of videos) {
    const video = raw as Record<string, unknown>;
    const files = (Array.isArray(video.video_files) ? video.video_files : []) as Record<
      string,
      unknown
    >[];
    const playable = files.filter(
      (file) => text(file.link) !== "" && text(file.file_type) === "video/mp4",
    );
    // The rendition nearest 1080 on its short side.
    const short = (file: Record<string, unknown>) =>
      Math.min(number(file.width), number(file.height));
    const best = playable.sort((a, b) => Math.abs(short(a) - 1080) - Math.abs(short(b) - 1080))[0];
    if (!best) continue;
    const user = (video.user ?? {}) as Record<string, unknown>;
    const page = text(video.url);
    found.push({
      id: `pexels:${number(video.id)}`,
      url: text(best.link),
      thumbnail: text(video.image),
      page,
      by: text(user.name),
      // Pexels pages are named after what they show: /video/a-cat-on-a-sofa-1234/.
      title: page.replace(/\/$/, "").split("/").pop()!.replace(/-\d+$/, "").replace(/-/g, " "),
      duration: number(video.duration),
      width: number(best.width),
      height: number(best.height),
    });
  }
  return found.filter((hit) => hit.thumbnail !== "").slice(0, STOCK_PER_SEARCH);
}
