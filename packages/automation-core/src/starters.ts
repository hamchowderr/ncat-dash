import type { AutomationEdge, AutomationNode } from "./graph";
import type { Schedule } from "./schedule";
import { clipsGraph } from "./setup";

type FileType = "any" | "video" | "audio" | "image";

export type StarterTrigger =
  | { kind: "manual" }
  | { kind: "webhook" }
  | { kind: "schedule"; schedule: Schedule }
  | { kind: "upload"; fileType: FileType }
  | { kind: "folder"; prefix: string; fileType: FileType };

export interface Starter {
  id: string;
  name: string;
  description: string;
  trigger: StarterTrigger;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
}

const X = 0;
const at = (row: number, x = X) => ({ x, y: row * 130 });
const step = (id: string, stepId: string, position: { x: number; y: number }): AutomationNode => ({
  id,
  kind: "step",
  stepId,
  input: {},
  position,
});

/** Ready-made automations a team can start from and then change. */
export const STARTERS: Starter[] = [
  {
    id: "social-clips",
    name: "Clips for social",
    description:
      "Every long video that arrives is cut at pauses in speech into clips that fit the platform you pick, reframed for it, and captioned.",
    trigger: { kind: "upload", fileType: "video" },
    ...clipsGraph({ platform: "Instagram Reels", captions: true, approve: false }),
  },
  {
    id: "caption-uploads",
    name: "Caption every new upload",
    description: "Each video you upload here comes back with captions burned in.",
    trigger: { kind: "upload", fileType: "video" },
    nodes: [step("caption_1", "video-caption", at(1))],
    edges: [],
  },
  {
    id: "episode-audio-and-transcript",
    name: "Episode to audio and transcript",
    description:
      "Upload a recording and get an MP3 and a transcript side by side, ready for show notes.",
    trigger: { kind: "upload", fileType: "any" },
    nodes: [
      step("mp3_1", "media-to-mp3", at(1, -150)),
      step("transcribe_1", "media-transcribe", at(1, 150)),
    ],
    edges: [],
  },
];
