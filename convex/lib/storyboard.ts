/**
 * The storyboard of a project: its chapters, and a take for every line, each with the scene
 * it is shown in and what goes into it. These rules are shared by the backend and the
 * screens, so both read a take the same way.
 */

/** How a line is shown on screen. */
export const SCENES = [
  { scene: "full", label: "Full Screen", hint: "You, filling the frame" },
  { scene: "panel", label: "Panel", hint: "You boxed to one side, points beside you" },
  { scene: "centre", label: "Centre", hint: "You in the middle, a side each for a comparison" },
  { scene: "graphic", label: "Full Graphic", hint: "Only the graphic, no camera" },
  { scene: "circle", label: "Circle", hint: "A small circle of you over the graphic" },
] as const;
export type Scene = (typeof SCENES)[number]["scene"];

/** What goes into a take. A take can need more than one. */
export const PARTS = [
  { part: "you", label: "You", missing: "Waiting for your take", filled: "Take in" },
  { part: "graphic", label: "Graphic", missing: "Needs a graphic", filled: "Graphic ready" },
  { part: "recording", label: "Page recording", missing: "To record", filled: "Recorded" },
  { part: "screen", label: "Your screen", missing: "Needs your screen", filled: "Screen added" },
] as const;
export type Part = (typeof PARTS)[number]["part"];

/** Which missing part a take's status names first: what only the person can make. */
const FIRST_MISSING: Part[] = ["screen", "you", "recording", "graphic"];

export const ASPECTS = ["16:9", "9:16", "1:1", "4:5"] as const;
export type Aspect = (typeof ASPECTS)[number];

export const LIMITS = {
  chapters: 60,
  takes: 400,
  line: 2000,
  title: 120,
  source: 200,
  cuts: 20,
  cutText: 120,
  script: 400_000,
};

/** Words a person says in a second, for a rough length. */
const WORDS_PER_SECOND = 2.5;

export type TakeFiles = Partial<Record<Part, string>>;

export type TakeStatus = {
  label: string;
  /** "done" when every part is in, "waiting" while one only the person can make is missing. */
  tone: "done" | "waiting" | "todo";
  missing: Part[];
};

export const sceneLabel = (scene: Scene) =>
  SCENES.find((entry) => entry.scene === scene)?.label ?? "Full Screen";
export const partLabel = (part: Part) => PARTS.find((entry) => entry.part === part)?.label ?? part;

/** Keeps the parts in their usual order, each once. */
export function cleanParts(parts: readonly string[]): Part[] {
  const known = PARTS.map((entry) => entry.part) as Part[];
  const picked = known.filter((part) => parts.includes(part));
  return picked.length > 0 ? picked : ["you"];
}

/** Where a take stands, from the parts it needs and the files it has. */
export function statusOf(parts: readonly Part[], files: TakeFiles): TakeStatus {
  const missing = FIRST_MISSING.filter((part) => parts.includes(part) && !files[part]);
  if (missing.length === 0) {
    const label =
      parts.length === 1 ? PARTS.find((entry) => entry.part === parts[0])!.filled : "Ready";
    return { label, tone: "done", missing };
  }
  const first = PARTS.find((entry) => entry.part === missing[0])!;
  const yours = missing[0] === "you" || missing[0] === "screen";
  return { label: first.missing, tone: yours ? "waiting" : "todo", missing };
}

export function wordsIn(line: string): number {
  return line.split(/\s+/).filter(Boolean).length;
}

/** About how long a set of lines takes to say, in seconds. */
export function secondsFor(lines: readonly string[]): number {
  const words = lines.reduce((sum, line) => sum + wordsIn(line), 0);
  return Math.round(words / WORDS_PER_SECOND);
}

/** "about 16 min", "about 40 s". */
export function aboutLength(seconds: number): string {
  if (seconds < 60) return `about ${Math.max(1, seconds)} s`;
  return `about ${Math.round(seconds / 60)} min`;
}

/** A counted thing: "1 take", "59 takes". */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export type ScriptTake = { line: string; scene: Scene; parts: Part[] };
export type ScriptChapter = { title: string; takes: ScriptTake[] };
export type Script = { chapters: ScriptChapter[] };

const SCENE_WORDS: Record<string, Scene> = Object.fromEntries(
  SCENES.flatMap(({ scene, label }) => [
    [label.toLowerCase(), scene],
    [scene, scene],
  ]),
) as Record<string, Scene>;
SCENE_WORDS["center"] = "centre";
SCENE_WORDS["full graphic"] = "graphic";
SCENE_WORDS["fullscreen"] = "full";

const PART_WORDS: Record<string, Part> = {
  you: "you",
  take: "you",
  camera: "you",
  graphic: "graphic",
  graphics: "graphic",
  "page recording": "recording",
  recording: "recording",
  walkthrough: "recording",
  "your screen": "screen",
  screen: "screen",
};

/** The scene and parts named in a line's "[Panel · Graphic]" tag, when it has one. */
function readTag(tag: string): { scene?: Scene; parts: Part[]; silent: boolean } {
  let scene: Scene | undefined;
  let silent = false;
  const parts: Part[] = [];
  for (const raw of tag.split(/[·,|/+]| and /)) {
    const word = raw.trim().toLowerCase();
    if (!word) continue;
    if (SCENE_WORDS[word] && !scene) scene = SCENE_WORDS[word];
    else if (PART_WORDS[word]) parts.push(PART_WORDS[word]);
    else if (word === "no voice" || word === "silent") silent = true;
  }
  return { scene, parts, silent };
}

const clip = (text: string, limit: number) => text.trim().replace(/\s+/g, " ").slice(0, limit);

/**
 * Reads a storyboard written as text:
 *
 *     ## Cold open
 *     [Full Screen · You] I've never known how to code.
 *     [Panel · Graphic] This is how the work is set up.
 *
 * A "##" (or "#") line starts a chapter; every other line is a take. Every take is a line
 * you say, so each needs your take; the tag in front adds the scene and anything shown with
 * it (Graphic, Page recording, Your screen), and "No voice" marks one nobody says. A line
 * without a tag is you, full screen. Take numbers in front ("L12", "12.")
 * and list marks are dropped, so a pasted shot list reads as well.
 */
export function readScript(text: string): Script {
  const chapters: ScriptChapter[] = [];
  let current: ScriptChapter | null = null;
  for (const rawLine of text.slice(0, LIMITS.script).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = /^#{1,3}\s+(.*)$/.exec(line);
    if (heading) {
      const title = clip(heading[1].replace(/^(chapter\s+)?\d+[.:)]\s*/i, ""), LIMITS.title);
      current = { title: title || `Chapter ${chapters.length + 1}`, takes: [] };
      chapters.push(current);
      continue;
    }
    let body = line.replace(/^([-*•]|\d+[.)])\s+/, "").replace(/^L\d+[.:)]?\s+/i, "");
    let tag: { scene?: Scene; parts: Part[]; silent: boolean } = { parts: [], silent: false };
    const tagged = /^\[([^\]]*)\]\s*(.*)$/.exec(body);
    if (tagged) {
      tag = readTag(tagged[1]);
      body = tagged[2];
    }
    body = clip(body, LIMITS.line);
    if (!body) continue;
    if (!current) {
      current = { title: "Chapter 1", takes: [] };
      chapters.push(current);
    }
    // Every line is one you say, so each needs your take, unless it is marked "No voice".
    const parts = cleanParts(tag.silent ? tag.parts : ["you", ...tag.parts]);
    current.takes.push({ line: body, scene: tag.scene ?? "full", parts });
  }
  return {
    chapters: chapters
      .filter((chapter) => chapter.takes.length > 0)
      .slice(0, LIMITS.chapters)
      .map((chapter) => ({ ...chapter })),
  };
}

/** The storyboard back as text, in the form `readScript` reads. */
export function writeScript(script: Script): string {
  return script.chapters
    .map((chapter) =>
      [
        `## ${chapter.title}`,
        ...chapter.takes.map(
          (take) =>
            `[${[
              sceneLabel(take.scene),
              ...take.parts.map(partLabel),
              ...(take.parts.includes("you") ? [] : ["No voice"]),
            ].join(" · ")}] ${take.line}`,
        ),
      ].join("\n"),
    )
    .join("\n\n");
}

/** Every take counted across the chapters, so take numbers run through the whole video. */
export function takeCount(script: Script): number {
  return script.chapters.reduce((sum, chapter) => sum + chapter.takes.length, 0);
}
