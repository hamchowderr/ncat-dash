import { editingRecipes, moreRecipes, recipes, variantRecipes } from "@ncat-dash/step-catalog";

import { type AutomationEdge, type AutomationNode, NODE_GAP } from "./graph";
import type { Schedule } from "./schedule";
import { FOLLOW_SPEAKER_STEP } from "./follow";
import { clipsGraph } from "./setup";

type FileType = "any" | "video" | "audio" | "image";

export type StarterTrigger =
  | { kind: "manual" }
  | { kind: "webhook" }
  | { kind: "schedule"; schedule: Schedule }
  | {
      kind: "upload";
      fileType: FileType;
      /** Only files at least this long, in seconds, start the automation. */
      minSeconds?: number;
      /** Only files at most this long, in seconds, start the automation. */
      maxSeconds?: number;
    }
  | { kind: "folder"; prefix: string; fileType: FileType }
  | {
      /** Starts when a run of another of the team's automations ends; see chain.ts. */
      kind: "finished";
      /** The automation it follows. Empty until one is picked. */
      automationId: string;
      /** "done": after it works. "failed": after it fails. "either": both. */
      when: "done" | "failed" | "either";
    }
  | {
      /** Starts when a project slot moves to a status, on the slot's newest file. */
      kind: "slot";
      status: "todo" | "in_progress" | "review" | "approved" | "published";
      /** Which slots: one kind, or "any". */
      slotKind: "any" | "video" | "short" | "thumbnail" | "audio" | "other";
    };

/** What a ready-made automation is for, so the whole list can be sorted and filtered. */
export type StarterCategory =
  "clips" | "variants" | "captions" | "audio" | "music" | "delivery" | "pictures" | "after";

export const STARTER_CATEGORIES: { id: StarterCategory; label: string }[] = [
  { id: "clips", label: "Clips and shapes" },
  { id: "variants", label: "Hooks, lengths and ad variants" },
  { id: "captions", label: "Captions and text" },
  { id: "audio", label: "Audio and podcasts" },
  { id: "music", label: "Music" },
  { id: "delivery", label: "Delivery" },
  { id: "pictures", label: "Pictures and logos" },
  { id: "after", label: "After another automation" },
];

export interface Starter {
  id: string;
  name: string;
  description: string;
  /** "workflow" is several steps chained; "recipe" is a single ready-made FFmpeg step. */
  group: "workflow" | "recipe";
  category: StarterCategory;
  trigger: StarterTrigger;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  /**
   * For one that starts when another automation finishes: the ready-made automations it
   * is made to follow, best fit first. Setting it up after one of them wires the two.
   */
  follows?: string[];
}

const step = (
  id: string,
  stepId: string,
  column: number,
  row = 0,
  input: Record<string, unknown> = {},
): AutomationNode => ({
  id,
  kind: "step",
  stepId,
  input,
  position: { x: column * NODE_GAP, y: row * 150 },
});
const approval = (column: number): AutomationNode => ({
  id: "approval",
  kind: "approval",
  input: {},
  position: { x: column * NODE_GAP, y: 0 },
});
/** Connects the nodes in the order given. */
const chain = (...ids: string[]): AutomationEdge[] =>
  ids.slice(1).map((id, index) => ({ id: `${ids[index]}>${id}`, source: ids[index], target: id }));

/** The ad shapes: 9:16 for TikTok, Reels, Stories and Shorts; 4:5 for feeds; 16:9 for YouTube. */
const AD_SHAPES: [number, number][] = [
  [1080, 1920],
  [1080, 1350],
  [1920, 1080],
];
/** Captions in the middle, clear of the top 14% and bottom 35% that ad buttons cover. */
const AD_CAPTIONS = { settings: { position: "middle_center" } };

const WORKFLOWS: Starter[] = [
  {
    id: "social-clips",
    category: "clips",
    name: "Clips for social",
    description:
      "Every long video that arrives is cut at pauses in speech into clips that fit the platform you pick, reframed for it, and captioned.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "video" },
    ...clipsGraph({ platform: "Instagram Reels", captions: true, approve: false }),
  },
  {
    id: "clips-follow-speaker",
    category: "clips",
    name: "Clips that follow the speaker",
    description:
      "Every long video that arrives is cut at pauses in speech into vertical clips. In each clip the frame follows whoever is talking and cuts across when someone else speaks, then captions go on.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "video" },
    nodes: [
      {
        id: "clips",
        kind: "clips",
        input: { platform: "Instagram Reels" },
        position: { x: 0, y: 0 },
      },
      step("follow_1", FOLLOW_SPEAKER_STEP, 1),
      step("caption_1", "video-caption", 2),
    ],
    edges: chain("clips", "follow_1", "caption_1"),
  },
  {
    id: "follow-speaker-vertical",
    category: "clips",
    name: "Vertical that follows the speaker",
    description:
      "Each wide video you upload comes back vertical, with the frame on whoever is talking: it holds on them, drifts as they move and cuts across when someone else speaks.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "video" },
    nodes: [step("follow_1", FOLLOW_SPEAKER_STEP, 0, 0, { aspect: "9:16" })],
    edges: [],
  },
  {
    id: "folder-vertical-captions",
    category: "clips",
    name: "Vertical and captioned from a watched folder",
    description:
      "Drop a video in a folder of your bucket. It is cropped to vertical, captioned, and waits for your approval.",
    group: "workflow",
    trigger: { kind: "folder", prefix: "incoming/", fileType: "video" },
    nodes: [
      step("vertical_1", "recipe-crop-vertical", 0),
      step("caption_1", "video-caption", 1),
      approval(2),
    ],
    edges: chain("vertical_1", "caption_1", "approval"),
  },
  {
    id: "caption-uploads",
    category: "captions",
    name: "Caption every new upload",
    description: "Each video you upload comes back with captions burned in.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "video" },
    nodes: [step("caption_1", "video-caption", 0)],
    edges: [],
  },
  {
    id: "episode-audio-and-transcript",
    category: "audio",
    name: "Episode to audio and transcript",
    description:
      "Upload a recording and get an MP3 and a transcript side by side, ready for show notes.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "any" },
    nodes: [step("mp3_1", "media-to-mp3", 0, 0), step("transcribe_1", "media-transcribe", 0, 1)],
    edges: [],
  },
  {
    id: "branded-clip",
    category: "pictures",
    name: "Captioned video with your logo",
    description:
      "Captions each upload, puts your logo in the corner, and saves a frame to use as the thumbnail.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "video" },
    nodes: [
      step("caption_1", "video-caption", 0),
      step("logo_1", "recipe-logo", 1),
      step("frame_1", "recipe-frame", 2),
    ],
    edges: chain("caption_1", "logo_1", "frame_1"),
  },
  {
    id: "link-to-transcript",
    category: "audio",
    name: "Transcribe a link",
    description:
      "Another tool calls this automation's address with a link. The media is downloaded and transcribed.",
    group: "workflow",
    trigger: { kind: "webhook" },
    nodes: [step("download_1", "media-download", 0), step("transcribe_1", "media-transcribe", 1)],
    edges: chain("download_1", "transcribe_1"),
  },
  {
    id: "vertical-blur-captions",
    category: "clips",
    name: "Vertical with a blurred background, captioned",
    description:
      "Every wide video you upload is fitted into a vertical frame over a blurred copy of itself, so nothing is cut off, then captioned and held for your approval.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "video" },
    nodes: [
      step("fill_1", "recipe-blur-fill", 0),
      step("caption_1", "video-caption", 1),
      approval(2),
    ],
    edges: chain("fill_1", "caption_1", "approval"),
  },
  {
    id: "every-shape",
    category: "clips",
    name: "Every shape from one upload",
    description:
      "One upload comes back as a vertical 9:16, a square 1:1 and a 4:5 for feeds, each with a blurred background instead of cropping.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "video" },
    nodes: [
      step("vertical_1", "recipe-blur-fill", 0, 0, { width: 1080, height: 1920 }),
      step("square_1", "recipe-blur-fill", 0, 1, { width: 1080, height: 1080 }),
      step("feed_1", "recipe-blur-fill", 0, 2, { width: 1080, height: 1350 }),
    ],
    edges: [],
  },
  {
    id: "web-set",
    category: "delivery",
    name: "Web set for every upload",
    description:
      "Each video you upload gets a web-ready MP4, a vertical version, a thumbnail and a GIF preview, all made at once.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "video" },
    nodes: [
      step("web_1", "recipe-web-ready", 0, 0),
      step("vertical_1", "recipe-blur-fill", 0, 1),
      step("thumbnail_1", "video-thumbnail", 0, 2),
      step("gif_1", "recipe-gif-preview", 0, 3),
    ],
    edges: [],
  },
  {
    id: "delivery-pass",
    category: "delivery",
    name: "Delivery pass for finished videos",
    description:
      "Drop a finished video in a folder. It comes back web-ready with its sound at the loudness YouTube, TikTok and Spotify expect.",
    group: "workflow",
    trigger: { kind: "folder", prefix: "finished/", fileType: "video" },
    nodes: [step("web_1", "recipe-web-ready", 0), step("loudness_1", "recipe-loudness", 1)],
    edges: chain("web_1", "loudness_1"),
  },
  {
    id: "audio-to-video",
    category: "music",
    name: "Audio to video with cover art",
    description:
      "Upload a song or an episode and get a video of it: your cover art with a moving sound wave, ready for YouTube.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "audio" },
    nodes: [step("cover_1", "recipe-cover-art-video", 0)],
    edges: [],
  },
  {
    id: "lyric-video",
    category: "music",
    name: "Lyric video with highlighted words",
    description:
      "Upload a song. It becomes a video of the cover art with the words lighting up as they are sung, then waits for you to check the words before it is used.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "audio" },
    nodes: [
      step("cover_1", "recipe-cover-art-video", 0, 0, { waveform: false }),
      step("caption_1", "video-caption", 1, 0, {
        settings: { style: "karaoke", position: "middle_center" },
      }),
      approval(2),
    ],
    edges: chain("cover_1", "caption_1", "approval"),
  },
  {
    id: "music-release-pack",
    category: "music",
    name: "Music release pack",
    description:
      "From one song and its cover art: a 16:9 video with a sound wave, a vertical version for Shorts and Reels, and a thumbnail.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "audio" },
    nodes: [
      step("cover_1", "recipe-cover-art-video", 0),
      step("vertical_1", "recipe-blur-fill", 1, 0),
      step("thumbnail_1", "video-thumbnail", 1, 1),
    ],
    edges: [...chain("cover_1", "vertical_1"), ...chain("cover_1", "thumbnail_1")],
  },
  {
    id: "podcast-master",
    category: "audio",
    name: "Podcast master and transcript",
    description:
      "Upload a raw episode, audio or video. The voice is cleaned up and brought to podcast loudness as an MP3, and the MP3 is transcribed for show notes.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "any" },
    nodes: [
      step("master_1", "recipe-voice-master", 0),
      step("transcribe_1", "media-transcribe", 1),
    ],
    edges: chain("master_1", "transcribe_1"),
  },
  {
    id: "recording-pack",
    category: "audio",
    name: "Sermon, webinar or lecture pack",
    description:
      "Upload the full recording. Its sound is evened out, then you get an MP3 for the podcast feed, a transcript and a thumbnail.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "video" },
    nodes: [
      step("loudness_1", "recipe-loudness", 0),
      step("mp3_1", "media-to-mp3", 1, 0),
      step("transcribe_1", "media-transcribe", 1, 1),
      step("thumbnail_1", "video-thumbnail", 1, 2),
    ],
    edges: [
      ...chain("loudness_1", "mp3_1"),
      ...chain("loudness_1", "transcribe_1"),
      ...chain("loudness_1", "thumbnail_1"),
    ],
  },
  {
    id: "coaching-session-pack",
    category: "clips",
    name: "Coaching session pack",
    description:
      "Upload a full coaching session, call or webinar. It is split into chapters with show notes, you get a transcript, and the best moments are cut as captioned clips for the platform you pick. The AI reads the transcript once to pick; the cutting is plain editing.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "video" },
    nodes: [
      { id: "chapters_1", kind: "chapters", input: {}, position: { x: 0, y: 0 } },
      {
        id: "moments_1",
        kind: "moments",
        input: { platform: "Instagram Reels" },
        position: { x: NODE_GAP, y: 0 },
      },
      step("caption_1", "video-caption", 2),
      step("transcribe_1", "media-transcribe", 1, 1),
    ],
    edges: [
      ...chain("chapters_1", "moments_1", "caption_1"),
      ...chain("chapters_1", "transcribe_1"),
    ],
  },
  {
    id: "talking-head-broll",
    category: "clips",
    name: "Talking head with B-Roll",
    description:
      "Each video you upload gets short cutaways where what you say can be shown, from your Content Library first and then free stock, while your voice carries on. Then captions go on. No AI: footage is matched to your words by how it looks.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "video" },
    nodes: [
      { id: "broll_1", kind: "broll", input: {}, position: { x: 0, y: 0 } },
      step("caption_1", "video-caption", 1),
    ],
    edges: chain("broll_1", "caption_1"),
  },
  {
    id: "clips-with-broll",
    category: "clips",
    name: "Clips with B-Roll",
    description:
      "Every long video that arrives is cut at pauses in speech into clips that fit the platform you pick. Each clip gets cutaways over what is said, from your library and free stock, then captions.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "video" },
    nodes: [
      {
        id: "clips",
        kind: "clips",
        input: { platform: "Instagram Reels" },
        position: { x: 0, y: 0 },
      },
      {
        id: "broll_1",
        kind: "broll",
        input: { often: "busy", seconds: 2 },
        position: { x: NODE_GAP, y: 0 },
      },
      step("caption_1", "video-caption", 2),
    ],
    edges: chain("clips", "broll_1", "caption_1"),
  },
  {
    id: "podcast-package",
    category: "audio",
    name: "Podcast package",
    description:
      "Upload a recorded episode. Your intro and outro from Settings go on each end, your music plays quietly underneath, the sound is brought to podcast loudness, and you get both the video and an MP3 for the feed.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "video" },
    nodes: [
      step("intro_outro_1", "recipe-intro-outro", 0),
      step("music_1", "recipe-background-music", 1),
      step("loudness_1", "recipe-loudness", 2),
      step("mp3_1", "media-to-mp3", 3),
    ],
    edges: chain("intro_outro_1", "music_1", "loudness_1", "mp3_1"),
  },
  {
    id: "thumbnail-choices",
    category: "pictures",
    name: "Thumbnail choices with your title",
    description:
      "Each video you upload gives you frames from across it, each with the video's name in a band in your brand colour and font, so you can pick a thumbnail.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "video" },
    nodes: [
      step("frames_1", "recipe-frame-choices", 0),
      step("title_1", "recipe-title-on-picture", 1),
    ],
    edges: chain("frames_1", "title_1"),
  },
  {
    id: "reaction-vertical",
    category: "clips",
    name: "Reaction stacked for vertical",
    description:
      "Start it with the video you react to and pick your reaction recording. They are stacked top and bottom in a vertical frame, then captioned.",
    group: "workflow",
    trigger: { kind: "manual" },
    nodes: [step("stack_1", "recipe-stack", 0), step("caption_1", "video-caption", 1)],
    edges: chain("stack_1", "caption_1"),
  },
  {
    id: "clip-with-end-card",
    category: "clips",
    name: "Captioned video with your end card",
    description:
      "Each video you upload is captioned and finishes on your card from Settings with a line of your choosing, like a follow prompt.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "video" },
    nodes: [step("caption_1", "video-caption", 0), step("card_1", "recipe-video-card", 1)],
    edges: chain("caption_1", "card_1"),
  },
  {
    id: "ugc-ad-variants",
    category: "variants",
    name: "UGC Ad Variants",
    description:
      "Start it with the creator's base cut and pick their other hook and ending takes on the first step. You get every hook and ending pairing at 6, 15, 30 and 60 seconds, in 9:16, 4:5 and 16:9, both clean and captioned, each named for what is in it, like h02_c01_15s_9x16, kept in a folder per creator and per shape, with an Ad files.csv list for your ads manager. Plain editing on real footage, no AI.",
    group: "workflow",
    trigger: { kind: "manual" },
    nodes: [
      step("variants_1", "recipe-hook-variants", 0),
      step("lengths_1", "recipe-length-cuts", 1, 0, {
        lengths: "6, 15, 30, 60",
        ending_seconds: 4,
      }),
      ...AD_SHAPES.map(([width, height], row) =>
        step(`shape_${row + 1}`, "recipe-blur-fill", 2, row, { width, height }),
      ),
      ...AD_SHAPES.map((_, row) =>
        step(`caption_${row + 1}`, "video-caption", 3, row, AD_CAPTIONS),
      ),
    ],
    edges: [
      ...chain("variants_1", "lengths_1"),
      ...AD_SHAPES.flatMap((_, row) =>
        chain("lengths_1", `shape_${row + 1}`, `caption_${row + 1}`),
      ),
    ],
  },
  {
    id: "ad-length-cuts",
    category: "variants",
    name: "Ad Length Cuts In Every Shape",
    description:
      "Each finished ad or promo you upload is cut to 6, 15, 30 and 60 seconds, keeping its call to action at the end, then made 9:16, 4:5 and 16:9. Every cut ends in a pause, never mid-word, and is named like 15s_9x16, in one folder per shape with an Ad files.csv list.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "video" },
    nodes: [
      step("lengths_1", "recipe-length-cuts", 0, 0, {
        lengths: "6, 15, 30, 60",
        ending_seconds: 4,
      }),
      ...AD_SHAPES.map(([width, height], row) =>
        step(`shape_${row + 1}`, "recipe-blur-fill", 1, row, { width, height }),
      ),
    ],
    edges: AD_SHAPES.flatMap((_, row) => chain("lengths_1", `shape_${row + 1}`)),
  },
  {
    id: "teaser-lengths",
    category: "variants",
    name: "Teasers In Three Lengths",
    description:
      "For coaches, podcasters and brands: each video you upload becomes a 15, 30 and 60 second teaser from its start, each ending in a pause, then captioned. Post the length each platform likes best.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "video" },
    nodes: [
      step("lengths_1", "recipe-length-cuts", 0, 0, { lengths: "15, 30, 60" }),
      step("caption_1", "video-caption", 1),
    ],
    edges: chain("lengths_1", "caption_1"),
  },
  {
    id: "opening-line-tests",
    category: "variants",
    name: "Opening Line Tests",
    description:
      "Write up to five opening lines once. Each video you upload comes back as one copy per line, with that line big over the first three seconds, then captioned, so you can see which hook keeps people watching.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "video" },
    nodes: [
      step("lines_1", "recipe-opening-lines", 0),
      step("caption_1", "video-caption", 1, 0, AD_CAPTIONS),
    ],
    edges: chain("lines_1", "caption_1"),
  },
  {
    id: "song-teasers-vertical",
    category: "music",
    name: "Song Teasers For Reels And Shorts",
    description:
      "Upload a song. You get three 15 second teasers from different parts of it, so you can test which part grabs people, each made into a vertical video of your cover art with a moving sound wave.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "audio" },
    nodes: [
      step("teasers_1", "recipe-song-teasers", 0),
      step("cover_1", "recipe-cover-art-video", 1, 0, { width: 1080, height: 1920 }),
    ],
    edges: chain("teasers_1", "cover_1"),
  },
];

/** Starts once a run of the automation it is set up after ends; that one is picked later. */
const after = (when: "done" | "failed" = "done"): StarterTrigger => ({
  kind: "finished",
  automationId: "",
  when,
});

/**
 * Ready-made automations that carry on from another one: each starts by itself when a run
 * of the one it follows ends, and works on that run's finished files.
 */
const FOLLOW_ONS: Starter[] = [
  {
    id: "brand-every-clip",
    category: "after",
    name: "Brand Every Clip",
    description:
      "Starts when your clips are made. Each clip gets your logo in the top right corner and finishes on your end card from Settings.",
    group: "workflow",
    trigger: after(),
    follows: [
      "social-clips",
      "clips-follow-speaker",
      "clips-with-broll",
      "coaching-session-pack",
      "clips-from-episode",
      "backup-clips-follow-speaker",
    ],
    nodes: [step("logo_1", "recipe-logo", 0), step("card_1", "recipe-video-card", 1)],
    edges: chain("logo_1", "card_1"),
  },
  {
    id: "ready-to-post",
    category: "after",
    name: "Ready To Post",
    description:
      "Starts when a captioned or branded video is finished. It is made web-ready with its sound at the loudness YouTube, TikTok and Spotify expect, and you get a thumbnail beside it.",
    group: "workflow",
    trigger: after(),
    follows: [
      "brand-every-clip",
      "caption-uploads",
      "clip-with-end-card",
      "talking-head-broll",
      "vertical-blur-captions",
      "folder-vertical-captions",
    ],
    nodes: [
      step("web_1", "recipe-web-ready", 0, 0),
      step("loudness_1", "recipe-loudness", 1, 0),
      step("thumbnail_1", "video-thumbnail", 0, 1),
    ],
    edges: chain("web_1", "loudness_1"),
  },
  {
    id: "every-shape-after-captions",
    category: "after",
    name: "Every Shape After Captions",
    description:
      "Starts when a captioned video is finished. It comes back as a vertical 9:16, a square 1:1 and a 4:5 for feeds, each over a blurred copy of itself so nothing is cut off.",
    group: "workflow",
    trigger: after(),
    follows: ["caption-uploads", "talking-head-broll", "clip-with-end-card"],
    nodes: [
      step("vertical_1", "recipe-blur-fill", 0, 0, { width: 1080, height: 1920 }),
      step("square_1", "recipe-blur-fill", 0, 1, { width: 1080, height: 1080 }),
      step("feed_1", "recipe-blur-fill", 0, 2, { width: 1080, height: 1350 }),
    ],
    edges: [],
  },
  {
    id: "backup-follow-speaker",
    category: "after",
    name: "Backup When Following The Speaker Fails",
    description:
      "Starts only when following the speaker fails. The same upload is fitted into a vertical frame over a blurred copy of itself, captioned and held for your approval, so you still get a video.",
    group: "workflow",
    trigger: after("failed"),
    follows: ["follow-speaker-vertical"],
    nodes: [
      step("fill_1", "recipe-blur-fill", 0),
      step("caption_1", "video-caption", 1),
      approval(2),
    ],
    edges: chain("fill_1", "caption_1", "approval"),
  },
  {
    id: "backup-clips-follow-speaker",
    category: "after",
    name: "Backup When Clips Can't Follow The Speaker",
    description:
      "Starts only when clips that follow the speaker fail. The same upload is cut into clips with a plain vertical crop, captioned and held for your approval, so you still get clips.",
    group: "workflow",
    trigger: after("failed"),
    follows: ["clips-follow-speaker"],
    ...clipsGraph({ platform: "Instagram Reels", captions: true, approve: true }),
  },
  {
    id: "clips-from-episode",
    category: "after",
    name: "Clips From The Episode",
    description:
      "Starts when an episode or recording pack is finished. The cleaned-up video is cut at pauses in speech into captioned clips that fit the platform you pick.",
    group: "workflow",
    trigger: after(),
    follows: ["podcast-package", "recording-pack"],
    ...clipsGraph({ platform: "Instagram Reels", captions: true, approve: false }),
  },
  {
    id: "episode-video-youtube",
    category: "after",
    name: "Episode Video For YouTube",
    description:
      "Starts when an episode's MP3 is made. It becomes a video of your logo as cover art with a moving sound wave in your brand colour, ready for YouTube.",
    group: "workflow",
    trigger: after(),
    follows: ["episode-audio-and-transcript"],
    nodes: [step("cover_1", "recipe-cover-art-video", 0)],
    edges: [],
  },
  {
    id: "lyric-video-vertical",
    category: "after",
    name: "Lyric Video For Reels And Shorts",
    description:
      "Starts once you approve a lyric video. You get a vertical version over a blurred background for Reels and Shorts, and a thumbnail.",
    group: "workflow",
    trigger: after(),
    follows: ["lyric-video"],
    nodes: [
      step("vertical_1", "recipe-blur-fill", 0, 0),
      step("thumbnail_1", "video-thumbnail", 0, 1),
    ],
    edges: [],
  },
  {
    id: "thumbnail-choices-after",
    category: "after",
    name: "Thumbnail Choices For Finished Videos",
    description:
      "Starts when a finished video is made. You get frames from across it, each with the video's name in a band in your brand colour and font, to pick a thumbnail from.",
    group: "workflow",
    trigger: after(),
    follows: ["talking-head-broll", "clip-with-end-card"],
    nodes: [
      step("frames_1", "recipe-frame-choices", 0),
      step("title_1", "recipe-title-on-picture", 1),
    ],
    edges: chain("frames_1", "title_1"),
  },
];

const IMAGE_FIRST = new Set(["image_url", "background_url"]);

const RECIPE_CATEGORY: Record<string, StarterCategory> = {
  "recipe-join-videos": "clips",
  "recipe-clip": "clips",
  "recipe-crop-vertical": "clips",
  "recipe-reaction": "clips",
  "recipe-blur-fill": "clips",
  "recipe-frame": "pictures",
  "recipe-logo": "pictures",
  "recipe-picture-on-picture": "pictures",
  "recipe-picture-on-video": "pictures",
  "recipe-certificate": "pictures",
  "recipe-gif-preview": "pictures",
  "recipe-background-music": "audio",
  "recipe-voice-master": "audio",
  "recipe-cover-art-video": "music",
  "recipe-loudness": "delivery",
  "recipe-web-ready": "delivery",
  "recipe-picture-in-picture": "clips",
  "recipe-stack": "clips",
  "recipe-side-by-side": "clips",
  "recipe-green-screen": "clips",
  "recipe-fit-to-voiceover": "clips",
  "recipe-slideshow": "clips",
  "recipe-quote-card": "pictures",
  "recipe-title-on-picture": "pictures",
  "recipe-frame-choices": "pictures",
  "recipe-intro-outro": "delivery",
  "recipe-change-format": "delivery",
  "recipe-hook-variants": "variants",
  "recipe-length-cuts": "variants",
  "recipe-opening-lines": "variants",
  "recipe-song-teasers": "music",
};

/** One automation per ready-made FFmpeg step: the toolkit's examples and the dashboard's own. */
const RECIPES: Starter[] = [...recipes, ...moreRecipes, ...editingRecipes, ...variantRecipes].map(
  (recipe) => {
    // With no file to start from, or a list of them, the team starts it by hand.
    // Hook And Ending Variants needs its other takes picked, so it is started by hand too.
    const many =
      Boolean(recipe.listInput) ||
      recipe.primaryInput === null ||
      recipe.id === "recipe-hook-variants";
    return {
      id: recipe.id,
      name: recipe.title,
      description: recipe.description,
      group: "recipe" as const,
      // Every other recipe writes text on a picture or video.
      category: RECIPE_CATEGORY[recipe.id] ?? "captions",
      trigger: many
        ? { kind: "manual" as const }
        : {
            kind: "upload" as const,
            fileType: IMAGE_FIRST.has(recipe.primaryInput ?? "")
              ? ("image" as const)
              : recipe.id === "recipe-voice-master" || recipe.primaryInput === "media_url"
                ? ("any" as const)
                : recipe.primaryInput === "audio_url"
                  ? ("audio" as const)
                  : ("video" as const),
          },
      nodes: [step(`${recipe.id.replace(/^recipe-/, "").replace(/-/g, "_")}_1`, recipe.id, 0)],
      edges: [],
    };
  },
);

/** Ready-made automations a team can start from and then change. */
export const STARTERS: Starter[] = [...WORKFLOWS, ...FOLLOW_ONS, ...RECIPES];
