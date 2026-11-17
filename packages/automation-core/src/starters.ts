import { recipes } from "@ncat-dash/step-catalog";

import { type AutomationEdge, type AutomationNode, NODE_GAP } from "./graph";
import type { Schedule } from "./schedule";
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

export interface Starter {
  id: string;
  name: string;
  description: string;
  /** "workflow" is several steps chained; "recipe" is one FFmpeg example from the toolkit. */
  group: "workflow" | "recipe";
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
    name: "Clips for social",
    description:
      "Every long video that arrives is cut at pauses in speech into clips that fit the platform you pick, reframed for it, and captioned.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "video" },
    ...clipsGraph({ platform: "Instagram Reels", captions: true, approve: false }),
  },
  {
    id: "folder-vertical-captions",
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
    name: "Caption every new upload",
    description: "Each video you upload comes back with captions burned in.",
    group: "workflow",
    trigger: { kind: "upload", fileType: "video" },
    nodes: [step("caption_1", "video-caption", 0)],
    edges: [],
  },
  {
    id: "episode-audio-and-transcript",
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
    name: "Transcribe a link",
    description:
      "Another tool calls this automation's address with a link. The media is downloaded and transcribed.",
    group: "workflow",
    trigger: { kind: "webhook" },
    nodes: [step("download_1", "media-download", 0), step("transcribe_1", "media-transcribe", 1)],
    edges: chain("download_1", "transcribe_1"),
  },
];

const IMAGE_FIRST = new Set(["image_url", "background_url"]);

/** One automation per FFmpeg example in the toolkit's Postman collection. */
const RECIPES: Starter[] = recipes.map((recipe) => {
  const many = Boolean(recipe.listInput);
  return {
    id: recipe.id,
    name: recipe.title,
    description: recipe.description,
    group: "recipe" as const,
    trigger: many
      ? { kind: "manual" as const }
      : {
          kind: "upload" as const,
          fileType: IMAGE_FIRST.has(recipe.primaryInput ?? "")
            ? ("image" as const)
            : ("video" as const),
        },
    nodes: [step(`${recipe.id.replace(/^recipe-/, "").replace(/-/g, "_")}_1`, recipe.id, 0)],
    edges: [],
  };
});

/** Ready-made automations a team can start from and then change. */
export const STARTERS: Starter[] = [...WORKFLOWS, ...RECIPES];
