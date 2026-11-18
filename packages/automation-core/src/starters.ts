import { moreRecipes, recipes } from "@ncat-dash/step-catalog";

import { type AutomationEdge, type AutomationNode, NODE_GAP } from "./graph";
import type { Schedule } from "./schedule";
import { CLIP_CAPTION_SETTINGS } from "./clips";
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
    };

/** What a ready-made automation is for, so the whole list can be sorted and filtered. */
export type StarterCategory = "clips" | "captions" | "audio" | "music" | "delivery" | "pictures";

export const STARTER_CATEGORIES: { id: StarterCategory; label: string }[] = [
  { id: "clips", label: "Clips and shapes" },
  { id: "captions", label: "Captions and text" },
  { id: "audio", label: "Audio and podcasts" },
  { id: "music", label: "Music" },
  { id: "delivery", label: "Delivery" },
  { id: "pictures", label: "Pictures and logos" },
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
      step("caption_1", "video-caption", 2, 0, { settings: { ...CLIP_CAPTION_SETTINGS } }),
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
};

/** One automation per ready-made FFmpeg step: the toolkit's examples and the dashboard's own. */
const RECIPES: Starter[] = [...recipes, ...moreRecipes].map((recipe) => {
  const many = Boolean(recipe.listInput);
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
            : recipe.id === "recipe-voice-master"
              ? ("any" as const)
              : recipe.primaryInput === "audio_url"
                ? ("audio" as const)
                : ("video" as const),
        },
    nodes: [step(`${recipe.id.replace(/^recipe-/, "").replace(/-/g, "_")}_1`, recipe.id, 0)],
    edges: [],
  };
});

/** Ready-made automations a team can start from and then change. */
export const STARTERS: Starter[] = [...WORKFLOWS, ...RECIPES];
