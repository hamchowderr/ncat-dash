import type { AutomationEdge, AutomationNode } from "./graph";
import type { Schedule } from "./schedule";

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
const link = (source: string, target: string): AutomationEdge => ({
  id: `${source}>${target}`,
  source,
  target,
});

/** Ready-made automations a team can start from and then change. */
export const STARTERS: Starter[] = [
  {
    id: "clips-from-folder",
    name: "Captioned clips from a watched folder",
    description:
      "Drop a long video into a folder in your bucket. It is cut into the clips you set, each clip is captioned, and you approve them before a thumbnail is made for each.",
    trigger: { kind: "folder", prefix: "incoming/", fileType: "video" },
    nodes: [
      {
        ...step("split_1", "video-split", at(1)),
        // A first guess to change: three one-minute clips from the start.
        input: {
          splits: [
            { start: "00:00:00", end: "00:01:00" },
            { start: "00:01:00", end: "00:02:00" },
            { start: "00:02:00", end: "00:03:00" },
          ],
        },
      },
      step("caption_1", "video-caption", at(2)),
      { id: "approval_1", kind: "approval", input: {}, position: at(3) },
      step("thumbnail_1", "video-thumbnail", at(4)),
    ],
    edges: [
      link("split_1", "caption_1"),
      link("caption_1", "approval_1"),
      link("approval_1", "thumbnail_1"),
    ],
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
