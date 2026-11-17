import { formatLimit, frameName, getPlatform, type PlatformName } from "./clips";

/**
 * What the agent knows about each place content goes: how long a video may be, its
 * shape and size, the files it takes, how much text goes with it, and what works there.
 * Every figure comes from the platform's own help or developer pages, listed in
 * `sources`, read on CHECKED. Where only second-hand figures could be found it says so
 * in `unconfirmed`. The agent reads this through the dashboard (`platform_guide`), so a
 * self-hoster who updates the dashboard gets the agent's knowledge updated too.
 *
 * Clip targets (the Clips step's platforms) share their name with clips.ts PLATFORMS,
 * and a test keeps the two in step. Twitch is here only as a place videos come from.
 */
export const CHECKED = "2026-11-17";

export interface PlacementGuide {
  /** A clip target's name, or a place only described (Twitch). */
  name: PlatformName | "Twitch clips";
  app: string;
  /** What kind of post it is, in a few words. */
  kind: string;
  length: string;
  shape: string;
  file: string;
  text?: string;
  cover?: string;
  /** What works there and the traps to avoid, for building automations. */
  tips: string[];
  /** Figures that could not be read on the platform's own pages. */
  unconfirmed?: string;
  sources: string[];
}

const META_IG =
  "https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media";
const META_FB_REELS = "https://developers.facebook.com/docs/video-api/guides/reels-publishing";
const META_ADS = "https://www.facebook.com/business/ads-guide/update/video";
const YT_SHORTS = "https://support.google.com/youtube/answer/15424877";
const YT_UPLOAD = "https://support.google.com/youtube/answer/57407";
const YT_LONG = "https://support.google.com/youtube/answer/71673";
const YT_ENCODE = "https://support.google.com/youtube/answer/1722171";
const YT_THUMBS = "https://support.google.com/youtube/answer/72431";
const TT_MEDIA = "https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide";
const TT_POST = "https://developers.tiktok.com/doc/content-posting-api-reference-direct-post";

const META_FILE =
  "MP4 or MOV with the index at the front (fast start), H.264 or HEVC, 4:2:0, closed GOP, 23-60 fps, at most 25 Mbps; AAC audio, 48 kHz, mono or stereo, 128 kbps.";

export const PLACEMENTS: PlacementGuide[] = [
  {
    name: "YouTube Shorts",
    app: "YouTube",
    kind: "short vertical video in the Shorts feed",
    length:
      "Up to 3 min. A vertical or square video of 3 min or less becomes a Short by itself (uploads since 15 Oct 2024).",
    shape: "9:16 vertical at 1080x1920 (square 1:1 also counts as a Short).",
    file: "MP4, H.264 High profile, AAC-LC 48 kHz. About 8 Mbps at 1080p 30 fps, 12 Mbps at 60 fps.",
    text: "Title 100 characters, description 5,000.",
    cover:
      "9:16 thumbnail, 2160x3840 recommended (at least 640 high), JPG or PNG; a custom Shorts thumbnail can only be set in YouTube Studio on a computer.",
    tips: [
      "A Short over 1 min with an active copyright claim on its music is blocked everywhere; most licensed songs can only run 90 s (some 60 or 30 s). Keep music clips under 1 min, or use the team's own music.",
      "To stop a video under 3 min turning into a Short, make it 16:9 (the YouTube platform).",
    ],
    sources: [YT_SHORTS, YT_UPLOAD, YT_ENCODE, YT_THUMBS],
  },
  {
    name: "YouTube",
    app: "YouTube",
    kind: "regular wide video (long-form)",
    length:
      "Up to 15 min on an account that is not verified; a verified account can upload up to 12 hours or 256 GB, whichever is less. The Clips step cuts YouTube parts at 15 min.",
    shape: "16:9 wide at 1920x1080 (3840x2160 for 4K).",
    file: "MP4, H.264 High profile, AAC-LC 48 kHz, frame rate as recorded. About 8 Mbps at 1080p 30 fps, 12 Mbps at 60 fps, 35-45 Mbps for 4K.",
    text: "Title 100 characters, description 5,000.",
    cover:
      "16:9 thumbnail, 3840x2160 recommended (at least 640 wide), JPG or PNG, up to 50 MB from a computer (2 MB from the phone app). Needs a verified account.",
    tips: [
      "End screens need a video of 25 s or more.",
      "A vertical or square video of 3 min or less is treated as a Short, so keep long-form videos 16:9.",
    ],
    sources: [YT_UPLOAD, YT_LONG, YT_ENCODE, YT_THUMBS],
  },
  {
    name: "TikTok",
    app: "TikTok",
    kind: "short vertical video",
    length:
      "Every creator can post 3 min; some accounts can post 5 or 10 min. 10 min is the most an app can send through TikTok's posting API.",
    shape: "9:16 vertical at 1080x1920. Each side between 360 and 4096 pixels.",
    file: "MP4 (recommended), MOV or WebM; H.264 (recommended), H.265, VP8 or VP9; 23-60 fps; up to 4 GB.",
    text: "Caption 2,200 characters, hashtags and mentions included.",
    cover: "Picked as a moment of the video (default the first frame).",
    tips: [
      "Until TikTok audits the posting app, everything it posts is private (only the creator sees it).",
      "Cut clips at 3 min so they post on any account.",
    ],
    sources: [TT_MEDIA, TT_POST],
  },
  {
    name: "Instagram Reels",
    app: "Instagram",
    kind: "short vertical video (Reels tab and feed)",
    length: "3 s to 15 min. The Clips step cuts Reels at 3 min, where short clips do best.",
    shape: "9:16 vertical at 1080x1920 (at most 1920 wide).",
    file: `${META_FILE} Up to 300 MB through the posting API.`,
    text: "Caption 2,200 characters, at most 30 hashtags and 20 @ mentions.",
    cover: "JPEG up to 8 MB, 9:16. In the profile grid the middle of the cover is shown.",
    tips: ["Reels cannot go in a carousel.", "Up to 3 collaborators can be added."],
    sources: [META_IG],
  },
  {
    name: "Instagram Stories",
    app: "Instagram",
    kind: "full-screen story, gone after 24 hours",
    length: "3 s to 60 s.",
    shape: "9:16 vertical at 1080x1920.",
    file: `${META_FILE} Up to 100 MB.`,
    tips: [
      "Link, poll and location stickers cannot be added when posting through the API, only in the app.",
      "Keep text and logos away from the top and bottom, where the app draws its own buttons.",
    ],
    sources: [META_IG],
  },
  {
    name: "Instagram feed",
    app: "Instagram",
    kind: "video in the main feed, in a 4:5 frame",
    length: "3 s to 15 min (Instagram posts feed videos as Reels). The Clips step cuts at 3 min.",
    shape:
      "4:5 portrait at 1080x1350, the tallest shape the feed shows without cropping. Photos take 4:5 to 1.91:1.",
    file: `${META_FILE} Up to 300 MB.`,
    text: "Caption 2,200 characters, at most 30 hashtags and 20 @ mentions.",
    tips: [
      "A carousel holds 2 to 20 photos and videos; the caption goes on the carousel, not each item.",
      "Use Instagram Reels instead when the clip should fill the whole phone screen.",
    ],
    sources: [META_IG],
  },
  {
    name: "Facebook Reels",
    app: "Facebook",
    kind: "short vertical video",
    length:
      "3 s to 90 s through Facebook's posting API (the app itself takes longer videos). A reel shared as a Page story can be at most 60 s.",
    shape: "9:16 vertical at 1080x1920 (at least 540x960).",
    file: "MP4, H.264 or H.265 (VP9 and AV1 also work), 4:2:0, fixed frame rate 24-60 fps, closed GOP of 2-5 s; AAC-LC audio, 48 kHz stereo, 128 kbps or more.",
    text: "Title and a description with hashtags.",
    tips: [
      "A Page can post at most 30 reels a day through the API.",
      "Only reels of 90 s or less can be boosted as ads.",
    ],
    sources: [META_FB_REELS],
  },
  {
    name: "Facebook Stories",
    app: "Facebook",
    kind: "full-screen story, gone after 24 hours",
    length: "Up to 60 s.",
    shape: "9:16 vertical at 1080x1920.",
    file: "MP4 or MOV, H.264, AAC audio.",
    tips: [
      "Leave about the top 250 and bottom 340 pixels free of text and logos; the app draws over them.",
    ],
    unconfirmed:
      "Meta's own pages give only the 60 s limit for a reel shared as a Page story; the size and safe areas come from Meta's ad guidance as reported by others.",
    sources: [META_FB_REELS, META_ADS],
  },
  {
    name: "Facebook feed",
    app: "Facebook",
    kind: "video in the main feed",
    length:
      "The app now posts videos as reels of any length; ads in the feed run up to 241 min. The Clips step cuts at 3 min.",
    shape: "4:5 portrait, 1080x1350 (Meta's ad guide recommends 1440x1800).",
    file: "MP4 or MOV, H.264, square pixels, fixed frame rate, stereo AAC at 128 kbps or more; up to 4 GB.",
    text: "Keep the text short: Meta suggests 50-150 characters for the main text and 27 for a headline (ad guidance).",
    tips: ["Captions burned in help: most feed videos start with the sound off."],
    unconfirmed:
      "Meta publishes the 4:5 shape and 4 GB limit for feed ads; it gives no separate figures for unpaid feed posts.",
    sources: [META_ADS],
  },
  {
    name: "Threads",
    app: "Threads",
    kind: "video in a post",
    length: "Up to 5 min.",
    shape: "9:16 recommended (at most 1920 wide); any shape from very wide to very tall is taken.",
    file: "MP4 or MOV with the index at the front, H.264 or HEVC, 23-60 fps, at most 100 Mbps; AAC 48 kHz; up to 1 GB.",
    text: "500 characters.",
    tips: ["A carousel holds 2 to 20 items.", "At most 250 posts a day through the API."],
    sources: ["https://developers.facebook.com/docs/threads/overview"],
  },
  {
    name: "X",
    app: "X",
    kind: "video in a post",
    length:
      "Posts take up to 20 min (125 min with Premium) through X's API; 2 min 20 s is what every account and direct messages take, so the Clips step cuts there.",
    shape:
      "Keeps the video's own shape, between 1:3 and 3:1 and at most 1280x1024 (bigger videos are scaled down). X recommends 1280x720 wide, 720x1280 tall or 720x720 square.",
    file: "MP4, H.264 High profile, 4:2:0, progressive, no open GOP, at most 60 fps (30 or 60 recommended), at least 5 Mbps; AAC-LC mono or stereo, at least 128 kbps. Up to 8 GB (16 GB with Premium), 512 MB in direct messages.",
    text: "One video per post.",
    tips: ["Square 1:1 or wide 16:9 read best in the timeline."],
    sources: [
      "https://docs.x.com/x-api/media/quickstart/best-practices",
      "https://docs.x.com/x-api/media/quickstart/media-upload-chunked",
    ],
  },
  {
    name: "LinkedIn",
    app: "LinkedIn",
    kind: "video in a feed post",
    length: "3 s to 15 min (2 s from the phone app).",
    shape: "Keeps the video's own shape, between 1:2.4 and 2.4:1, from 256x144 up to 4096x2304.",
    file: "MP4, MOV, WebM, MKV and others; 10-60 fps; 192 kbps to 30 Mbps; 75 KB to 5 GB.",
    tips: [
      "Keep key text and logos away from the edges.",
      "Burned-in captions help, since many people watch with the sound off.",
    ],
    sources: ["https://www.linkedin.com/help/linkedin/answer/a548372"],
  },
  {
    name: "Pinterest",
    app: "Pinterest",
    kind: "video Pin",
    length: "4 s to 15 min; 6-15 s is what Pinterest recommends.",
    shape:
      "9:16 at 1080x1920 fills the screen; 2:3, 4:5 and 1:1 also work. Anything between 1:2 and 1.91:1.",
    file: "MP4, MOV or M4V, H.264 or H.265, up to 2 GB.",
    text: "Title 100 characters (the first 40 show in the feed), description 800.",
    cover: "Picked with Edit cover.",
    tips: ["Up to 10 videos per upload, and Pins can be scheduled up to 30 days ahead."],
    unconfirmed:
      "The length, shape and size figures are from Pinterest's ad specs; its page on unpaid video Pins gives no numbers.",
    sources: [
      "https://help.pinterest.com/en/business/article/pinterest-product-specs",
      "https://help.pinterest.com/en/business/article/video-pins",
    ],
  },
  {
    name: "Snapchat Spotlight",
    app: "Snapchat",
    kind: "short vertical video in the Spotlight feed",
    length: "5 s to 60 s.",
    shape: "9:16 vertical at 1080x1920.",
    file: "MP4 or MOV, H.264, AAC.",
    tips: ["Spotlight videos must be vertical and have sound."],
    unconfirmed:
      "Snapchat's help pages could not be read; these figures are as reported by others.",
    sources: ["https://help.snapchat.com/hc/en-us"],
  },
  {
    name: "Snapchat Stories",
    app: "Snapchat",
    kind: "full-screen story, gone after 24 hours",
    length: "Up to 60 s.",
    shape: "9:16 vertical at 1080x1920.",
    file: "MP4 or MOV, H.264, AAC.",
    tips: [],
    unconfirmed:
      "Snapchat's help pages could not be read; these figures are as reported by others.",
    sources: ["https://help.snapchat.com/hc/en-us"],
  },
  {
    name: "Twitch clips",
    app: "Twitch",
    kind: "where videos come from, not a place to post",
    length:
      "A clip is 5 s to 60 s, taken from the last 90 s of a live stream (30 s unless trimmed).",
    shape: "The stream's own shape, usually 16:9.",
    file: "Downloadable from Twitch as MP4.",
    tips: [
      "Stream clips and past broadcasts are good starting material: an automation can take a downloaded stream or clip, then make vertical clips for TikTok, Reels and Shorts.",
      "The dashboard does not post to Twitch.",
    ],
    sources: ["https://dev.twitch.tv/docs/api/clips/"],
  },
];

/** The guide for a place, matched loosely ("instagram reels", "Reels" is not enough). */
export function placementGuide(name: string): PlacementGuide | undefined {
  const wanted = name.trim().toLowerCase();
  return PLACEMENTS.find((guide) => guide.name.toLowerCase() === wanted);
}

/** One place as short text for the agent. */
export function placementText(guide: PlacementGuide): string {
  const target = getPlatform(guide.name);
  const lines = [
    `## ${guide.name} (${guide.kind})`,
    `- Length: ${guide.length}`,
    `- Shape: ${guide.shape}`,
    `- File: ${guide.file}`,
    ...(guide.text ? [`- Text: ${guide.text}`] : []),
    ...(guide.cover ? [`- Cover: ${guide.cover}`] : []),
    ...guide.tips.map((tip) => `- Tip: ${tip}`),
    target
      ? `- Clips for a platform "${target.name}" makes ${frameName(target.frame).toLowerCase()} clips of up to ${formatLimit(target.maxSeconds)}.`
      : "- Not a Clips platform.",
    ...(guide.unconfirmed ? [`- Not confirmed: ${guide.unconfirmed}`] : []),
    `- Sources (read ${CHECKED}): ${guide.sources.join(" ")}`,
  ];
  return lines.join("\n");
}

/** The guide for some places, or every place, as text for the agent. */
export function platformGuideText(names?: string[]): { text: string; unknown: string[] } {
  const chosen = names?.length ? names : PLACEMENTS.map((guide) => guide.name);
  const unknown: string[] = [];
  const parts: string[] = [];
  for (const name of chosen) {
    const guide = placementGuide(name);
    if (guide) parts.push(placementText(guide));
    else unknown.push(name);
  }
  if (unknown.length > 0) {
    parts.push(
      `Not in the guide: ${unknown.join(", ")}. Known: ${PLACEMENTS.map((guide) => guide.name).join(", ")}.`,
    );
  }
  return { text: parts.join("\n\n"), unknown };
}
