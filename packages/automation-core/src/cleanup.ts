/**
 * Clean Up Pauses And Retakes: the raw recording made ready to edit, by plain rules and
 * no AI. Long pauses are taken down to a short breath (where the toolkit's silence
 * detection heard them), a line said again is kept only as its last take, and when the
 * creator says "hook one", "hook two"… before each opening and "body" before the main
 * part, every hook take comes back as a file of its own.
 *
 * Everything here works on the transcript's words and their timings, and on the pauses
 * the toolkit heard. The cuts are whole video frames, and the sound is cut on the same
 * frames, so picture and voice stay together however many cuts there are.
 */
import { type Word, wordKey } from "./moments";

/** A stretch of the recording, in seconds. */
export interface Range {
  start: number;
  end: number;
}

export const HOOK_MODES = ["said", "count", "none"] as const;
export type HookMode = (typeof HOOK_MODES)[number];
export const MAX_HOOKS = 9;

export interface CleanupSettings {
  /** Pauses longer than this, in seconds, are taken down. */
  cutPausesOver: number;
  /** How much of each long pause is left, in seconds, so speech still breathes. */
  leavePause: number;
  /** Keep only the last take of a line said more than once. */
  retakes: boolean;
  /**
   * How hook takes are found. "said": the creator says "hook one", "hook two"… and "body".
   * "count": the first `hookCount` takes of the recording are hooks. "none": one video.
   */
  hooks: HookMode;
  hookCount: number;
  /** Who filmed it; their files are kept in a folder of their own. */
  creator: string;
}

export const CLEANUP_DEFAULTS: CleanupSettings = {
  cutPausesOver: 0.6,
  leavePause: 0.25,
  retakes: true,
  hooks: "said",
  hookCount: 3,
  creator: "",
};

const clamp = (value: unknown, low: number, high: number, fallback: number) => {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(high, Math.max(low, number));
};

/** The step's settings with every gap filled by its default. */
export function cleanupSettings(input: Record<string, unknown>): CleanupSettings {
  const hooks = HOOK_MODES.includes(input.hooks as HookMode)
    ? (input.hooks as HookMode)
    : CLEANUP_DEFAULTS.hooks;
  const cutPausesOver = clamp(input.cutPausesOver, 0.3, 5, CLEANUP_DEFAULTS.cutPausesOver);
  return {
    cutPausesOver,
    leavePause: clamp(input.leavePause, 0, Math.min(1, cutPausesOver), CLEANUP_DEFAULTS.leavePause),
    retakes: input.retakes !== false,
    hooks,
    hookCount: Math.round(clamp(input.hookCount, 1, MAX_HOOKS, CLEANUP_DEFAULTS.hookCount)),
    creator: typeof input.creator === "string" ? input.creator.trim().slice(0, 80) : "",
  };
}

// Retakes ------------------------------------------------------------------------------

// A gap this long between two words, in seconds, or a mark like a full stop or comma,
// is where a line can start again.
const LINE_GAP = 0.3;
// A take that is started again is at most this many words before the new start.
const MAX_TAKE_WORDS = 40;
// Words heard while starting again, which go when they sit between two takes.
const CUE_WORDS = new Set([
  "sorry",
  "again",
  "redo",
  "scratch",
  "cut",
  "wait",
  "hold",
  "on",
  "oops",
  "okay",
  "ok",
  "um",
  "uh",
  "let",
  "me",
  "try",
  "that",
  "start",
  "over",
  "one",
  "more",
  "time",
  "take",
  "from",
  "the",
  "top",
  "no",
  "so",
]);
const STRONG_CUES = new Set(["sorry", "again", "redo", "scratch", "cut", "oops", "over", "top"]);

/** Whether a new line can start at this word: the first, or after a gap or a mark. */
export function startsLine(words: Word[], index: number): boolean {
  if (index === 0) return true;
  const before = words[index - 1];
  return words[index].start - before.end >= LINE_GAP || /[.!?…,;:]["'”’)]*$/.test(before.text);
}

/** How many words two lines share in a row from their starts. */
function sharedStart(keys: string[], a: number, b: number, limit: number): number {
  let count = 0;
  while (count < limit && a + count < b && b + count < keys.length) {
    if (!keys[a + count] || keys[a + count] !== keys[b + count]) break;
    count++;
  }
  return count;
}

/** Longest run of words two lists have in the same order (not always side by side). */
function common(a: string[], b: string[]): number {
  const row = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : Math.max(row[j], row[j - 1]);
      diagonal = above;
    }
  }
  return row[b.length];
}

/** The end of the line that starts at `from`: the word before the next line start. */
function lineEnd(words: Word[], from: number): number {
  let index = from;
  while (index + 1 < words.length && !startsLine(words, index + 1)) index++;
  return index;
}

export interface Retake {
  /** The words of the take that was dropped, as indexes, first and last. */
  first: number;
  last: number;
}

/**
 * The takes to drop: a line started again (its opening words said again at the start of a
 * later line) or said again in other words (most of its words again, in order, in the
 * line straight after it). The last take is the one kept. Short lines of starting-again
 * words ("sorry, again") between takes go too.
 */
export function findRetakes(words: Word[]): Retake[] {
  const keys = words.map((word) => wordKey(word.text));
  const dropped = new Array<boolean>(words.length).fill(false);
  const starts = words.map((_, index) => startsLine(words, index));
  const found: Retake[] = [];

  for (let next = 1; next < words.length; next++) {
    if (!starts[next] || !keys[next]) continue;
    // The nearest earlier line start that is still kept and that this line repeats.
    for (let take = next - 1; take >= Math.max(0, next - MAX_TAKE_WORDS); take--) {
      if (!starts[take] || dropped[take]) continue;
      const takeLength = next - take;
      const shared = sharedStart(keys, take, next, 3);
      const nextEnd = lineEnd(words, next);
      const restarted = shared >= Math.min(3, takeLength) && shared >= 2;
      // Most of the take's words, in order, said again in the next line.
      const rephrased =
        !restarted &&
        takeLength >= 4 &&
        takeLength <= 25 &&
        lineEnd(words, take) === next - 1 &&
        keys[take] === keys[next] &&
        common(keys.slice(take, next), keys.slice(next, nextEnd + 1)) / takeLength >= 0.7;
      if (restarted || rephrased) {
        for (let index = take; index < next; index++) dropped[index] = true;
        found.push({ first: take, last: next - 1 });
        break;
      }
    }
  }

  // Starting-again words left between a dropped take and the line after it.
  for (let index = 0; index < words.length; index++) {
    if (!starts[index] || dropped[index]) continue;
    const end = lineEnd(words, index);
    const line = keys.slice(index, end + 1).filter(Boolean);
    const afterDrop = index > 0 && dropped[index - 1];
    if (
      afterDrop &&
      line.length > 0 &&
      line.length <= 6 &&
      line.every((key) => CUE_WORDS.has(key)) &&
      line.some((key) => STRONG_CUES.has(key))
    ) {
      for (let at = index; at <= end; at++) dropped[at] = true;
      found.push({ first: index, last: end });
    }
  }
  return found.sort((a, b) => a.first - b.first);
}

// Hook takes ---------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  to: 2,
  too: 2,
  three: 3,
  four: 4,
  for: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
};

function numberOf(key: string | undefined): number | null {
  if (!key) return null;
  if (/^[1-9]$/.test(key)) return Number(key);
  return NUMBER_WORDS[key] ?? null;
}

export interface Marker {
  kind: "hook" | "body";
  /** The marker's own words, which are cut out. */
  first: number;
  last: number;
}

/**
 * Where the creator says which take comes next: "hook one", "hook 2", "hook number three",
 * "second hook", then "body" (or "main part"). Only at the start of a line, so a hook
 * talked about in passing is not a marker.
 */
export function findMarkers(words: Word[]): Marker[] {
  const keys = words.map((word) => wordKey(word.text));
  const markers: Marker[] = [];
  for (let index = 0; index < words.length; index++) {
    if (!startsLine(words, index)) continue;
    const [a, b, c] = [keys[index], keys[index + 1], keys[index + 2]];
    if (a === "hook" && numberOf(b) !== null) {
      markers.push({ kind: "hook", first: index, last: index + 1 });
    } else if (a === "hook" && b === "number" && numberOf(c) !== null) {
      markers.push({ kind: "hook", first: index, last: index + 2 });
    } else if (numberOf(a) !== null && b === "hook" && !/^[1-9]$/.test(a)) {
      markers.push({ kind: "hook", first: index, last: index + 1 });
    } else if (
      (a === "body" || (a === "main" && (b === "part" || b === "body"))) &&
      lineEnd(words, index) - index <= 2
    ) {
      markers.push({ kind: "body", first: index, last: lineEnd(words, index) });
    } else if (a === "the" && b === "body" && lineEnd(words, index) - index <= 2) {
      markers.push({ kind: "body", first: index, last: lineEnd(words, index) });
    }
  }
  return markers;
}

// The plan -----------------------------------------------------------------------------

// Speech is kept from just before its first word to just after its last.
const LEAD = 0.08;
const TAIL = 0.15;
// A gap this long between words counts as a pause even where the silence check heard
// noise (a busy room), so it is taken down too.
const WORD_GAP_PAUSE = 1.5;
// "count" mode: a take ends at a pause at least this long.
const TAKE_GAP = 1;

export interface CleanupPart {
  /** "hook01".."hook09", "body", or null for the one cleaned video. */
  label: string | null;
  /** The stretches kept, in order, in the recording's own time. */
  keep: Range[];
}

export interface CleanupPlan {
  parts: CleanupPart[];
  /** How long the recording was, and how long what is kept runs. */
  before: number;
  after: number;
  /** Long pauses taken down, and the seconds that saved. */
  pauses: number;
  pauseSeconds: number;
  /** Takes dropped, and their seconds. */
  retakes: number;
  retakeSeconds: number;
  /** Hook takes split out. */
  hooks: number;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const total = (ranges: Range[]) => ranges.reduce((sum, range) => sum + range.end - range.start, 0);

/** One section of the recording: its kept words, as runs of word indexes. */
function runsOf(kept: boolean[], first: number, last: number): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  for (let index = first; index <= last + 1; index++) {
    const on = index <= last && kept[index];
    if (on && start < 0) start = index;
    if (!on && start >= 0) {
      runs.push([start, index - 1]);
      start = -1;
    }
  }
  return runs;
}

/**
 * The stretches to keep of one section: each run of kept words, from just before its
 * first word to just after its last, with every long pause inside taken down to
 * `leavePause`. Counts what the pauses saved into `counted`.
 */
function keepOf(
  words: Word[],
  runs: [number, number][],
  pauses: Range[],
  settings: CleanupSettings,
  bounds: Range,
  counted: { pauses: number; seconds: number },
): Range[] {
  const keep: Range[] = [];
  for (const [first, last] of runs) {
    const before = words[first - 1];
    const after = words[last + 1];
    const start = Math.max(bounds.start, before ? before.end : 0, words[first].start - LEAD);
    const end = Math.min(bounds.end, after ? after.start : bounds.end, words[last].end + TAIL);
    if (end - start < 0.05) continue;
    // The long pauses inside this stretch: heard ones, and long gaps between its words.
    const gaps: Range[] = pauses.filter((pause) => pause.end > start && pause.start < end);
    for (let index = first; index < last; index++) {
      const gap = { start: words[index].end, end: words[index + 1].start };
      if (gap.end - gap.start < WORD_GAP_PAUSE) continue;
      if (!gaps.some((pause) => pause.start <= gap.start + 0.1 && pause.end >= gap.end - 0.1)) {
        gaps.push(gap);
      }
    }
    gaps.sort((a, b) => a.start - b.start);
    let from = start;
    for (const gap of gaps) {
      // Never into a word: the cut stays between the words on either side of the pause.
      const wordBefore = [...words.slice(first, last + 1)]
        .reverse()
        .find((word) => word.start < gap.start + 0.05);
      const wordAfter = words.slice(first, last + 1).find((word) => word.end > gap.end - 0.05);
      const low = Math.max(gap.start, wordBefore ? wordBefore.end : start, from);
      const high = Math.min(gap.end, wordAfter ? wordAfter.start : end, end);
      if (high - low <= settings.cutPausesOver) continue;
      const cutFrom = low + settings.leavePause / 2;
      const cutTo = high - settings.leavePause / 2;
      if (cutTo - cutFrom < 0.05) continue;
      if (cutFrom - from > 0.02) keep.push({ start: round3(from), end: round3(cutFrom) });
      counted.pauses += 1;
      counted.seconds += cutTo - cutFrom;
      from = cutTo;
    }
    if (end - from > 0.02) keep.push({ start: round3(from), end: round3(end) });
  }
  return keep;
}

interface Section {
  label: string | null;
  first: number;
  last: number;
}

/**
 * The sections of the recording, as word indexes: the hook takes, then the body, or the
 * whole recording as one. `drop` holds the words that are never kept: the creator saying
 * "hook two" or "body", and anything said before the first hook.
 */
export function sectionsOf(
  words: Word[],
  settings: CleanupSettings,
): { sections: Section[]; drop: number[] } {
  const whole = { sections: [{ label: null, first: 0, last: words.length - 1 }], drop: [] };
  if (settings.hooks === "none" || words.length === 0) return whole;

  if (settings.hooks === "said") {
    const markers = findMarkers(words);
    const hooks = markers.filter((marker) => marker.kind === "hook").slice(0, MAX_HOOKS);
    if (hooks.length === 0) return whole;
    const drop: number[] = [];
    for (const marker of markers) {
      for (let index = marker.first; index <= marker.last; index++) drop.push(index);
    }
    // Whatever was said before the first hook (counting in, "rolling") is not kept.
    for (let index = 0; index < hooks[0].first; index++) drop.push(index);
    const body = markers.find(
      (marker) => marker.kind === "body" && marker.first > hooks[hooks.length - 1].first,
    );
    const sections: Section[] = [];
    hooks.forEach((hook, at) => {
      const nextMarker = markers.find((marker) => marker.first > hook.last);
      let last = nextMarker ? nextMarker.first - 1 : words.length - 1;
      // With no "body" said, the last hook ends at the end of its first sentence.
      if (!nextMarker) {
        let index = hook.last + 1;
        while (
          index < last &&
          !(
            /[.!?…]["'”’)]*$/.test(words[index].text) ||
            words[index + 1].start - words[index].end >= TAKE_GAP
          )
        ) {
          index++;
        }
        last = Math.min(last, index);
      }
      sections.push({
        label: `hook${String(at + 1).padStart(2, "0")}`,
        first: hook.last + 1,
        last,
      });
    });
    const lastHook = sections[sections.length - 1];
    const bodyFirst = body ? body.last + 1 : lastHook.last + 1;
    if (bodyFirst <= words.length - 1) {
      sections.push({ label: "body", first: bodyFirst, last: words.length - 1 });
    }
    return { sections: sections.filter((section) => section.first <= section.last), drop };
  }

  // "count": the first takes, split at long pauses, are the hooks.
  const sections: Section[] = [];
  let first = 0;
  for (let index = 0; index < words.length && sections.length < settings.hookCount; index++) {
    const ends = index + 1 >= words.length || words[index + 1].start - words[index].end >= TAKE_GAP;
    if (ends) {
      sections.push({
        label: `hook${String(sections.length + 1).padStart(2, "0")}`,
        first,
        last: index,
      });
      first = index + 1;
    }
  }
  if (first < words.length) sections.push({ label: "body", first, last: words.length - 1 });
  return sections.length > 1 ? { sections, drop: [] } : whole;
}

/**
 * The whole plan for one recording: what is kept of it, as one cleaned video or as a file
 * per hook take plus the body. `pauses` are what the toolkit's silence detection heard.
 * Retakes are looked for inside each take only, so hook takes that open alike are all kept.
 */
export function planCleanup(args: {
  words: Word[];
  pauses: Range[];
  duration: number;
  settings: CleanupSettings;
}): CleanupPlan {
  const { words, settings, duration } = args;
  const pauses = [...args.pauses].sort((a, b) => a.start - b.start);
  const kept = new Array<boolean>(words.length).fill(true);
  const { sections, drop } = sectionsOf(words, settings);
  for (const index of drop) kept[index] = false;
  let retakes = 0;
  let retakeSeconds = 0;
  if (settings.retakes) {
    for (const section of sections) {
      const own = words.slice(section.first, section.last + 1);
      for (const retake of findRetakes(own)) {
        const first = section.first + retake.first;
        const last = section.first + retake.last;
        for (let index = first; index <= last; index++) kept[index] = false;
        retakes += 1;
        const next = words[last + 1];
        retakeSeconds += (next ? next.start : words[last].end) - words[first].start;
      }
    }
  }
  const counted = { pauses: 0, seconds: 0 };
  const bounds = { start: 0, end: duration };
  const parts: CleanupPart[] = sections
    .map((section) => ({
      label: section.label,
      keep: keepOf(
        words,
        runsOf(kept, section.first, section.last),
        pauses,
        settings,
        bounds,
        counted,
      ),
    }))
    .filter((part) => total(part.keep) >= 0.3);
  const hooks = parts.filter((part) => part.label?.startsWith("hook")).length;
  return {
    parts: hooks > 0 ? parts : parts.map((part) => ({ ...part, label: null })),
    before: round3(duration),
    after: round3(parts.reduce((sum, part) => sum + total(part.keep), 0)),
    pauses: counted.pauses,
    pauseSeconds: round3(counted.seconds),
    retakes,
    retakeSeconds: round3(retakeSeconds),
    hooks,
  };
}

/** "Took out 12 long pauses (18 s) and 2 retakes (9 s). Split out 3 hook takes." */
export function cleanupSentence(
  plan: Pick<CleanupPlan, "pauses" | "pauseSeconds" | "retakes" | "retakeSeconds" | "hooks">,
): string {
  const seconds = (value: number) => `${Math.max(1, Math.round(value))} s`;
  const out: string[] = [];
  if (plan.pauses > 0) {
    out.push(
      `${plan.pauses} long ${plan.pauses === 1 ? "pause" : "pauses"} (${seconds(plan.pauseSeconds)})`,
    );
  }
  if (plan.retakes > 0) {
    out.push(
      `${plan.retakes} ${plan.retakes === 1 ? "retake" : "retakes"} (${seconds(plan.retakeSeconds)})`,
    );
  }
  const took =
    out.length > 0 ? `Took out ${out.join(" and ")}.` : "No long pauses or retakes to take out.";
  return plan.hooks > 0
    ? `${took} Split out ${plan.hooks} hook ${plan.hooks === 1 ? "take" : "takes"} and the body.`
    : took;
}

// The request -------------------------------------------------------------------------

type Option = { option: string; argument?: string | number };
const opt = (option: string, argument?: string | number): Option =>
  argument === undefined ? { option } : { option, argument };

/** A frame rate the sound can be cut on exactly: whole, and a part of 48000. */
export function cutRate(fps: number | undefined): number {
  const whole = Math.round(fps && fps > 0 ? fps : 30);
  for (const rate of [whole, 30, 25, 24]) {
    if (rate >= 10 && rate <= 60 && 48000 % rate === 0) return rate;
  }
  return 30;
}

/**
 * The compose request for one part: the recording read from the part's first kept moment,
 * and only the kept frames passed on, picture and sound cut on the very same frames (the
 * sound by sample number, exactly 48000/rate samples a frame), so they never drift apart.
 */
export function cleanupRequest(
  url: string,
  part: Pick<CleanupPart, "keep">,
  fps: number | undefined,
): Record<string, unknown> {
  const rate = cutRate(fps);
  const from = Math.max(0, part.keep[0]?.start ?? 0);
  const to = part.keep[part.keep.length - 1]?.end ?? from;
  const frames: [number, number][] = [];
  for (const range of part.keep) {
    const first = Math.round((range.start - from) * rate);
    const last = Math.round((range.end - from) * rate) - 1;
    if (last < first) continue;
    const previous = frames[frames.length - 1];
    if (previous && first <= previous[1] + 1) previous[1] = Math.max(previous[1], last);
    else frames.push([first, last]);
  }
  if (frames.length === 0) frames.push([0, 0]);
  const samples = 48000 / rate;
  const count = frames.length;
  const names = (prefix: string) => frames.map((_, index) => `[${prefix}${index}]`).join("");
  // Each kept stretch is trimmed by frame number from the picture and by the matching
  // sample number from the sound (one frame is exactly 48000/rate samples), then joined.
  const video = frames.map(
    ([first, last], index) =>
      `[pv${index}]trim=start_frame=${first}:end_frame=${last + 1},setpts=PTS-STARTPTS[cv${index}]`,
  );
  const audio = frames.map(
    ([first, last], index) =>
      `[pa${index}]atrim=start_sample=${first * samples}:end_sample=${(last + 1) * samples},asetpts=PTS-STARTPTS[ca${index}]`,
  );
  const joined = frames.map((_, index) => `[cv${index}][ca${index}]`).join("");
  return {
    inputs: [
      {
        file_url: url,
        options: [
          ...(from > 0 ? [opt("-ss", round3(from))] : []),
          opt("-t", round3(to - from + 0.5)),
        ],
      },
    ],
    filters: [
      {
        filter: `[0:v]setpts=PTS-STARTPTS,fps=${rate},format=yuv420p,split=${count}${names("pv")}`,
      },
      {
        filter: `[0:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,asplit=${count}${names("pa")}`,
      },
      ...video.map((filter) => ({ filter })),
      ...audio.map((filter) => ({ filter })),
      { filter: `${joined}concat=n=${count}:v=1:a=1[v][a]` },
    ],
    outputs: [
      {
        options: [
          opt("-map", "[v]"),
          opt("-map", "[a]"),
          opt("-c:v", "libx264"),
          opt("-preset", "veryfast"),
          opt("-crf", 20),
          opt("-r", rate),
          opt("-c:a", "aac"),
          opt("-b:a", "192k"),
          opt("-movflags", "+faststart"),
          opt("-f", "mp4"),
        ],
      },
    ],
  };
}

/**
 * The creator a file dropped in a watched folder belongs to: the folder it sits in, one
 * level inside the watched one ("raw-takes/Jane Doe/take 3.mp4" is Jane Doe's). Null for
 * a file straight in the watched folder.
 */
export function creatorFromKey(key: unknown, prefix: string): string | null {
  if (typeof key !== "string") return null;
  const at = key.indexOf(prefix);
  const rest = at < 0 ? null : key.slice(at + prefix.length);
  const parts = (rest ?? "").split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const name = parts[parts.length - 2].trim();
  return name && !/^\.+$/.test(name) ? name.slice(0, 80) : null;
}

/** Whether a file code is one of a cleaned recording's takes: "hook01".."hook09" or "body". */
export function isTakeLabel(label: string | null | undefined): boolean {
  return Boolean(label && /^(hook0[1-9]|body)$/.test(label));
}
