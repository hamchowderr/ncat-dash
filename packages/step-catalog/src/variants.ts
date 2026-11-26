import { z } from "zod";
import {
  type FileFacts,
  type MediaFacts,
  type Pause,
  type StepDefinition,
  StepSetupError,
} from "./define";
import {
  DISCLOSURE_CHOICES,
  type Disclosure,
  findDisclosure,
  holdsDisclosure,
  KEEP_DISCLOSURE,
  withDisclosure,
} from "./disclosure";
import { composeParts, wrapLines } from "./editing";
import { duckedMix, MUSIC_UNDER_SPEECH } from "./ducking";

/**
 * Variant steps: one finished video made into many to test. Other openings (hooks) and
 * endings (calls to action) swapped onto a base cut, shorter cuts for each ad slot, the
 * same video with different opening lines on screen, and teasers from different parts of
 * a song. All plain FFmpeg through /v1/ffmpeg/compose, on the team's own footage. Cuts
 * land in pauses in speech when the toolkit can read them, so no word is cut in half.
 *
 * Each step names its files with short codes ("h02_c01", "15s"), which later steps add
 * to ("9x16", "captioned"), so a finished ad reads "Boots ad h02_c01_15s_9x16".
 */

const { opt, VIDEO_OUT, url, text, number, whole, choice, color, font } = composeParts;
const { evenDown, rateOf, seconds, silent, editStep, textBlock } = composeParts;

type Option = { option: string; argument?: string | number };

/** A stretch of one input: from `start` to `end` seconds, or all of it when unset. */
export interface Piece {
  input: number;
  start?: number;
  end?: number;
}

/** Two digits, so codes sort: 1 gives "01". */
const two = (value: number) => String(value).padStart(2, "0");

/** Pieces that follow on from each other in the same input become one. */
export function mergePieces(pieces: Piece[]): Piece[] {
  const merged: Piece[] = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.input === piece.input &&
      last.end !== undefined &&
      piece.start !== undefined &&
      Math.abs(last.end - piece.start) < 0.001
    ) {
      merged[merged.length - 1] = { ...last, end: piece.end };
    } else merged.push({ ...piece });
  }
  return merged;
}

/**
 * The point nearest `target` that is in a pause, when one is within `reach` seconds:
 * `target` itself when it is already in one, else the middle of the nearest pause.
 * `target` when no pause is near enough.
 */
export function snapToPause(target: number, pauses: Pause[] | undefined, reach = 1.5): number {
  let best: { at: number; distance: number } | null = null;
  for (const pause of pauses ?? []) {
    if (target >= pause.start && target <= pause.end) return target;
    const distance = target < pause.start ? pause.start - target : target - pause.end;
    if (distance <= reach && (!best || distance < best.distance)) {
      best = { at: (pause.start + pause.end) / 2, distance };
    }
  }
  return best ? best.at : target;
}

/**
 * Where a cut that must end by `target` ends: `target` when it falls in a pause, else
 * just into the last pause that starts within `reach` seconds before it, so the cut ends
 * after a word rather than in one. `target` when there is no such pause.
 */
export function endBefore(target: number, pauses: Pause[] | undefined, reach = 3): number {
  let best: number | null = null;
  for (const pause of pauses ?? []) {
    if (target >= pause.start && target <= pause.end) return target;
    if (pause.start < target && pause.start >= target - reach) {
      best = Math.min(target, pause.start + Math.min(0.25, (pause.end - pause.start) / 2));
    }
  }
  return best ?? target;
}

/** Where speech starts again after the pause nearest `target`, or `target` itself. */
function startAfter(target: number, pauses: Pause[] | undefined, reach = 1.5): number {
  let best: { at: number; distance: number } | null = null;
  for (const pause of pauses ?? []) {
    const distance =
      target < pause.start ? pause.start - target : target > pause.end ? target - pause.end : 0;
    if (distance <= reach && (!best || distance < best.distance)) {
      best = { at: Math.max(pause.start, pause.end - 0.2), distance };
    }
  }
  return best ? best.at : target;
}

/**
 * Builds one compose request that joins pieces of the inputs into several videos at once,
 * each fitted to `size`. Every input is read once and shared between the videos.
 */
export function joinRequest(args: {
  urls: string[];
  facts: (MediaFacts | undefined)[];
  size: [number, number];
  rate: number;
  outputs: Piece[][];
  /** Options for each input, such as how much of it to read. */
  inputOptions?: (Option[] | undefined)[];
  /** Fade the sound out over the last moment of each video. */
  fadeOut?: boolean;
}): Record<string, unknown> {
  const [w, h] = args.size;
  const pieces = args.outputs.map(mergePieces);
  const uses = args.urls.map(() => 0);
  for (const list of pieces) for (const piece of list) uses[piece.input] += 1;
  const lengthOf = (piece: Piece) => {
    const end = piece.end ?? args.facts[piece.input]?.duration;
    return end === undefined ? undefined : end - (piece.start ?? 0);
  };

  const filters: string[] = [];
  const taken = args.urls.map(() => 0);
  args.urls.forEach((_, index) => {
    const count = uses[index];
    if (count === 0) return;
    const names = (kind: string) =>
      Array.from({ length: count }, (__, use) => `[${kind}${index}x${use}]`).join("");
    filters.push(
      `[${index}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${args.rate},format=yuv420p,split=${count}${names("v")}`,
    );
    if (!silent(args.facts[index])) {
      filters.push(
        `[${index}:a]aresample=48000,aformat=channel_layouts=stereo,asplit=${count}${names("a")}`,
      );
    }
  });

  let made = 0;
  const outputs = pieces.map((list, at) => {
    const parts = list.map((piece) => {
      const use = taken[piece.input]++;
      const n = made++;
      const range = [
        ...(piece.start !== undefined ? [`start=${seconds(piece.start)}`] : []),
        ...(piece.end !== undefined ? [`end=${seconds(piece.end)}`] : []),
      ].join(":");
      filters.push(
        `[v${piece.input}x${use}]${range ? `trim=${range},` : ""}setpts=PTS-STARTPTS[p${n}]`,
      );
      if (silent(args.facts[piece.input])) {
        const length = lengthOf(piece);
        if (length === undefined) {
          throw new StepSetupError(
            "One of the videos has no sound and its length could not be read.",
          );
        }
        filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${seconds(length)}[q${n}]`);
      } else {
        filters.push(
          `[a${piece.input}x${use}]${range ? `atrim=${range},` : ""}asetpts=PTS-STARTPTS[q${n}]`,
        );
      }
      return n;
    });
    const total = list.reduce<number | undefined>((sum, piece) => {
      const length = lengthOf(piece);
      return sum === undefined || length === undefined ? undefined : sum + length;
    }, 0);
    const fade = args.fadeOut && total !== undefined && total > 1;
    filters.push(
      `${parts.map((n) => `[p${n}][q${n}]`).join("")}concat=n=${parts.length}:v=1:a=1[o${at}][s${at}${fade ? "raw" : ""}]`,
    );
    if (fade) filters.push(`[s${at}raw]afade=t=out:st=${seconds(total! - 0.3)}:d=0.3[s${at}]`);
    return { options: [opt("-map", `[o${at}]`), opt("-map", `[s${at}]`), ...VIDEO_OUT] };
  });

  return {
    inputs: args.urls.map((file, index) => ({
      file_url: file,
      ...(args.inputOptions?.[index] ? { options: args.inputOptions[index] } : {}),
    })),
    filters: filters.map((filter) => ({ filter })),
    outputs,
  };
}

// Hook and ending variants -----------------------------------------------------------

const HOOK_FIELDS = ["hook_2_url", "hook_3_url", "hook_4_url", "hook_5_url"] as const;
const ENDING_FIELDS = ["ending_2_url", "ending_3_url"] as const;
/** Every hook and ending take, for a base cut that is only the body. */
export const ALL_HOOK_FIELDS = ["hook_1_url", ...HOOK_FIELDS] as const;
export const ALL_ENDING_FIELDS = ["ending_1_url", ...ENDING_FIELDS] as const;

/** What the base cut holds: its own hook and ending, or only the body between them. */
export const BASE_CUTS = ["has its own hook and ending", "is only the body"] as const;
export const BODY_ONLY = BASE_CUTS[1];

const setLinks = (blanks: Record<string, unknown>, fields: readonly string[]) =>
  fields.filter((field) => typeof blanks[field] === "string" && blanks[field] !== "");

/**
 * The hook and ending takes a step uses. With a base cut that has its own hook and ending,
 * takes 2 on are swapped in for them; with a base cut that is only the body, every take
 * goes around it, from take 1.
 */
export function takesOf(blanks: Record<string, unknown>): {
  bodyOnly: boolean;
  hooks: string[];
  endings: string[];
} {
  const bodyOnly = blanks.base_cut === BODY_ONLY;
  return bodyOnly
    ? {
        bodyOnly,
        hooks: setLinks(blanks, ALL_HOOK_FIELDS),
        endings: setLinks(blanks, ALL_ENDING_FIELDS),
      }
    : { bodyOnly, hooks: setLinks(blanks, HOOK_FIELDS), endings: setLinks(blanks, ENDING_FIELDS) };
}

/** How many hooks and endings the step pairs up, counting the base cut's own. */
function pairCounts(blanks: Record<string, unknown>): [number, number] {
  const { bodyOnly, hooks, endings } = takesOf(blanks);
  return bodyOnly
    ? [hooks.length, Math.max(1, endings.length)]
    : [1 + hooks.length, 1 + endings.length];
}

/** The codes of every hook and ending pair, in the order the videos are made. */
export function variantCodes(hooks: number, endings: number): string[] {
  const codes: string[] = [];
  for (let hook = 1; hook <= hooks; hook++) {
    for (let ending = 1; ending <= endings; ending++) codes.push(`h${two(hook)}_c${two(ending)}`);
  }
  return codes;
}

/**
 * Where the base cut's own opening ends and its own ending starts, moved into the nearest
 * pause so a swapped take never starts or stops mid-word. With no other endings, the base
 * runs to its end.
 */
export function variantCuts(args: {
  duration: number;
  openingSeconds: number;
  endingSeconds: number;
  hasOtherEndings: boolean;
  pauses?: Pause[];
}): { openingEnd: number; endingStart: number } {
  const { duration } = args;
  const openingEnd = snapToPause(Math.min(args.openingSeconds, duration), args.pauses);
  const endingStart = args.hasOtherEndings
    ? snapToPause(Math.max(0, duration - args.endingSeconds), args.pauses)
    : duration;
  if (openingEnd < 0.2 || endingStart - openingEnd < 1) {
    throw new StepSetupError(
      "The base cut is too short for an opening and an ending this long. Shorten them in the step's settings.",
    );
  }
  return { openingEnd, endingStart };
}

// Length cuts ------------------------------------------------------------------------

/** "6, 15, 30" as lengths in seconds, without repeats, shortest first. */
export function parseLengths(value: string): number[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((part) => Number.isInteger(part) && part >= 3 && part <= 600),
    ),
  ].sort((a, b) => a - b);
}

/**
 * The stretches of a video that make a cut of at most `target` seconds: its start up to a
 * pause, and with `keepEnding` its last seconds too (the call to action), also from a
 * pause. A video already that short is kept whole.
 */
export function lengthCut(args: {
  duration: number;
  target: number;
  keepEnding: number;
  pauses?: Pause[];
}): { start: number; end: number }[] {
  const { duration, target, pauses } = args;
  if (target >= duration - 0.05) return [{ start: 0, end: duration }];
  if (args.keepEnding > 0 && args.keepEnding <= target - 1) {
    const endingStart = startAfter(duration - args.keepEnding, pauses);
    const room = target - (duration - endingStart);
    if (room >= 1) {
      const end = endBefore(room, pauses);
      if (end >= endingStart) return [{ start: 0, end: duration }];
      return [
        { start: 0, end },
        { start: endingStart, end: duration },
      ];
    }
  }
  return [{ start: 0, end: endBefore(target, pauses) }];
}

/**
 * A length cut that keeps the paid-ad disclosure: the plain cut when it already holds the
 * whole line, else a cut that much shorter with the line put back where it is said.
 */
export function lengthCutKeeping(args: {
  duration: number;
  target: number;
  keepEnding: number;
  pauses?: Pause[];
  disclosure: Disclosure | null;
}): { start: number; end: number }[] {
  const plain = lengthCut(args);
  const { disclosure } = args;
  if (!disclosure) return plain;
  const keep = { input: 0, start: disclosure.start, end: disclosure.end };
  const pieces = plain.map((part) => ({ input: 0, ...part }));
  if (holdsDisclosure(pieces, keep)) return plain;
  const said = disclosure.end - disclosure.start;
  if (said > args.target - 1) {
    throw new StepSetupError(
      `The paid-ad disclosure takes ${Math.ceil(said)} seconds, too long to keep in a ${args.target} second cut. Take ${args.target} out of the lengths, or turn off keeping the disclosure.`,
    );
  }
  const shorter = lengthCut({ ...args, target: args.target - said });
  return mergePieces(
    withDisclosure(
      shorter.map((part) => ({ input: 0, ...part })),
      keep,
      "in order",
    ),
  ).map((piece) => ({ start: piece.start ?? 0, end: piece.end ?? args.duration }));
}

/**
 * Each video with the paid-ad disclosure kept: one that holds none of the lines found in
 * its inputs gets the base cut's line (or the first found) straight after its hook.
 * `found` is the line found in each input, in input order.
 */
export function keepDisclosures(outputs: Piece[][], found: (Disclosure | null)[]): Piece[][] {
  const first = found[0] ? 0 : found.findIndex(Boolean);
  if (first === -1) return outputs;
  const line = found[first]!;
  return outputs.map((pieces) => {
    const holds = found.some(
      (one, input) =>
        one !== null &&
        pieces.some((piece) => piece.input === input) &&
        holdsDisclosure(pieces, { input, start: one.start, end: one.end }),
    );
    if (holds) return pieces;
    return mergePieces(
      withDisclosure(pieces, { input: first, start: line.start, end: line.end }, 1),
    );
  });
}

/** The settings that say whether a step keeps the disclosure, and how it is worded. */
const disclosureBlanks = (keep: boolean) => ({
  disclosure: choice(
    DISCLOSURE_CHOICES,
    "Whether every cut keeps the line where a paid creator says it is an ad, such as \u201cpaid partnership with\u2026\u201d or \u201c#ad\u201d. It is found in what they say, so each video is transcribed first.",
  )
    .default(keep ? KEEP_DISCLOSURE : DISCLOSURE_CHOICES[1])
    .meta({ title: "Paid-ad disclosure" }),
  disclosure_words: z
    .string()
    .max(200)
    .optional()
    .describe(
      "How the creator says it, when they word it their own way, such as \u201cBoots sent me this\u201d",
    )
    .meta({ title: "Disclosure as said" }),
});

/** The disclosure heard in each file setting, in the order given. */
function disclosuresIn(
  facts: FileFacts,
  fields: string[],
  said: string | undefined,
): (Disclosure | null)[] {
  return fields.map((field) => {
    const words = facts[field]?.words;
    return words ? findDisclosure(words, said) : null;
  });
}

// Song teasers -------------------------------------------------------------------------

/** "0:45, 1:30" or "45, 90" as seconds, in the order given. */
export function parseStarts(value: string | undefined): number[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const pieces = part.split(":").map(Number);
      return pieces.reduce((total, piece) => total * 60 + piece, 0);
    })
    .filter((start) => Number.isFinite(start) && start >= 0);
}

/** "from0m45s" for 45 seconds: a code that says where a teaser starts. */
export function startCode(start: number): string {
  const whole = Math.floor(start);
  return `from${Math.floor(whole / 60)}m${two(whole % 60)}s`;
}

const STARTS =
  /^\s*(\d{1,3}(:\d{1,2}){0,2}(\.\d+)?)(\s*,\s*\d{1,3}(:\d{1,2}){0,2}(\.\d+)?){0,5}\s*$/;

const MP3_OUT: Option[] = [
  opt("-vn"),
  opt("-c:a", "libmp3lame"),
  opt("-b:a", "192k"),
  opt("-f", "mp3"),
];

/** Facts of a size known, as an even size and frame rate, or a plain failure. */
function sizeOf(facts: MediaFacts | undefined, what: string): [number, number] {
  if (!facts?.width || !facts.height) {
    throw new StepSetupError(`The ${what}'s size could not be read.`);
  }
  return [evenDown(facts.width), evenDown(facts.height)];
}

const PLACES = { top: 0.24, middle: 0.5 } as const;

/** The file settings Hook And Ending Variants joins, in input order: base, hooks, endings. */
function inputFields(blanks: Record<string, unknown>): string[] {
  const { hooks, endings } = takesOf(blanks);
  return ["video_url", ...hooks, ...endings];
}

/** Hook And Ending Variants' videos, each keeping the disclosure when the step is set to. */
function keepIn(blanks: Record<string, unknown>, facts: FileFacts, outputs: Piece[][]) {
  if (blanks.disclosure !== KEEP_DISCLOSURE) return outputs;
  const said = typeof blanks.disclosure_words === "string" ? blanks.disclosure_words : undefined;
  return keepDisclosures(outputs, disclosuresIn(facts, inputFields(blanks), said));
}

/** The step that lays the team's music under each variant, next to the copy without. */
export const VARIANT_MUSIC_STEP = "recipe-variant-music";
/** The code a variant with music carries, as in "h02_c01_15s_9x16_music". */
export const MUSIC_CODE = "music";

export const variantRecipes: StepDefinition[] = [
  editStep({
    id: "recipe-hook-variants",
    title: "Hook And Ending Variants",
    description:
      "Makes every pairing of openings and endings from one base cut: its own hook, or another hook take in its place, then the same middle, then its own ending, or another call to action. Two other hooks and one other ending give six videos to test, named h01_c01 to h03_c02. Swaps land in a pause, so no word is cut. When the base cut is only the body, each hook take goes in front of it and each ending take after it. A paid creator's disclosure, like \u201cpaid partnership with\u2026\u201d, is found in what they say and kept in every video, even when its hook or ending is swapped out.",
    primaryInput: "video_url",
    readsFirst: ["video_url", ...ALL_HOOK_FIELDS, ...ALL_ENDING_FIELDS],
    readsPauses: ["video_url"],
    // On unless turned off, so a step not yet saved with its defaults keeps it too.
    readsWords: (b) => (b.disclosure === DISCLOSURE_CHOICES[1] ? [] : inputFields(b)),
    askFirst: ["hook_2_url", "hook_3_url", "ending_2_url", "creator"],
    blanks: {
      video_url: url(
        "The base cut, with its own hook at the start and ending at the end, or only the body",
      ).meta({
        title: "Base cut",
      }),
      base_cut: choice(
        BASE_CUTS,
        "Whether the base cut has its own hook and ending, which other takes replace, or is only the body, which every hook take goes in front of",
      ).default(BASE_CUTS[0]),
      hook_1_url: z
        .string()
        .url()
        .optional()
        .describe("The first hook take, used when the base cut is only the body")
        .meta({ title: "Hook take 1" }),
      hook_2_url: z
        .string()
        .url()
        .optional()
        .describe("Another hook take")
        .meta({ title: "Hook take 2" }),
      hook_3_url: z
        .string()
        .url()
        .optional()
        .describe("Another hook take")
        .meta({ title: "Hook take 3" }),
      hook_4_url: z
        .string()
        .url()
        .optional()
        .describe("Another hook take")
        .meta({ title: "Hook take 4" }),
      hook_5_url: z
        .string()
        .url()
        .optional()
        .describe("Another hook take")
        .meta({ title: "Hook take 5" }),
      ending_1_url: z
        .string()
        .url()
        .optional()
        .describe(
          "The first ending take, used when the base cut is only the body. With none, the body's own end closes each video",
        )
        .meta({ title: "Ending take 1" }),
      ending_2_url: z
        .string()
        .url()
        .optional()
        .describe("Another ending, such as a call to action")
        .meta({ title: "Ending take 2" }),
      ending_3_url: z
        .string()
        .url()
        .optional()
        .describe("Another ending, such as a call to action")
        .meta({ title: "Ending take 3" }),
      creator: z
        .string()
        .max(80)
        .optional()
        .describe(
          "Who filmed it. Their files are kept in a folder of their own and named in the ad files list",
        )
        .meta({ title: "Creator" }),
      opening_seconds: number(
        "About how long the base cut's own hook is, in seconds",
        0.5,
        20,
      ).default(3),
      ending_seconds: number(
        "About how long the base cut's own ending is, in seconds",
        0.5,
        30,
      ).default(5),
      ...disclosureBlanks(true),
    },
    outputLabels: (b) => variantCodes(...pairCounts(b)),
    toRequest: (b, facts) => {
      const { bodyOnly, hooks, endings } = takesOf(b);
      const record = b as unknown as Record<string, string>;
      if (bodyOnly) {
        if (hooks.length === 0) {
          throw new StepSetupError(
            "The base cut is only the body, so pick at least one hook take in the step's settings.",
          );
        }
        const base = facts.video_url;
        const size = sizeOf(base, "base cut");
        const urls = [
          b.video_url,
          ...hooks.map((field) => record[field]),
          ...endings.map((field) => record[field]),
        ];
        const factsList = [
          base,
          ...hooks.map((field) => facts[field]),
          ...endings.map((field) => facts[field]),
        ];
        const outputs: Piece[][] = [];
        for (let hook = 1; hook <= hooks.length; hook++) {
          for (let ending = 0; ending < Math.max(1, endings.length); ending++) {
            outputs.push([
              { input: hook },
              { input: 0 },
              ...(endings.length === 0 ? [] : [{ input: hooks.length + 1 + ending }]),
            ]);
          }
        }
        return joinRequest({
          urls,
          facts: factsList,
          size,
          rate: rateOf(base),
          outputs: keepIn(b, facts, outputs),
        });
      }
      if (hooks.length === 0 && endings.length === 0) {
        throw new StepSetupError(
          "Pick at least one other hook or ending take in the step's settings.",
        );
      }
      const base = facts.video_url;
      const duration = base?.duration;
      if (!duration) throw new StepSetupError("The base cut's length could not be read.");
      const size = sizeOf(base, "base cut");
      const { openingEnd, endingStart } = variantCuts({
        duration,
        openingSeconds: b.opening_seconds,
        endingSeconds: b.ending_seconds,
        hasOtherEndings: endings.length > 0,
        pauses: base?.pauses,
      });
      const urls = [
        b.video_url,
        ...hooks.map((field) => record[field]),
        ...endings.map((field) => record[field]),
      ];
      const factsList = [
        base,
        ...hooks.map((field) => facts[field]),
        ...endings.map((field) => facts[field]),
      ];
      const outputs: Piece[][] = [];
      for (let hook = 0; hook <= hooks.length; hook++) {
        for (let ending = 0; ending <= endings.length; ending++) {
          outputs.push([
            hook === 0 ? { input: 0, start: 0, end: openingEnd } : { input: hook },
            { input: 0, start: openingEnd, end: endingStart },
            ...(endings.length === 0
              ? []
              : [
                  ending === 0
                    ? { input: 0, start: endingStart, end: duration }
                    : { input: hooks.length + ending },
                ]),
          ]);
        }
      }
      return joinRequest({
        urls,
        facts: factsList,
        size,
        rate: rateOf(base),
        outputs: keepIn(b, facts, outputs),
      });
    },
  }),
  editStep({
    id: "recipe-length-cuts",
    title: "Length Cuts",
    description:
      "Cuts one video down to each length you list, such as 6, 15, 30 and 60 seconds for ad slots, teasers and Shorts. Each cut keeps the start and can keep your last few seconds too, like a call to action, and ends in a pause rather than mid-word. A video already that short is kept whole. For ads from paid creators, switch on keeping the disclosure, and every cut keeps the line where they say it is an ad.",
    primaryInput: "video_url",
    readsFirst: ["video_url"],
    readsPauses: ["video_url"],
    readsWords: (b) => (b.disclosure === KEEP_DISCLOSURE ? ["video_url"] : []),
    askFirst: ["lengths"],
    blanks: {
      video_url: url("The video"),
      lengths: z
        .string()
        .regex(/^\s*\d{1,3}(\s*,\s*\d{1,3}){0,5}\s*$/)
        .default("15, 30, 60")
        .describe("The lengths to cut, in seconds, separated by commas (up to six)"),
      creator: z
        .string()
        .max(80)
        .optional()
        .describe(
          "Who filmed it. Their files are kept in a folder of their own and named in the ad files list",
        )
        .meta({ title: "Creator" }),
      ending_seconds: number(
        "Seconds of the ending to keep on every cut, such as a call to action. 0 keeps only the start.",
        0,
        30,
      ).default(0),
      ...disclosureBlanks(false),
    },
    outputLabels: (b) => parseLengths(b.lengths).map((length) => `${length}s`),
    toRequest: (b, facts) => {
      const lengths = parseLengths(b.lengths);
      if (lengths.length === 0) {
        throw new StepSetupError("List at least one length between 3 and 600 seconds.");
      }
      const main = facts.video_url;
      const duration = main?.duration;
      if (!duration) throw new StepSetupError("The video's length could not be read.");
      const [disclosure] =
        b.disclosure === KEEP_DISCLOSURE
          ? disclosuresIn(facts, ["video_url"], b.disclosure_words)
          : [null];
      const outputs = lengths.map((target) =>
        lengthCutKeeping({
          duration,
          target,
          keepEnding: b.ending_seconds,
          pauses: main?.pauses,
          disclosure,
        }).map((part) => ({ input: 0, start: part.start, end: part.end })),
      );
      // Without an ending to keep, only the start of the video needs reading, as far as
      // the disclosure when it is said later.
      const reach =
        b.ending_seconds > 0
          ? null
          : Math.min(duration, Math.max(lengths[lengths.length - 1], disclosure?.end ?? 0) + 1);
      return joinRequest({
        urls: [b.video_url],
        facts: [main],
        size: sizeOf(main, "video"),
        rate: rateOf(main),
        outputs,
        fadeOut: true,
        inputOptions: [
          reach !== null && reach < duration ? [opt("-t", seconds(reach))] : undefined,
        ],
      });
    },
  }),
  editStep({
    id: "recipe-opening-lines",
    title: "Opening Lines To Test",
    description:
      "Makes one copy of a video for each opening line you write, with that line shown big over its first seconds, so you can test which hook stops the scroll. Text sits clear of where TikTok, Reels and Shorts put their buttons. Uses your brand font and colour.",
    primaryInput: "video_url",
    brandInputs: { font: "font", box_color: "color" },
    readsFirst: ["video_url"],
    blanks: {
      video_url: url("The video"),
      line_1: text("An opening line, such as a question or a bold claim"),
      line_2: z.string().max(500).optional().describe("Another opening line"),
      line_3: z.string().max(500).optional().describe("Another opening line"),
      line_4: z.string().max(500).optional().describe("Another opening line"),
      line_5: z.string().max(500).optional().describe("Another opening line"),
      seconds: number("How many seconds each line shows for", 1, 10).default(3),
      place: choice(["top", "middle"], "Where the line sits").default("top"),
      font: font.default("Sans"),
      text_color: color.default("white"),
      box_color: color.default("black"),
    },
    outputLabels: (b) =>
      (["line_1", "line_2", "line_3", "line_4", "line_5"] as const)
        .filter((field) => b[field]?.trim())
        .map((_, index) => `t${two(index + 1)}`),
    toRequest: (b, facts) => {
      const lines = [b.line_1, b.line_2, b.line_3, b.line_4, b.line_5].filter(
        (line): line is string => Boolean(line?.trim()),
      );
      const main = facts.video_url;
      const tall = main?.width && main.height ? main.height > main.width : true;
      const show = `:enable='lt(t,${seconds(b.seconds)})'`;
      const extra = `:box=1:boxcolor=${b.box_color}@0.75:boxborderw=24${show}`;
      const filters = [
        `[0:v]setsar=1,format=yuv420p,split=${lines.length}${lines.map((_, index) => `[in${index}]`).join("")}`,
        ...lines.map(
          (line, index) =>
            `[in${index}]${textBlock({
              lines: wrapLines(line, tall ? 18 : 30),
              font: b.font,
              color: b.text_color,
              longest: tall ? 18 : 30,
              top: PLACES[b.place],
              widthShare: 0.8,
              heightShare: tall ? 0.22 : 0.3,
              extra,
            }).join(",")}[out${index}]`,
        ),
      ];
      return {
        inputs: [{ file_url: b.video_url }],
        filters: filters.map((filter) => ({ filter })),
        outputs: lines.map((_, index) => ({
          options: [opt("-map", `[out${index}]`), opt("-map", "0:a?"), ...VIDEO_OUT],
        })),
      };
    },
  }),
  editStep({
    id: "recipe-song-teasers",
    title: "Song Teasers",
    description:
      "Cuts short teasers from different parts of a song or music video, each starting where you say (or spread through it), with a soft fade in and out. Test which part pulls people in: the drop, the chorus or the first verse. A song comes back as MP3s and a music video as videos.",
    primaryInput: "media_url",
    readsFirst: ["media_url"],
    blanks: {
      media_url: url("The song or music video"),
      starts: z
        .string()
        .regex(STARTS)
        .optional()
        .describe(
          "Where each teaser starts, such as 0:45, 1:30 (up to six). Leave empty to spread them through it.",
        ),
      count: whole("How many teasers, when no starts are given", 1, 6).default(3),
      length: number("How long each teaser is, in seconds", 5, 90).default(15),
    },
    outputLabels: (b) => {
      const starts = parseStarts(b.starts);
      return starts.length > 0
        ? starts.map(startCode)
        : Array.from({ length: b.count }, (_, index) => `p${two(index + 1)}`);
    },
    toRequest: (b, facts) => {
      const song = facts.media_url;
      const duration = song?.duration;
      if (!duration) throw new StepSetupError("The song's length could not be read.");
      const given = parseStarts(b.starts);
      const length = Math.min(b.length, duration);
      const starts = (
        given.length > 0
          ? given
          : Array.from(
              { length: b.count },
              (_, index) => (duration * (index + 1)) / (b.count + 1) - length / 2,
            )
      ).map((start) => Math.max(0, Math.min(start, duration - length)));
      const video = song?.hasVideo === true;
      const fadeOut = Math.min(1, length / 4);
      const sound = (start: number, index: number) =>
        `[a${index}]atrim=start=${seconds(start)}:end=${seconds(start + length)},asetpts=PTS-STARTPTS,afade=t=in:d=0.3,afade=t=out:st=${seconds(length - fadeOut)}:d=${seconds(fadeOut)}[s${index}]`;
      const filters = [
        `[0:a]asplit=${starts.length}${starts.map((_, index) => `[a${index}]`).join("")}`,
        ...starts.map(sound),
        ...(video
          ? [
              `[0:v]setsar=1,format=yuv420p,split=${starts.length}${starts.map((_, index) => `[v${index}]`).join("")}`,
              ...starts.map(
                (start, index) =>
                  `[v${index}]trim=start=${seconds(start)}:end=${seconds(start + length)},setpts=PTS-STARTPTS,fade=t=in:d=0.3,fade=t=out:st=${seconds(length - fadeOut)}:d=${seconds(fadeOut)}[o${index}]`,
              ),
            ]
          : []),
      ];
      return {
        inputs: [{ file_url: b.media_url }],
        filters: filters.map((filter) => ({ filter })),
        outputs: starts.map((_, index) => ({
          options: video
            ? [opt("-map", `[o${index}]`), opt("-map", `[s${index}]`), ...VIDEO_OUT]
            : [opt("-map", `[s${index}]`), ...MP3_OUT],
        })),
      };
    },
  }),
  editStep({
    id: VARIANT_MUSIC_STEP,
    title: "Music Under Each Variant",
    description:
      "Lays your team's background music from Settings under each video, looped to its length, dipping while someone talks and faded out at the end, so every ad variant comes as a copy with music next to the one without. Upload the copy without music where the platform wants its own cleared sounds, such as TikTok's Commercial Music Library or Meta's Sound Collection. Until your team adds background music in Settings it is passed over and only the copies without music are made.",
    primaryInput: "video_url",
    brandInputs: { music_url: "music" },
    readsFirst: ["video_url"],
    skipsWithout: "music_url",
    labelsFollow: true,
    blanks: {
      video_url: url("The video"),
      music_url: z
        .string()
        .url()
        .optional()
        .describe("The music track. Left empty, your team's background music from Settings"),
      music_volume: number(
        "Loudness of the music where nobody talks (1 is the track as it is)",
        0,
        2,
      ).default(0.25),
      music_under_speech: z
        .enum(MUSIC_UNDER_SPEECH)
        .describe("Whether the music dips while someone talks")
        .default("dips while someone talks"),
    },
    outputLabels: () => [MUSIC_CODE],
    toRequest: (b, facts) => {
      if (!b.music_url) {
        throw new StepSetupError("Add background music in Settings, under Brand.");
      }
      const main = facts.video_url;
      const duration = main?.duration;
      if (!duration) throw new StepSetupError("The video's length could not be read.");
      const fade = Math.min(1.5, duration / 4);
      // Looped to the video's length, so a short track never stops halfway through an ad.
      const music = `[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=${silent(main) ? 1 : b.music_volume},atrim=duration=${seconds(duration)},asetpts=PTS-STARTPTS,afade=t=in:d=${seconds(Math.min(0.5, duration / 4))},afade=t=out:st=${seconds(duration - fade)}:d=${seconds(fade)}[music]`;
      const filters = silent(main)
        ? [music]
        : [
            music,
            "[0:a]aresample=48000,aformat=channel_layouts=stereo[voice]",
            // The video's own length, and the voice left as loud as it was.
            ...(b.music_under_speech === "stays at one level"
              ? ["[voice][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mixed]"]
              : duckedMix("voice", "music", "mixed")),
          ];
      return {
        inputs: [
          { file_url: b.video_url },
          { file_url: b.music_url, options: [opt("-stream_loop", -1)] },
        ],
        filters: filters.map((filter) => ({ filter })),
        outputs: [
          {
            options: [
              opt("-map", "0:v"),
              opt("-map", silent(main) ? "[music]" : "[mixed]"),
              // The picture is left as it is; only the sound is made again.
              opt("-c:v", "copy"),
              opt("-c:a", "aac"),
              opt("-b:a", "192k"),
              opt("-t", seconds(duration)),
              opt("-movflags", "+faststart"),
              opt("-f", "mp4"),
            ],
          },
        ],
      };
    },
  }),
];
