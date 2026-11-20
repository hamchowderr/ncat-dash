/**
 * Motion graphics and sound effects: the pieces the toolkit can draw (its /v1/video/motion),
 * the preset styles a team picks from, the team's Motion settings, and the plain rules
 * that place pieces and sounds on a video from its transcript with no AI.
 *
 * The toolkit draws each piece with plain CSS in HyperFrames and lays it over the video,
 * then mixes the sounds in. Nothing here calls a model: when a team adds "Plan motion
 * graphics" to an automation, the AI's plan is used instead of these rules (aiPlan on the
 * plan step's run step).
 */
import { type Chapter, findQuote, quoteKeys, type Word } from "./moments";

// ---------------------------------------------------------------------------------------
// What the toolkit can draw and play

export const MOTION_PIECE_TYPES = [
  "lower_third",
  "title",
  "keyword",
  "stat",
  "chapter",
  "follow",
  "quote",
  "transition",
  "logo",
] as const;
export type MotionPieceType = (typeof MOTION_PIECE_TYPES)[number];

export const MOTION_SOUNDS = [
  "whoosh",
  "pop",
  "impact",
  "ding",
  "tick",
  "slide",
  "thud",
  "click",
  "riser",
] as const;
export type MotionSound = (typeof MOTION_SOUNDS)[number];

export const MOTION_LOOKS = ["bold", "clean", "editorial", "neon"] as const;
export type MotionLook = (typeof MOTION_LOOKS)[number];

export interface MotionPieceInfo {
  type: MotionPieceType;
  title: string;
  description: string;
  /** Seconds it shows for when nothing else is said. */
  seconds: number;
  sound: MotionSound;
  /** Where it sits, so two pieces in one place never show at once. */
  place: "middle" | "bottom" | "side" | "corner";
}

/** Matches the toolkit's pieces (services/v1/video/motion/pieces.py). */
export const MOTION_PIECES: MotionPieceInfo[] = [
  {
    type: "lower_third",
    title: "Name lower third",
    description: "The speaker's name and role slide in at the bottom the first time they talk.",
    seconds: 4,
    sound: "slide",
    place: "bottom",
  },
  {
    type: "title",
    title: "Title card",
    description: "A big title over the opening seconds, with a small line above it.",
    seconds: 2.8,
    sound: "impact",
    place: "middle",
  },
  {
    type: "keyword",
    title: "Keyword slam",
    description: "One word or a short phrase slams onto the screen as it is said.",
    seconds: 1.2,
    sound: "pop",
    place: "middle",
  },
  {
    type: "stat",
    title: "Stat card",
    description: "A number that is said, with what it counts. Plain numbers count up.",
    seconds: 3,
    sound: "ding",
    place: "side",
  },
  {
    type: "chapter",
    title: "Chapter card",
    description: "A band with the chapter's name wipes across as each chapter starts.",
    seconds: 2.4,
    sound: "whoosh",
    place: "middle",
  },
  {
    type: "follow",
    title: "Follow card",
    description: "Your handle and a follow button pop up near the end.",
    seconds: 4,
    sound: "pop",
    place: "bottom",
  },
  {
    type: "quote",
    title: "Quote card",
    description: "A line worth repeating, shown as a quote with who said it.",
    seconds: 4.5,
    sound: "thud",
    place: "middle",
  },
  {
    type: "transition",
    title: "Transition",
    description: "A quick wipe in your brand colour between parts.",
    seconds: 0.7,
    sound: "whoosh",
    place: "middle",
  },
  {
    type: "logo",
    title: "Logo",
    description: "Your logo in the corner, at the start or the end.",
    seconds: 3,
    sound: "ding",
    place: "corner",
  },
];

export const pieceInfo = (type: MotionPieceType): MotionPieceInfo =>
  MOTION_PIECES.find((piece) => piece.type === type)!;

export const SOUND_LABELS: Record<MotionSound, string> = {
  whoosh: "Whoosh",
  pop: "Pop",
  impact: "Impact",
  ding: "Ding",
  tick: "Tick",
  slide: "Slide",
  thud: "Thud",
  click: "Click",
  riser: "Riser",
};

export const LOOK_LABELS: Record<MotionLook, string> = {
  bold: "Bold",
  clean: "Clean",
  editorial: "Editorial",
  neon: "Neon",
};

// ---------------------------------------------------------------------------------------
// Presets and the team's Motion settings

export const MOTION_BUSY = ["light", "medium", "busy"] as const;
export type MotionBusy = (typeof MOTION_BUSY)[number];
export const BUSY_LABELS: Record<MotionBusy, string> = {
  light: "Light",
  medium: "Medium",
  busy: "Busy",
};

export const SOUND_LEVELS = ["off", "light", "heavy"] as const;
export type SoundLevel = (typeof SOUND_LEVELS)[number];
export const SOUND_LEVEL_LABELS: Record<SoundLevel, string> = {
  off: "Off",
  light: "Light",
  heavy: "Heavy",
};

export const OPENINGS = ["title", "logo", "none"] as const;
export type MotionOpening = (typeof OPENINGS)[number];
export const OPENING_LABELS: Record<MotionOpening, string> = {
  title: "Title card",
  logo: "Logo",
  none: "Plain start",
};

export const ENDINGS = ["follow", "logo", "none"] as const;
export type MotionEnding = (typeof ENDINGS)[number];
export const ENDING_LABELS: Record<MotionEnding, string> = {
  follow: "Follow card",
  logo: "Logo",
  none: "Nothing",
};

export const PRESET_GROUPS = [
  "Bold",
  "Business",
  "Educational",
  "Entertainment",
  "Lifestyle",
  "Minimal",
  "Motivation",
  "Polished",
] as const;
export type PresetGroup = (typeof PRESET_GROUPS)[number];

/** A look a team can change after picking it. */
export interface MotionStyle {
  look: MotionLook;
  busy: MotionBusy;
  /** Which pieces are used. */
  pieces: MotionPieceType[];
  opening: MotionOpening;
  ending: MotionEnding;
  sound: SoundLevel;
  /** Whether the AI plan may show things that are typical but not said (a helmet for "gear"). */
  showsUnsaid: boolean;
}

export interface MotionPreset {
  id: string;
  name: string;
  group: PresetGroup;
  /** Best for, in a few words. */
  bestFor: string;
  /** How it plans, for the AI plan step. */
  notes: string;
  style: MotionStyle;
}

const preset = (
  id: string,
  name: string,
  group: PresetGroup,
  bestFor: string,
  notes: string,
  style: MotionStyle,
): MotionPreset => ({ id, name, group, bestFor, notes, style });

const ALL_TEXT: MotionPieceType[] = [
  "lower_third",
  "title",
  "keyword",
  "stat",
  "chapter",
  "follow",
];

/** The 18 preset styles from the Motion Graphics Options doc. Names avoid real people. */
export const MOTION_PRESETS: MotionPreset[] = [
  preset(
    "bold-hook",
    "Bold Hook",
    "Bold",
    "Coaching, business and sales clips",
    "A beat every 3 to 5 seconds. Slam the key words, show every number said.",
    {
      look: "bold",
      busy: "busy",
      pieces: ALL_TEXT,
      opening: "title",
      ending: "follow",
      sound: "heavy",
      showsUnsaid: false,
    },
  ),
  preset(
    "big-word",
    "Big Word",
    "Entertainment",
    "Challenges, entertainment and hooks",
    "A beat every 2 to 3 seconds. Big single words, big numbers.",
    {
      look: "bold",
      busy: "busy",
      pieces: ["keyword", "stat", "title", "follow", "transition"],
      opening: "title",
      ending: "follow",
      sound: "heavy",
      showsUnsaid: false,
    },
  ),
  preset(
    "explainer",
    "Explainer",
    "Educational",
    "Education, news and how it works",
    "A graphic every 8 to 10 seconds: names, numbers, chapters and quotes.",
    {
      look: "clean",
      busy: "medium",
      pieces: ["lower_third", "title", "stat", "chapter", "quote", "follow"],
      opening: "title",
      ending: "follow",
      sound: "light",
      showsUnsaid: true,
    },
  ),
  preset(
    "clean-talking-head",
    "Clean Talking Head",
    "Minimal",
    "Advice and opinion when your face is the brand",
    "Name once, follow card at the end, nothing else.",
    {
      look: "clean",
      busy: "light",
      pieces: ["lower_third", "follow"],
      opening: "none",
      ending: "follow",
      sound: "light",
      showsUnsaid: false,
    },
  ),
  preset(
    "podcast-clip",
    "Podcast Clip",
    "Entertainment",
    "Interviews and podcasts",
    "Speaker names, the episode title and a follow card.",
    {
      look: "bold",
      busy: "light",
      pieces: ["lower_third", "title", "quote", "follow"],
      opening: "title",
      ending: "follow",
      sound: "light",
      showsUnsaid: false,
    },
  ),
  preset(
    "split-explain",
    "Split Explain",
    "Educational",
    "News, commentary and reactions",
    "Show what is talked about every 4 to 6 seconds.",
    {
      look: "clean",
      busy: "busy",
      pieces: ["stat", "keyword", "chapter", "quote", "follow"],
      opening: "title",
      ending: "follow",
      sound: "light",
      showsUnsaid: true,
    },
  ),
  preset(
    "documentary",
    "Documentary",
    "Polished",
    "Stories, interviews and field footage",
    "Few words on screen: names, places and dates only.",
    {
      look: "editorial",
      busy: "light",
      pieces: ["lower_third", "title", "chapter"],
      opening: "title",
      ending: "none",
      sound: "light",
      showsUnsaid: false,
    },
  ),
  preset(
    "tutorial",
    "Tutorial",
    "Educational",
    "Software demos and how-tos",
    "A card at each step and each chapter.",
    {
      look: "clean",
      busy: "medium",
      pieces: ["title", "chapter", "keyword", "follow"],
      opening: "title",
      ending: "follow",
      sound: "light",
      showsUnsaid: false,
    },
  ),
  preset(
    "calm-creator",
    "Calm Creator",
    "Educational",
    "Productivity and learning channels",
    "Tidy and calm: chapters, a few numbers, a quote.",
    {
      look: "editorial",
      busy: "medium",
      pieces: ["lower_third", "title", "stat", "chapter", "quote"],
      opening: "title",
      ending: "follow",
      sound: "light",
      showsUnsaid: true,
    },
  ),
  preset(
    "premium-cinematic",
    "Premium Cinematic",
    "Polished",
    "High-end personal brands",
    "Few words on screen, big type, cuts on the music.",
    {
      look: "editorial",
      busy: "light",
      pieces: ["title", "quote", "transition"],
      opening: "title",
      ending: "logo",
      sound: "light",
      showsUnsaid: false,
    },
  ),
  preset(
    "cinematic",
    "Cinematic",
    "Polished",
    "Wedding, travel and brand films",
    "Almost no text: a title and the logo.",
    {
      look: "editorial",
      busy: "light",
      pieces: ["title", "transition", "logo"],
      opening: "title",
      ending: "logo",
      sound: "off",
      showsUnsaid: false,
    },
  ),
  preset(
    "soft-lifestyle",
    "Soft Lifestyle",
    "Lifestyle",
    "Beauty, fashion and get ready with me",
    "Gentle and airy: a title, a few words, the handle.",
    {
      look: "clean",
      busy: "light",
      pieces: ["title", "keyword", "follow"],
      opening: "title",
      ending: "follow",
      sound: "light",
      showsUnsaid: false,
    },
  ),
  preset(
    "hand-drawn",
    "Hand-Drawn",
    "Educational",
    "Teaching and explaining by sketch",
    "Underline what matters, a card at each idea.",
    {
      look: "editorial",
      busy: "medium",
      pieces: ["title", "keyword", "chapter", "quote"],
      opening: "title",
      ending: "follow",
      sound: "light",
      showsUnsaid: true,
    },
  ),
  preset(
    "hype",
    "Hype",
    "Motivation",
    "Sports, gym and gaming",
    "Fast and loud: slams, numbers, transitions.",
    {
      look: "neon",
      busy: "busy",
      pieces: ["keyword", "stat", "title", "transition", "follow"],
      opening: "title",
      ending: "follow",
      sound: "heavy",
      showsUnsaid: false,
    },
  ),
  preset(
    "business-numbers",
    "Business Numbers",
    "Business",
    "Finance and B2B",
    "Every figure said gets a card. Names and chapters too.",
    {
      look: "clean",
      busy: "medium",
      pieces: ["lower_third", "stat", "chapter", "title", "follow"],
      opening: "title",
      ending: "follow",
      sound: "light",
      showsUnsaid: false,
    },
  ),
  preset(
    "editorial",
    "Editorial",
    "Polished",
    "Thought leadership and essays",
    "Magazine type: titles, quotes, chapters.",
    {
      look: "editorial",
      busy: "light",
      pieces: ["title", "quote", "chapter", "lower_third"],
      opening: "title",
      ending: "logo",
      sound: "off",
      showsUnsaid: false,
    },
  ),
  preset(
    "retro",
    "Retro",
    "Entertainment",
    "Nostalgia, music and culture",
    "Playful words and titles with a warm feel.",
    {
      look: "bold",
      busy: "medium",
      pieces: ["title", "keyword", "stat", "follow"],
      opening: "title",
      ending: "follow",
      sound: "light",
      showsUnsaid: false,
    },
  ),
  preset(
    "neon",
    "Neon",
    "Entertainment",
    "Gaming, nightlife and tech",
    "Glowing type on dark: slams and numbers.",
    {
      look: "neon",
      busy: "medium",
      pieces: ["title", "keyword", "stat", "follow", "transition"],
      opening: "title",
      ending: "follow",
      sound: "heavy",
      showsUnsaid: false,
    },
  ),
];

export const DEFAULT_PRESET = "clean-talking-head";

export const getPreset = (id: unknown): MotionPreset | undefined =>
  MOTION_PRESETS.find((one) => one.id === id);

/** The team's Motion settings. */
export interface MotionSetup {
  /** The preset picked, which the style started from. */
  preset: string;
  style: MotionStyle;
  /** Who usually talks, for the name lower third. Empty skips it. */
  hostName: string;
  hostRole: string;
  /** The handle the follow card shows, such as @yourchannel. Empty skips it. */
  handle: string;
  /** The small line under the handle. */
  callToAction: string;
  /** Plain-language rules the AI plan follows, one per line. */
  notes: string;
}

export const NO_MOTION_SETUP: MotionSetup = {
  preset: DEFAULT_PRESET,
  style: getPreset(DEFAULT_PRESET)!.style,
  hostName: "",
  hostRole: "",
  handle: "",
  callToAction: "Follow for more",
  notes: "",
};

export const MAX_MOTION_NOTES = 2000;

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  list.includes(value as T) ? (value as T) : fallback;

/** A team's Motion settings checked and tidied, or what is wrong with them. */
export function tidyMotionSetup(
  input: Omit<Partial<MotionSetup>, "style"> & { style?: Partial<MotionStyle> },
): { ok: true; setup: MotionSetup } | { ok: false; message: string } {
  const base = getPreset(input.preset);
  if (!base) return { ok: false, message: "Pick one of the preset styles." };
  const style: Partial<MotionStyle> = input.style ?? {};
  const pieces = [...new Set(style.pieces ?? base.style.pieces)].filter((piece) =>
    MOTION_PIECE_TYPES.includes(piece),
  );
  const text = (value: unknown, most: number, name: string) => {
    const tidy = typeof value === "string" ? value.trim() : "";
    if (tidy.length > most) throw new Error(`Keep the ${name} under ${most} characters.`);
    return tidy;
  };
  try {
    const handle = text(input.handle, 60, "handle");
    return {
      ok: true,
      setup: {
        preset: base.id,
        style: {
          look: oneOf(MOTION_LOOKS, style.look, base.style.look),
          busy: oneOf(MOTION_BUSY, style.busy, base.style.busy),
          pieces,
          opening: oneOf(OPENINGS, style.opening, base.style.opening),
          ending: oneOf(ENDINGS, style.ending, base.style.ending),
          sound: oneOf(SOUND_LEVELS, style.sound, base.style.sound),
          showsUnsaid:
            typeof style.showsUnsaid === "boolean" ? style.showsUnsaid : base.style.showsUnsaid,
        },
        hostName: text(input.hostName, 60, "name"),
        hostRole: text(input.hostRole, 60, "role"),
        handle: handle && !handle.startsWith("@") && !handle.includes(" ") ? `@${handle}` : handle,
        callToAction: text(input.callToAction, 60, "line under the handle"),
        notes: text(input.notes, MAX_MOTION_NOTES, "notes"),
      },
    };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

/**
 * The setup a step uses: the team's, or with another preset's style when the step picks
 * one ("team" or empty keeps the team's).
 */
export function motionSetupFor(team: MotionSetup, presetId: unknown): MotionSetup {
  const picked = getPreset(presetId);
  if (!picked || picked.id === team.preset) return team;
  return { ...team, preset: picked.id, style: picked.style };
}

/** The setup as a short text for a model or the agent. */
export function motionSetupText(setup: MotionSetup): string {
  const presetName = getPreset(setup.preset)?.name ?? setup.preset;
  const lines = [
    `Motion graphics style: ${presetName} (${LOOK_LABELS[setup.style.look]} look, ${BUSY_LABELS[setup.style.busy].toLowerCase()}).`,
    `Pieces used: ${setup.style.pieces.map((type) => pieceInfo(type).title).join(", ") || "none"}.`,
    `Opening: ${OPENING_LABELS[setup.style.opening]}. Ending: ${ENDING_LABELS[setup.style.ending]}. Sound effects: ${SOUND_LEVEL_LABELS[setup.style.sound]}.`,
  ];
  if (setup.hostName)
    lines.push(`Usual speaker: ${setup.hostName}${setup.hostRole ? `, ${setup.hostRole}` : ""}.`);
  if (setup.handle) lines.push(`Follow card handle: ${setup.handle}.`);
  if (setup.notes) lines.push(`Style notes:\n${setup.notes}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------
// Placing pieces and sounds by rules (no AI)

export interface PlacedPiece {
  type: MotionPieceType;
  start: number;
  duration: number;
  title?: string;
  subtitle?: string;
  image?: string;
  /** A sound other than the piece's own, or null for none. Left out: the piece's own. */
  sound?: MotionSound | null;
}

export interface PlacedSound {
  sound: MotionSound;
  at: number;
  volume?: number;
}

export interface MotionPlan {
  pieces: PlacedPiece[];
  sounds: PlacedSound[];
}

/** Seconds kept between two pieces of the same kind, by how busy the style is. */
export const BUSY_GAP: Record<MotionBusy, number> = { light: 25, medium: 12, busy: 6 };

/** How loud sound effects are, by level. */
export const SOUND_VOLUME: Record<SoundLevel, number> = { off: 0, light: 0.55, heavy: 1 };

export interface RulesInput {
  words: Word[];
  duration: number;
  setup: MotionSetup;
  /** Chapters of this video, when a Chapters step ran before. */
  chapters?: Chapter[];
  /** A title for the opening card, such as the file's name. */
  title?: string;
  /** The team's logo link, for the logo piece. */
  logo?: string;
  /**
   * What a Plan Motion Graphics step placed between the opening and the ending. Given,
   * these take the place of the numbers found by rules.
   */
  beats?: PlacedPiece[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

const NUMBER_WORD = /^([$£€]?)(\d[\d,.]*)(%|k|m|bn|x)?$/i;
const UNITS = new Set([
  "percent",
  "per",
  "cent",
  "million",
  "billion",
  "thousand",
  "hundred",
  "times",
  "k",
]);
const STOP_WORDS = new Set([
  "and",
  "but",
  "so",
  "or",
  "because",
  "the",
  "a",
  "an",
  "to",
  "of",
  "that",
  "which",
  "is",
  "was",
  "it",
]);

const TRAILING_WORDS = new Set([
  "in",
  "on",
  "at",
  "for",
  "with",
  "by",
  "from",
  "this",
  "my",
  "our",
]);

const bare = (text: string) => text.replace(/^[^\p{L}\p{N}$£€]+|[^\p{L}\p{N}%]+$/gu, "");

/** Numbers said in the transcript, each with a few words saying what it counts. */
export function spokenNumbers(words: Word[]): { at: number; figure: string; label: string }[] {
  const found: { at: number; figure: string; label: string }[] = [];
  for (let i = 0; i < words.length; i++) {
    const text = bare(words[i].text);
    const match = NUMBER_WORD.exec(text);
    if (!match) continue;
    const value = Number(match[2].replace(/,/g, ""));
    // A lone small whole number is usually just counting ("2 things"); years read as years.
    if (!Number.isFinite(value)) continue;
    let figure = text;
    let next = i + 1;
    // "40 percent" -> "40%", "3 million" -> "3 million"
    while (next < words.length && UNITS.has(bare(words[next].text).toLowerCase())) {
      const unit = bare(words[next].text).toLowerCase();
      figure += unit === "percent" ? "%" : unit === "per" || unit === "cent" ? "" : ` ${unit}`;
      if (unit === "per" && bare(words[next + 1]?.text ?? "").toLowerCase() === "cent") {
        figure += "%";
        next++;
      }
      next++;
    }
    const label: string[] = [];
    for (let j = next; j < words.length && label.length < 4; j++) {
      const word = bare(words[j].text);
      if (!word) break;
      if (label.length > 0 && STOP_WORDS.has(word.toLowerCase())) break;
      if (/^(19|20)\d\d$/.test(word)) break;
      label.push(word);
      if (/[.,!?;:]$/.test(words[j].text)) break;
    }
    while (label.length > 0 && TRAILING_WORDS.has(label[label.length - 1].toLowerCase()))
      label.pop();
    const isYear = /^(19|20)\d\d$/.test(text) && !match[3] && !match[1];
    const isSmall = value < 10 && !match[1] && !match[3] && figure === text;
    if (isYear || isSmall || label.length === 0) continue;
    found.push({ at: words[i].start, figure: figure.trim(), label: label.join(" ").toLowerCase() });
  }
  return found;
}

/**
 * Places pieces on one video by plain rules, from its words, its chapters and the team's
 * Motion settings. Two pieces never share a place on screen at the same time, and pieces
 * of one kind keep the style's gap between them.
 */
export function planMotionByRules(input: RulesInput): MotionPlan {
  const { words, duration, setup } = input;
  const style = setup.style;
  const on = new Set(style.pieces);
  const pieces: PlacedPiece[] = [];
  const gap = BUSY_GAP[style.busy];

  const free = (start: number, length: number, type: MotionPieceType) => {
    const place = pieceInfo(type).place;
    const end = start + length;
    if (start < 0 || end > duration) return false;
    return pieces.every((other) => {
      if (pieceInfo(other.type).place !== place) return true;
      return end <= other.start || start >= other.start + other.duration;
    });
  };
  const add = (piece: PlacedPiece) => {
    if (!free(piece.start, piece.duration, piece.type)) return false;
    pieces.push({ ...piece, start: round2(piece.start), duration: round2(piece.duration) });
    return true;
  };
  const length = (type: MotionPieceType) => Math.min(pieceInfo(type).seconds, duration);

  // Opening.
  const title = input.title?.trim();
  if (style.opening === "title" && title && on.has("title") && duration >= 4) {
    add({ type: "title", start: 0.2, duration: length("title"), title });
  } else if (style.opening === "logo" && input.logo && duration >= 3) {
    add({ type: "logo", start: 0.2, duration: length("logo"), image: input.logo });
  }

  // The speaker's name, a moment after they first talk.
  if (on.has("lower_third") && setup.hostName && words.length > 0) {
    const at = Math.max(words[0].start + 0.5, 0.5);
    for (const start of [at, at + 3, at + 6]) {
      if (
        add({
          type: "lower_third",
          start,
          duration: length("lower_third"),
          title: setup.hostName,
          subtitle: setup.hostRole || undefined,
        })
      )
        break;
    }
  }

  // A card at each chapter after the first, or a transition when cards are off.
  for (const chapter of (input.chapters ?? []).slice(1)) {
    if (on.has("chapter")) {
      add({
        type: "chapter",
        start: chapter.start,
        duration: length("chapter"),
        title: chapter.title,
      });
    } else if (on.has("transition")) {
      add({
        type: "transition",
        start: Math.max(0, chapter.start - 0.35),
        duration: length("transition"),
      });
    }
  }

  // What the AI plan placed, when there is one.
  for (const beat of input.beats ?? []) {
    if (on.has(beat.type)) add(beat);
  }

  // Numbers that are said.
  if (on.has("stat") && !input.beats) {
    let last = -Infinity;
    for (const number of spokenNumbers(words)) {
      if (number.at - last < gap) continue;
      if (
        add({
          type: "stat",
          start: number.at,
          duration: length("stat"),
          title: number.figure,
          subtitle: number.label,
        })
      ) {
        last = number.at;
      }
    }
  }

  // Ending.
  const endLength = (type: MotionPieceType) =>
    Math.min(pieceInfo(type).seconds, Math.max(0, duration - 0.3));
  if (style.ending === "follow" && on.has("follow") && setup.handle && duration >= 8) {
    const seconds = endLength("follow");
    add({
      type: "follow",
      start: duration - seconds - 0.3,
      duration: seconds,
      title: setup.handle,
      subtitle: setup.callToAction || undefined,
    });
  } else if (style.ending === "logo" && input.logo && duration >= 5) {
    const seconds = endLength("logo");
    add({ type: "logo", start: duration - seconds - 0.3, duration: seconds, image: input.logo });
  }

  pieces.sort((a, b) => a.start - b.start);
  return { pieces, sounds: [] };
}

export interface SoundRulesInput {
  words: Word[];
  duration: number;
  level: Exclude<SoundLevel, "off">;
  chapters?: Chapter[];
}

/**
 * Sound effects on a video with no motion graphics, by plain rules: a hit as it opens, a
 * whoosh at each chapter, a pop on numbers that are said (heavy: every one, light: a few)
 * and a ding as it ends.
 */
export function planSoundsByRules(input: SoundRulesInput): PlacedSound[] {
  const { words, duration, level } = input;
  const sounds: PlacedSound[] = [];
  if (duration <= 0) return sounds;
  if (words.length > 0) sounds.push({ sound: "impact", at: Math.max(0, words[0].start - 0.05) });
  for (const chapter of (input.chapters ?? []).slice(1)) {
    sounds.push({ sound: "whoosh", at: Math.max(0, chapter.start - 0.3) });
  }
  const gap = level === "heavy" ? 1.5 : 10;
  let last = -Infinity;
  for (const number of spokenNumbers(words)) {
    if (number.at - last < gap) continue;
    sounds.push({ sound: "pop", at: number.at });
    last = number.at;
  }
  if (duration > 6) sounds.push({ sound: "ding", at: Math.max(0, duration - 1.2) });
  return sounds
    .filter((one) => one.at < duration)
    .sort((a, b) => a.at - b.at)
    .map((one) => ({ ...one, at: round2(one.at) }));
}

/** The toolkit request (/v1/video/motion) that lays a plan over one video. */
export function motionRequest(
  url: string,
  plan: MotionPlan,
  setup: MotionSetup,
  brand: { color?: string; font?: string },
  options: { level?: SoundLevel; pieceSounds?: boolean } = {},
): Record<string, unknown> {
  const level = options.level ?? setup.style.sound;
  const style: Record<string, string> = { look: setup.style.look };
  if (brand.color && /^#[0-9a-f]{6}$/i.test(brand.color)) style.accent = brand.color;
  if (brand.font && /^[A-Za-z0-9 ._-]{1,60}$/.test(brand.font)) style.font = brand.font;
  return {
    video_url: url,
    pieces: plan.pieces.map((piece) => ({
      type: piece.type,
      start: piece.start,
      duration: piece.duration,
      ...(piece.title ? { title: piece.title.slice(0, 200) } : {}),
      ...(piece.subtitle ? { subtitle: piece.subtitle.slice(0, 200) } : {}),
      ...(piece.image ? { image: piece.image } : {}),
      ...(piece.sound !== undefined ? { sound: piece.sound } : {}),
    })),
    sounds: plan.sounds,
    style,
    sound_volume: SOUND_VOLUME[level],
    piece_sounds: options.pieceSounds ?? true,
  };
}

/** What a motion step placed on one video, kept on its run step for later steps to read. */
export interface PlacedOnSource {
  source: string;
  items: { start: number; end: number; kind: string }[];
}

export function placedFrom(source: string, plan: MotionPlan): PlacedOnSource {
  return {
    source,
    items: plan.pieces.map((piece) => ({
      start: piece.start,
      end: round2(piece.start + piece.duration),
      kind: piece.type,
    })),
  };
}

// ---------------------------------------------------------------------------------------
// The Add Motion Graphics and Add Sound Effects steps

/** "team" keeps the team's style from Settings > Motion; a preset id uses that one. */
export const TEAM_STYLE = "team";
/** "style" plays the sounds the style has; the others set the level for this step. */
export const STYLE_SOUNDS = "style";

export interface MotionStepSettings {
  style: string;
  /** The opening title. Empty uses the name of the file that started the run. */
  title: string;
  sounds: typeof STYLE_SOUNDS | SoundLevel;
}

export function motionStepSettings(input: Record<string, unknown>): MotionStepSettings {
  const style = getPreset(input.style) ? (input.style as string) : TEAM_STYLE;
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 120) : "";
  const sounds = oneOf([STYLE_SOUNDS, ...SOUND_LEVELS] as const, input.sounds, STYLE_SOUNDS);
  return { style, title, sounds };
}

export interface SoundStepSettings {
  /** "team" uses the level in Settings > Motion; a team with sounds off gets light. */
  level: typeof TEAM_STYLE | Exclude<SoundLevel, "off">;
}

export function soundStepSettings(input: Record<string, unknown>): SoundStepSettings {
  return { level: oneOf([TEAM_STYLE, "light", "heavy"] as const, input.level, TEAM_STYLE) };
}

/** The level an Add Sound Effects step plays at. */
export function soundStepLevel(
  team: MotionSetup,
  settings: SoundStepSettings,
): Exclude<SoundLevel, "off"> {
  if (settings.level !== TEAM_STYLE) return settings.level;
  return team.style.sound === "heavy" ? "heavy" : "light";
}

/** The level an Add Motion Graphics step's piece sounds play at. */
export function motionStepLevel(setup: MotionSetup, settings: MotionStepSettings): SoundLevel {
  return settings.sounds === STYLE_SOUNDS ? setup.style.sound : settings.sounds;
}

// ---------------------------------------------------------------------------------------
// The Plan Motion Graphics step (AI)

/** The pieces the AI places between the opening and the ending. */
export const PLANNED_PIECES = ["keyword", "stat", "quote", "chapter", "transition"] as const;
export type PlannedPiece = (typeof PLANNED_PIECES)[number];

/** Most beats the AI is asked for on one video. */
export const MAX_BEATS = 40;

/** What Plan Motion Graphics asks the model for, from the style the motion step uses. */
export interface MotionPlanSettings {
  /** At most this many beats. */
  count: number;
  /** Seconds kept between two beats. */
  gap: number;
  pieces: PlannedPiece[];
  /** Whether a keyword may say what is not said word for word. */
  showsUnsaid: boolean;
  /** Whether each beat should pick its sound. */
  sounds: boolean;
  look: MotionLook;
  /** The team's style notes from Settings > Motion. */
  notes: string;
  /** What the step's own setting asks the beats to favour. */
  lookFor: string;
}

export function motionPlanSettings(
  setup: MotionSetup,
  duration: number,
  input: Record<string, unknown>,
  level: SoundLevel = setup.style.sound,
): MotionPlanSettings {
  const gap = BUSY_GAP[setup.style.busy];
  return {
    count: Math.max(1, Math.min(MAX_BEATS, Math.ceil(duration / gap))),
    gap,
    pieces: PLANNED_PIECES.filter((type) => setup.style.pieces.includes(type)),
    showsUnsaid: setup.style.showsUnsaid,
    sounds: level !== "off",
    look: setup.style.look,
    notes: setup.notes.slice(0, MAX_MOTION_NOTES),
    lookFor: typeof input.lookFor === "string" ? input.lookFor.trim().slice(0, 1000) : "",
  };
}

/** What the model hands back for one beat. */
export interface MotionPick {
  /** The words said as the piece comes in, quoted from the transcript. */
  quote: string;
  piece: string;
  /** What the piece shows: the word, the figure, or the chapter's name. */
  text: string;
  /** The small line under it: what a figure counts. */
  subtitle: string;
  /** A sound from the list, "none", or empty for the piece's own. */
  sound: string;
}

const str = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** The beats in a model answer, keeping only well-formed ones. */
export function motionPicksFrom(answer: unknown): MotionPick[] {
  const list = (answer as { beats?: unknown } | null)?.beats;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      const one = (item ?? {}) as Record<string, unknown>;
      return {
        quote: str(one.quote, 2000),
        piece: str(one.piece, 30),
        text: str(one.text, 120),
        subtitle: str(one.subtitle, 120),
        sound: str(one.sound, 20),
      };
    })
    .filter((pick) => pick.quote !== "")
    .slice(0, MAX_BEATS * 2);
}

/**
 * The plan's beats placed on the words: each quote found word for word (a beat whose
 * quote is not there is dropped and counted), with the pieces the style does not use, and
 * keywords that say what was not said when the style keeps to what is said, left out.
 */
export function motionBeatsFromPicks(
  words: Word[],
  picks: MotionPick[],
  settings: Pick<MotionPlanSettings, "pieces" | "showsUnsaid">,
): { beats: PlacedPiece[]; dropped: number } {
  const beats: PlacedPiece[] = [];
  let dropped = 0;
  for (const pick of picks) {
    const type = pick.piece as PlannedPiece;
    if (!settings.pieces.includes(type)) continue;
    const found = findQuote(words, pick.quote);
    if (!found) {
      dropped++;
      continue;
    }
    const said = words
      .slice(found.first, found.last + 1)
      .map((word) => word.text)
      .join(" ")
      .trim();
    const start = words[found.first].start;
    const info = pieceInfo(type);
    let duration = info.seconds;
    let title = pick.text;
    let subtitle: string | undefined = pick.subtitle || undefined;
    if (type === "quote") {
      // The quote card shows what was said, for as long as it is said.
      title = said.slice(0, 160);
      subtitle = undefined;
      duration = Math.min(8, Math.max(info.seconds, words[found.last].end - start + 1));
    } else if (type === "keyword") {
      if (!title) continue;
      if (!settings.showsUnsaid) {
        const heard = new Set(quoteKeys(said));
        if (!quoteKeys(title).every((key) => heard.has(key))) continue;
      }
      subtitle = undefined;
    } else if (type === "transition") {
      title = "";
      subtitle = undefined;
    } else if (!title) {
      continue;
    }
    const sound =
      pick.sound === "none"
        ? null
        : MOTION_SOUNDS.includes(pick.sound as MotionSound)
          ? (pick.sound as MotionSound)
          : undefined;
    beats.push({
      type,
      start: round2(type === "transition" ? Math.max(0, start - 0.35) : start),
      duration: round2(duration),
      ...(title ? { title } : {}),
      ...(subtitle ? { subtitle } : {}),
      ...(sound !== undefined ? { sound } : {}),
    });
  }
  beats.sort((a, b) => a.start - b.start);
  return { beats, dropped };
}
