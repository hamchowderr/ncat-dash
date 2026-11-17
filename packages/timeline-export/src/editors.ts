/**
 * Which files each video editor gets. A person picks their editor, never a file format.
 */
import type { CutList } from "./cuts";
import { fcp7Xml } from "./fcp7";
import { fcpXml } from "./fcpxml";
import { fileNameOf, sourcesOf } from "./cuts";

export const EDITORS = [
  { id: "premiere", name: "Premiere Pro", file: "xml" },
  { id: "resolve", name: "DaVinci Resolve", file: "xml" },
  { id: "finalcut", name: "Final Cut Pro", file: "fcpxml" },
  // CapCut opens no timeline file from any other tool; it gets the finished clips.
  { id: "capcut", name: "CapCut", file: null },
] as const;

export type EditorId = (typeof EDITORS)[number]["id"];

export const EDITOR_IDS = EDITORS.map((editor) => editor.id) as EditorId[];

/** The editors used when a team has not said which it uses: every one with a timeline. */
export const DEFAULT_EDITORS: EditorId[] = ["premiere", "resolve", "finalcut"];

export function isEditorId(value: unknown): value is EditorId {
  return EDITOR_IDS.includes(value as EditorId);
}

export interface EditorFile {
  /** File name to save as, with its extension. */
  name: string;
  text: string;
  /** The editors this file is for, by name. */
  editors: string[];
}

/** A name that is safe as a file name on every system. */
export const safeFileName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Timeline";

const HOW_TO: Record<Exclude<EditorId, "capcut">, string> = {
  premiere: "Premiere Pro: File > Import, pick the .xml file.",
  resolve: "DaVinci Resolve: File > Import > Timeline, pick the .xml file.",
  finalcut: "Final Cut Pro: File > Import > XML, pick the .fcpxml file.",
};

/**
 * The files to hand an editor for a cut list: the timeline file each chosen editor opens,
 * and a short note on how to open it. Empty when there is nothing to export.
 */
export function editorFiles(list: CutList, editors: EditorId[]): EditorFile[] {
  if (list.timelines.length === 0) return [];
  const chosen = EDITORS.filter((editor) => editors.includes(editor.id));
  const base = safeFileName(list.name);
  const files: EditorFile[] = [];
  const xmlFor = chosen.filter((editor) => editor.file === "xml");
  if (xmlFor.length > 0) {
    files.push({
      name: `${base}.xml`,
      text: fcp7Xml(list),
      editors: xmlFor.map((editor) => editor.name),
    });
  }
  const fcpxmlFor = chosen.filter((editor) => editor.file === "fcpxml");
  if (fcpxmlFor.length > 0) {
    files.push({
      name: `${base}.fcpxml`,
      text: fcpXml(list),
      editors: fcpxmlFor.map((editor) => editor.name),
    });
  }
  if (files.length === 0) return [];

  const recordings = sourcesOf(list).map((source) => fileNameOf(source.url));
  const steps = chosen.flatMap((editor) => (editor.id === "capcut" ? [] : [HOW_TO[editor.id]]));
  files.push({
    name: "How to open.txt",
    editors: [],
    text: [
      `${list.name}: ${list.timelines.length} ${list.timelines.length === 1 ? "timeline" : "timelines"}`,
      "",
      "1. Put these files in one folder with the original recording:",
      ...recordings.map((name) => `   ${name}`),
      "2. Open the timeline in your editor:",
      ...steps.map((step) => `   ${step}`),
      "3. If the editor says the media is offline or missing, point it at that folder once.",
      "",
      "The timeline shows the original recording with every cut as its own piece, so you can",
      "move any cut. Looks added by the automation (blurred background, logo, burned-in",
      "captions) are in the finished clips, not in the timeline.",
      "",
    ].join("\n"),
  });
  return files;
}
