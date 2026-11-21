import { z } from "zod";
import {
  defineStep,
  type FileFacts,
  type MediaFacts,
  type StepDefinition,
  StepSetupError,
} from "./define";
import { drawtextValue } from "./recipes";

/**
 * Editing steps: layouts that put two videos in one frame, a green screen, cards and
 * titles made from the team's brand, and the small jobs that sit around them. Each is one
 * FFmpeg request to /v1/ffmpeg/compose. Several read their files' length, size and sound
 * first (`readsFirst`), so the request fits them exactly instead of guessing.
 */

const ENDPOINT = "/v1/ffmpeg/compose";

type Option = { option: string; argument?: string | number };
const opt = (option: string, argument?: string | number): Option =>
  argument === undefined ? { option } : { option, argument };

const VIDEO_OUT: Option[] = [
  opt("-c:v", "libx264"),
  opt("-preset", "veryfast"),
  opt("-crf", 21),
  opt("-c:a", "aac"),
  opt("-b:a", "192k"),
  opt("-movflags", "+faststart"),
  opt("-f", "mp4"),
];
const PICTURE_OUT: Option[] = [opt("-frames:v", 1), opt("-f", "image2")];

const url = (what: string) => z.string().url().describe(what);
const text = (what: string) => z.string().min(1).max(500).describe(what);
const number = (what: string, min: number, max: number) =>
  z.number().min(min).max(max).describe(what);
const whole = (what: string, min: number, max: number) => number(what, min, max).int();
const choice = <T extends string>(values: readonly [T, ...T[]], what: string) =>
  z.enum(values).describe(what);
// Values that end up inside a filter graph are limited to what cannot break out of it.
const color = z
  .string()
  .regex(/^[A-Za-z]+$|^#[0-9A-Fa-f]{6}$/)
  .describe("A colour name such as white, or a hex value such as #FFCC00");
const font = z
  .string()
  .regex(/^[A-Za-z0-9 ._-]{1,80}$/)
  .describe("A font installed on your toolkit");

/** Rounds down to an even number, which H.264 needs for a width or height. */
const evenDown = (value: number) => Math.max(2, Math.floor(value / 2) * 2);

/** The frame rate to make a video at: the file's own when known and sensible, else 30. */
function rateOf(facts: MediaFacts | undefined): number {
  const fps = facts?.fps;
  return fps && fps >= 10 && fps <= 120 ? Math.round(fps * 1000) / 1000 : 30;
}

/** Seconds as FFmpeg reads them, without a long tail of decimals. */
const seconds = (value: number) => String(Math.round(value * 1000) / 1000);

/** Whether a file is known to have no sound. Unknown counts as having sound. */
const silent = (facts: MediaFacts | undefined) => facts?.hasAudio === false;

function editStep<Shape extends z.ZodRawShape>(args: {
  id: string;
  title: string;
  description: string;
  primaryInput: (keyof Shape & string) | null;
  listInput?: { field: string; itemKey: string };
  brandInputs?: StepDefinition["brandInputs"];
  startInputs?: StepDefinition["startInputs"];
  readsFirst?: (keyof Shape & string)[];
  readsPauses?: (keyof Shape & string)[];
  askFirst?: (keyof Shape & string)[];
  outputLabels?: (blanks: z.output<z.ZodObject<Shape>>, count: number) => string[];
  labelsFollow?: boolean;
  skipsWithout?: keyof Shape & string;
  blanks: Shape;
  toRequest: (blanks: z.output<z.ZodObject<Shape>>, facts: FileFacts) => Record<string, unknown>;
}): StepDefinition {
  return defineStep({
    id: args.id,
    category: "recipe",
    title: args.title,
    description: args.description,
    endpoint: ENDPOINT,
    method: "POST",
    output: "files",
    primaryInput: args.primaryInput,
    listInput: args.listInput,
    brandInputs: args.brandInputs,
    startInputs: args.startInputs,
    readsFirst: args.readsFirst,
    readsPauses: args.readsPauses,
    askFirst: args.askFirst,
    outputLabels: args.outputLabels as StepDefinition["outputLabels"],
    ...(args.labelsFollow ? { labelsFollow: true } : {}),
    ...(args.skipsWithout ? { skipsWithout: args.skipsWithout } : {}),
    input: z.object(args.blanks),
    toRequest: args.toRequest,
  }) as unknown as StepDefinition;
}

/**
 * Splits words into lines of at most `longest` letters, so a card's text wraps instead
 * of running off the edge. A word longer than a line is broken.
 */
export function wrapLines(words: string, longest: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (let word of words.replace(/\s+/g, " ").trim().split(" ")) {
    while (word.length > longest) {
      if (line) lines.push(line);
      lines.push(word.slice(0, longest));
      word = word.slice(longest);
      line = "";
    }
    if (!word) continue;
    if (!line) line = word;
    else if (line.length + 1 + word.length <= longest) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** A file name made readable as a title: no ending, and spaces for dashes and underscores. */
export function titleFromFileName(fileName: string): string {
  return fileName
    .replace(/^.*[\\/]/, "")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * drawtext filters that write `lines` as a centred block. The size follows the picture
 * (`w` and `h`), so the same settings suit a square card and a tall one.
 *   top: where the block's middle sits, as a share of the height (0.5 is the middle).
 */
function textBlock(args: {
  lines: string[];
  font: string;
  color: string;
  /** Most letters on one line, which sets how big the letters can be. */
  longest: number;
  top?: number;
  /** The share of the width the longest line may take. */
  widthShare?: number;
  /** The share of the height the whole block may take. */
  heightShare?: number;
  /** Extra drawtext options, such as a shadow. */
  extra?: string;
}): string[] {
  const { lines } = args;
  const longest = Math.max(args.longest, ...lines.map((line) => line.length), 1);
  // About half a font size per letter, so this many letters fill the width share. The
  // value is quoted in the filter, so its comma needs no escaping.
  const size = `min(w*${args.widthShare ?? 0.86}*1.9/${longest},h*${args.heightShare ?? 0.6}/${
    lines.length * 1.3
  })`;
  const middle = args.top ?? 0.5;
  return lines.map(
    (line, index) =>
      `drawtext=font='${args.font}':text=${drawtextValue(line)}:fontsize='${size}':fontcolor=${
        args.color
      }:x='(w-text_w)/2':y='h*${middle}-${lines.length}*(${size})*1.3/2+${index}*(${size})*1.3'${
        args.extra ?? ""
      }`,
  );
}

const ORDER_CHOICES = ["with the main video", "with the other video"] as const;
const SOUND_CHOICES = ["both", "main video only", "other video only"] as const;

/**
 * The sound of a two-video layout. The video that decides the length goes first, so the
 * mix ends with it; when both lengths are known the output is also cut to that length.
 */
function twoVideoSound(
  sound: (typeof SOUND_CHOICES)[number],
  facts: FileFacts,
  endsWithOther: boolean,
): { filters: string[]; map: Option[]; length: number | undefined } {
  const main = facts.video_url;
  const other = facts.other_video_url;
  const length = (endsWithOther ? other : main)?.duration;
  const wanted = [
    ...(sound !== "other video only" && !silent(main) ? [0] : []),
    ...(sound !== "main video only" && !silent(other) ? [1] : []),
  ];
  if (endsWithOther) wanted.reverse();
  if (wanted.length === 0) return { filters: [], map: [], length };
  if (wanted.length === 1) return { filters: [], map: [opt("-map", `${wanted[0]}:a`)], length };
  return {
    filters: [
      `${wanted.map((index) => `[${index}:a]`).join("")}amix=inputs=2:duration=first:normalize=0[a]`,
    ],
    map: [opt("-map", "[a]")],
    length,
  };
}

/** A picture or video of `w` by `h` that fills the box, cut at the edges rather than squashed. */
const fill = (w: number, h: number) =>
  `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;

/**
 * Two videos in one frame, stacked or side by side. `first` and `second` are the sizes of
 * the main and other video's parts; the divider sits between them.
 */
function splitScreen(
  blanks: {
    video_url: string;
    other_video_url: string;
    divider: number;
    divider_color: string;
    sound: (typeof SOUND_CHOICES)[number];
    ends: (typeof ORDER_CHOICES)[number];
  },
  facts: FileFacts,
  layout: { stack: "vstack" | "hstack"; first: [number, number]; second: [number, number] },
) {
  const endsWithOther = blanks.ends === "with the other video";
  const rate = rateOf(facts.video_url);
  // The video that does not decide the length holds its last frame if it ends first.
  const hold = ",tpad=stop_mode=clone:stop_duration=86400";
  const [w1, h1] = layout.first;
  const [w2, h2] = layout.second;
  const parts = [
    `[0:v]${fill(w1, h1)},fps=${rate}${endsWithOther ? hold : ""}[first]`,
    `[1:v]${fill(w2, h2)},fps=${rate}${endsWithOther ? "" : hold}[second]`,
  ];
  const line =
    blanks.divider > 0
      ? layout.stack === "vstack"
        ? `${w1}x${blanks.divider}`
        : `${blanks.divider}x${h1}`
      : null;
  if (line) parts.push(`color=c=${blanks.divider_color}:s=${line}:r=${rate}[line]`);
  const order = line ? "[first][line][second]" : "[first][second]";
  parts.push(`${order}${layout.stack}=inputs=${line ? 3 : 2}:shortest=1,format=yuv420p[v]`);
  const sound = twoVideoSound(blanks.sound, facts, endsWithOther);
  return {
    inputs: [{ file_url: blanks.video_url }, { file_url: blanks.other_video_url }],
    filters: [...parts, ...sound.filters].map((filter) => ({ filter })),
    outputs: [
      {
        options: [
          opt("-map", "[v]"),
          ...sound.map,
          ...(sound.length ? [opt("-t", seconds(sound.length))] : []),
          ...VIDEO_OUT,
        ],
      },
    ],
  };
}

const twoVideoBlanks = {
  video_url: url("The main video"),
  other_video_url: url("The other video"),
  sound: choice(SOUND_CHOICES, "Whose sound to keep").default("both"),
  ends: choice(
    ORDER_CHOICES,
    "When the finished video ends. The other one holds its last frame if it is shorter.",
  ).default("with the main video"),
};

const PIP_SIZES = { small: 0.25, medium: 0.35, large: 0.45 } as const;
const CORNERS = ["bottom right", "bottom left", "top right", "top left"] as const;

const SHAPES = {
  vertical: [1080, 1920],
  square: [1080, 1080],
  "four by five": [1080, 1350],
  wide: [1920, 1080],
} as const;
const SHAPE_NAMES = Object.keys(SHAPES) as [keyof typeof SHAPES, ...(keyof typeof SHAPES)[]];

const SPEAKER_SIZES = { "full frame": 1, large: 0.8, medium: 0.6, small: 0.45 } as const;

const FORMATS = {
  MP4: { format: "mp4", video: true },
  MOV: { format: "mov", video: true },
  WebM: { format: "webm", video: true },
  MP3: { format: "mp3", video: false },
  WAV: { format: "wav", video: false },
} as const;

/** The pieces other compose steps build with (variants.ts). Not part of the package's API. */
export const composeParts = {
  opt,
  VIDEO_OUT,
  url,
  text,
  number,
  whole,
  choice,
  color,
  font,
  evenDown,
  rateOf,
  seconds,
  silent,
  editStep,
  textBlock,
};

export const editingRecipes: StepDefinition[] = [
  editStep({
    id: "recipe-picture-in-picture",
    title: "Picture in picture",
    description:
      "Plays a second video in a box in one corner of the main one, like a reaction or a face cam. The box has a border in your brand colour. Pick whose sound to keep and which video decides the length.",
    primaryInput: "video_url",
    brandInputs: { border_color: "color" },
    readsFirst: ["video_url", "other_video_url"],
    blanks: {
      ...twoVideoBlanks,
      other_video_url: url("The video in the box"),
      corner: choice(CORNERS, "Which corner the box sits in").default("bottom right"),
      size: choice(
        Object.keys(PIP_SIZES) as ["small", "medium", "large"],
        "How big the box is",
      ).default("medium"),
      border: whole("Border thickness in pixels; 0 for none", 0, 60).default(8),
      border_color: color.default("white"),
    },
    toRequest: (b, facts) => {
      const endsWithOther = b.ends === "with the other video";
      const share = PIP_SIZES[b.size];
      const margin = "trunc(W*0.04)";
      const x = b.corner.endsWith("right") ? `W-w-${margin}` : margin;
      const y = b.corner.startsWith("bottom") ? `H-h-${margin}` : margin;
      const filters = [
        `[0:v]${endsWithOther ? "tpad=stop_mode=clone:stop_duration=86400" : "null"}[main]`,
        // The box is a share of the main video's width and keeps its own shape.
        `[1:v][main]scale2ref=w='trunc(main_w*${share}/2)*2':h='trunc(ow*ih/iw/2)*2'[inset][base]`,
        b.border > 0
          ? `[inset]pad=w=iw+${2 * b.border}:h=ih+${2 * b.border}:x=${b.border}:y=${b.border}:color=${b.border_color}[box]`
          : "[inset]null[box]",
        `[base][box]overlay=x='${x}':y='${y}':${endsWithOther ? "shortest=1" : "eof_action=pass"},setsar=1,format=yuv420p[v]`,
      ];
      const sound = twoVideoSound(b.sound, facts, endsWithOther);
      return {
        inputs: [{ file_url: b.video_url }, { file_url: b.other_video_url }],
        filters: [...filters, ...sound.filters].map((filter) => ({ filter })),
        outputs: [
          {
            options: [
              opt("-map", "[v]"),
              ...sound.map,
              ...(sound.length ? [opt("-t", seconds(sound.length))] : []),
              ...VIDEO_OUT,
            ],
          },
        ],
      };
    },
  }),
  editStep({
    id: "recipe-stack",
    title: "Stack two videos",
    description:
      "Makes a vertical video with the main video on top and another underneath, each filling its half, with a line in your brand colour between them. For reactions, gameplay under a talking head, or before and after.",
    primaryInput: "video_url",
    brandInputs: { divider_color: "color" },
    readsFirst: ["video_url", "other_video_url"],
    blanks: {
      ...twoVideoBlanks,
      other_video_url: url("The video underneath"),
      top_share: whole("How much of the height the top video takes, in percent", 20, 80).default(
        50,
      ),
      divider: whole("Thickness of the line between them in pixels; 0 for none", 0, 60).default(6),
      divider_color: color.default("white"),
    },
    toRequest: (b, facts) => {
      const height = 1920 - b.divider;
      const top = evenDown((height * b.top_share) / 100);
      return splitScreen(b, facts, {
        stack: "vstack",
        first: [1080, top],
        second: [1080, evenDown(height - top)],
      });
    },
  }),
  editStep({
    id: "recipe-side-by-side",
    title: "Side by side",
    description:
      "Makes a wide video with the main video on the left and another on the right, each filling its side, with a line in your brand colour between them.",
    primaryInput: "video_url",
    brandInputs: { divider_color: "color" },
    readsFirst: ["video_url", "other_video_url"],
    blanks: {
      ...twoVideoBlanks,
      other_video_url: url("The video on the right"),
      left_share: whole("How much of the width the left video takes, in percent", 20, 80).default(
        50,
      ),
      divider: whole("Thickness of the line between them in pixels; 0 for none", 0, 60).default(6),
      divider_color: color.default("white"),
    },
    toRequest: (b, facts) => {
      const width = 1920 - b.divider;
      const left = evenDown((width * b.left_share) / 100);
      return splitScreen(b, facts, {
        stack: "hstack",
        first: [left, 1080],
        second: [evenDown(width - left), 1080],
      });
    },
  }),
  editStep({
    id: "recipe-green-screen",
    title: "Green screen over a background",
    description:
      "Takes out the green behind someone filmed in front of a green screen and puts them over a picture, such as a screenshot, a slide or a product page. A tall picture can scroll slowly down behind them.",
    primaryInput: "video_url",
    blanks: {
      video_url: url("The video filmed in front of the green screen"),
      background_url: url("The picture to put behind them"),
      key_color: color.default("#00FF00").describe("The screen's colour, usually #00FF00"),
      similarity: number(
        "How close a colour must be to the screen's to be taken out, from 0.01 to 1. Raise it if green is left behind; lower it if the person starts to vanish.",
        0.01,
        1,
      ).default(0.25),
      softness: number("How soft the edges are, from 0 to 1", 0, 1).default(0.08),
      speaker_size: choice(
        Object.keys(SPEAKER_SIZES) as ["full frame", "large", "medium", "small"],
        "How much of the height the person takes",
      ).default("full frame"),
      speaker_place: choice(["middle", "left", "right"], "Where the person stands").default(
        "middle",
      ),
      scroll: z
        .boolean()
        .default(false)
        .describe("Scroll slowly down a picture that is taller than the video"),
      scroll_speed: whole("How fast it scrolls, in pixels each second", 1, 2000).default(40),
    },
    toRequest: (b) => {
      const share = SPEAKER_SIZES[b.speaker_size];
      const x =
        b.speaker_place === "left"
          ? "trunc(W*0.04)"
          : b.speaker_place === "right"
            ? "W-w-trunc(W*0.04)"
            : "(W-w)/2";
      // The picture covers the whole frame, keeping its shape; whatever is left over is
      // cut at the sides, or scrolled through from the top.
      const cover = `w='if(gt(iw/ih,main_w/main_h),trunc(main_h*iw/ih/2)*2,main_w)':h='if(gt(iw/ih,main_w/main_h),main_h,trunc(main_w*ih/iw/2)*2)'`;
      const backY = b.scroll ? `-min(h-H,t*${b.scroll_speed})` : "(H-h)/2";
      const filters = [
        "[0:v]split[front][size]",
        "[size]drawbox=c=black:t=fill[canvas]",
        `[1:v][front]scale2ref=${cover}[back][person]`,
        `[canvas][back]overlay=x='(W-w)/2':y='${backY}':shortest=1[behind]`,
        `[person]chromakey=color=${b.key_color}:similarity=${b.similarity}:blend=${b.softness}${
          share < 1 ? `,scale=-2:'trunc(ih*${share}/2)*2'` : ""
        }[keyed]`,
        `[behind][keyed]overlay=x='${x}':y='H-h':shortest=1,setsar=1,format=yuv420p[v]`,
      ];
      return {
        inputs: [
          { file_url: b.video_url },
          // A picture repeats for as long as the video plays.
          { file_url: b.background_url, options: [opt("-loop", 1)] },
        ],
        filters: filters.map((filter) => ({ filter })),
        outputs: [{ options: [opt("-map", "[v]"), opt("-map", "0:a?"), ...VIDEO_OUT] }],
      };
    },
  }),
  editStep({
    id: "recipe-quote-card",
    title: "Quote card",
    description:
      'Writes a quote, or any short line, on your card template from Settings, in your font, wrapped to fit. Makes a picture the size of the template. Good for quote posts, "Part 2" cards and covers.',
    primaryInput: null,
    brandInputs: { template_url: "card", font: "font" },
    blanks: {
      template_url: url("The card picture to write on"),
      text: text("The quote or line to write"),
      attribution: z
        .string()
        .max(120)
        .optional()
        .describe("Who said it, written smaller underneath"),
      font: font.default("The Bold Font"),
      text_color: color.default("white"),
      longest_line: whole("Most letters on one line before it wraps", 8, 60).default(22),
    },
    toRequest: (b) => {
      const lines = wrapLines(b.text, b.longest_line);
      const block = textBlock({
        lines,
        font: b.font,
        color: b.text_color,
        longest: b.longest_line,
        top: b.attribution ? 0.46 : 0.5,
        heightShare: 0.55,
      });
      const below = b.attribution?.trim()
        ? [
            `drawtext=font='${b.font}':text=${drawtextValue(`— ${b.attribution.trim()}`)}:fontsize='h*0.032':fontcolor=${b.text_color}@0.85:x='(w-text_w)/2':y='h*0.8'`,
          ]
        : [];
      return {
        inputs: [{ file_url: b.template_url }],
        filters: [{ filter: `[0:v]${[...block, ...below].join(",")}[outv]` }],
        outputs: [{ options: [opt("-map", "[outv]"), ...PICTURE_OUT] }],
      };
    },
  }),
  editStep({
    id: "recipe-video-card",
    title: "Add a card to a video",
    description:
      'Adds a few seconds of your card template from Settings, with a line of text on it, at the end or the start of a video. For "Follow for more", "Part 2 tomorrow" or a title card. The card takes the video\'s size.',
    primaryInput: "video_url",
    brandInputs: { template_url: "card", font: "font" },
    readsFirst: ["video_url"],
    blanks: {
      video_url: url("The video"),
      template_url: url("The card picture"),
      text: text("The line to write on the card"),
      place: choice(["at the end", "at the start"], "Where the card goes").default("at the end"),
      card_seconds: number("How long the card shows, in seconds", 1, 15).default(3),
      font: font.default("The Bold Font"),
      text_color: color.default("white"),
    },
    toRequest: (b, facts) => {
      const video = facts.video_url;
      if (!video?.width || !video.height) {
        throw new StepSetupError(
          "The video's size could not be read, so the card cannot be made to match it.",
        );
      }
      const w = evenDown(video.width);
      const h = evenDown(video.height);
      const rate = rateOf(video);
      const sound = !silent(video);
      const lines = wrapLines(b.text, 24);
      const card = `[1:v]${fill(w, h)},fps=${rate},trim=duration=${b.card_seconds},format=yuv420p,${textBlock(
        { lines, font: b.font, color: b.text_color, longest: 24 },
      ).join(",")}[card]`;
      const main = `[0:v]scale=${w}:${h},setsar=1,fps=${rate},format=yuv420p[main]`;
      const filters = [card, main];
      if (sound) {
        filters.push(
          `anullsrc=r=48000:cl=stereo,atrim=duration=${b.card_seconds}[quiet]`,
          "[0:a]aresample=48000,aformat=channel_layouts=stereo[mainsound]",
        );
      }
      const pieces =
        b.place === "at the end"
          ? sound
            ? "[main][mainsound][card][quiet]"
            : "[main][card]"
          : sound
            ? "[card][quiet][main][mainsound]"
            : "[card][main]";
      filters.push(`${pieces}concat=n=2:v=1:a=${sound ? 1 : 0}${sound ? "[v][a]" : "[v]"}`);
      return {
        inputs: [
          { file_url: b.video_url },
          { file_url: b.template_url, options: [opt("-loop", 1)] },
        ],
        filters: filters.map((filter) => ({ filter })),
        outputs: [
          {
            options: [opt("-map", "[v]"), ...(sound ? [opt("-map", "[a]")] : []), ...VIDEO_OUT],
          },
        ],
      };
    },
  }),
  editStep({
    id: "recipe-title-on-picture",
    title: "Title on a picture",
    description:
      "Writes a title across a band in your brand colour on a picture, such as a frame for a thumbnail, with your logo in the corner. Leave the title empty to use the name of the file that started the run.",
    primaryInput: "image_url",
    brandInputs: { band_color: "color", font: "font", logo_url: "logo" },
    startInputs: { file_name: "file_name" },
    blanks: {
      image_url: url("The picture"),
      title: z
        .string()
        .max(200)
        .optional()
        .describe("The title. Empty uses the name of the file that started the run"),
      file_name: z
        .string()
        .max(500)
        .optional()
        .describe("The name of the file that started the run"),
      place: choice(["bottom", "top", "middle"], "Where the title goes").default("bottom"),
      band_color: color.default("black"),
      text_color: color.default("white"),
      font: font.default("The Bold Font"),
      logo_url: z.string().url().optional().describe("The logo for the corner"),
    },
    toRequest: (b) => {
      const words = b.title?.trim() || titleFromFileName(b.file_name ?? "");
      if (!words) {
        throw new StepSetupError(
          "This step has no title to write. Type one, or start the automation with a file whose name is the title.",
        );
      }
      const lines = wrapLines(words, 28).slice(0, 3);
      const middle = b.place === "top" ? 0.16 : b.place === "middle" ? 0.5 : 0.84;
      const bandHeight = `ih*${(0.1 + lines.length * 0.07).toFixed(2)}`;
      const bandY = `ih*${middle}-${bandHeight}/2`;
      const picture = [
        `drawbox=x=0:y='${bandY}':w=iw:h='${bandHeight}':color=${b.band_color}@0.85:t=fill`,
        ...textBlock({
          lines,
          font: b.font,
          color: b.text_color,
          longest: 28,
          top: middle,
          widthShare: 0.9,
          heightShare: 0.07 * lines.length,
        }),
      ].join(",");
      const logo = b.logo_url;
      const logoY = b.place === "top" ? "H-h-trunc(H*0.04)" : "trunc(H*0.04)";
      const filters = logo
        ? [
            `[0:v]${picture}[titled]`,
            "[1:v][titled]scale2ref=w='trunc(main_w*0.14/2)*2':h='trunc(ow*ih/iw/2)*2'[logo][base]",
            `[base][logo]overlay=x='W-w-trunc(W*0.04)':y='${logoY}'[outv]`,
          ]
        : [`[0:v]${picture}[outv]`];
      return {
        inputs: [{ file_url: b.image_url }, ...(logo ? [{ file_url: logo }] : [])],
        filters: filters.map((filter) => ({ filter })),
        outputs: [{ options: [opt("-map", "[outv]"), ...PICTURE_OUT] }],
      };
    },
  }),
  editStep({
    id: "recipe-frame-choices",
    title: "Frames to choose from",
    description:
      "Saves several frames spread evenly through a video as pictures, so there is a choice of thumbnails. Put Title on a picture after it to make each one a thumbnail.",
    primaryInput: "video_url",
    readsFirst: ["video_url"],
    blanks: {
      video_url: url("The video"),
      count: whole("How many frames", 2, 8).default(4),
    },
    toRequest: (b, facts) => {
      const length = facts.video_url?.duration;
      if (!length) {
        throw new StepSetupError(
          "The video's length could not be read, so the frames cannot be spread through it.",
        );
      }
      return {
        inputs: [{ file_url: b.video_url }],
        filters: [],
        // One picture per output, each from a later point in the video.
        outputs: Array.from({ length: b.count }, (_, index) => ({
          options: [
            opt("-map", "0:v:0"),
            opt("-ss", seconds((length * (index + 1)) / (b.count + 1))),
            ...PICTURE_OUT,
          ],
        })),
      };
    },
  }),
  editStep({
    id: "recipe-fit-to-voiceover",
    title: "Fit a video to a voice-over",
    description:
      "Puts a voice-over on a video and makes the video exactly as long as it: looped, held on its last frame, or sped up or slowed down. The video's own sound is replaced.",
    primaryInput: "audio_url",
    readsFirst: ["audio_url", "video_url"],
    blanks: {
      audio_url: url("The voice-over"),
      video_url: url("The video to fit to it"),
      fit: choice(
        ["loop it", "hold the last frame", "change its speed"],
        "What to do when the video and voice-over are not the same length",
      ).default("loop it"),
    },
    toRequest: (b, facts) => {
      const voice = facts.audio_url?.duration;
      const video = facts.video_url?.duration;
      if (!voice) {
        throw new StepSetupError("The voice-over's length could not be read.");
      }
      if (b.fit !== "loop it" && !video) {
        throw new StepSetupError("The video's length could not be read.");
      }
      const picture =
        b.fit === "hold the last frame"
          ? `tpad=stop_mode=clone:stop_duration=${seconds(Math.max(0, voice - video!) + 1)},`
          : b.fit === "change its speed"
            ? `setpts=${(voice / video!).toFixed(6)}*PTS,`
            : "";
      return {
        inputs: [
          {
            file_url: b.video_url,
            ...(b.fit === "loop it" ? { options: [opt("-stream_loop", -1)] } : {}),
          },
          { file_url: b.audio_url },
        ],
        filters: [{ filter: `[0:v]${picture}setsar=1,format=yuv420p[v]` }],
        outputs: [
          {
            options: [
              opt("-map", "[v]"),
              opt("-map", "1:a"),
              opt("-t", seconds(voice)),
              ...VIDEO_OUT,
            ],
          },
        ],
      };
    },
  }),
  editStep({
    id: "recipe-slideshow",
    title: "Pictures over a voice-over",
    description:
      "Shows pictures one after another over a voice-over or a song, each for an equal share of its length, with a slow zoom on each. With nothing picked it plays over your first music track. Put Captions after it for a captioned video.",
    primaryInput: null,
    listInput: { field: "image_urls", itemKey: "image_url" },
    brandInputs: { audio_url: "music" },
    readsFirst: ["audio_url"],
    blanks: {
      image_urls: z
        .array(z.object({ image_url: z.string().url() }))
        .min(1)
        .max(30)
        .describe("The pictures, in the order they show"),
      audio_url: url("The voice-over or song"),
      shape: choice(SHAPE_NAMES, "The shape of the video").default("vertical"),
      zoom: z.boolean().default(true).describe("Zoom in slowly on each picture"),
    },
    toRequest: (b, facts) => {
      const length = facts.audio_url?.duration;
      if (!length) throw new StepSetupError("The sound's length could not be read.");
      const [w, h] = SHAPES[b.shape];
      const rate = 30;
      const count = b.image_urls.length;
      const frames = Math.max(1, Math.round((length / count) * rate));
      const scenes = b.image_urls.map(
        (_, index) =>
          // Twice the size first, so the zoom moves smoothly instead of in steps.
          `[${index}:v]scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${
            h * 2
          },setsar=1,zoompan=z='${b.zoom ? `1+0.12*on/${frames}` : "1"}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${rate}[s${index}]`,
      );
      const joined = `${b.image_urls.map((_, index) => `[s${index}]`).join("")}concat=n=${count}:v=1:a=0,format=yuv420p[v]`;
      return {
        inputs: [
          ...b.image_urls.map((item) => ({ file_url: item.image_url })),
          { file_url: b.audio_url },
        ],
        filters: [...scenes, joined].map((filter) => ({ filter })),
        outputs: [
          {
            options: [
              opt("-map", "[v]"),
              opt("-map", `${count}:a`),
              opt("-t", seconds(length)),
              ...VIDEO_OUT,
            ],
          },
        ],
      };
    },
  }),
  editStep({
    id: "recipe-intro-outro",
    title: "Add your intro and outro",
    description:
      "Plays your intro before the video and your outro after it, both set once in Settings. Each is fitted to the video's size, with black bars if its shape differs.",
    primaryInput: "video_url",
    brandInputs: { intro_url: "intro", outro_url: "outro" },
    readsFirst: ["video_url", "intro_url", "outro_url"],
    blanks: {
      video_url: url("The video"),
      intro_url: z.string().url().optional().describe("The intro video"),
      outro_url: z.string().url().optional().describe("The outro video"),
    },
    toRequest: (b, facts) => {
      const parts = [
        ...(b.intro_url ? [{ url: b.intro_url, facts: facts.intro_url }] : []),
        { url: b.video_url, facts: facts.video_url },
        ...(b.outro_url ? [{ url: b.outro_url, facts: facts.outro_url }] : []),
      ];
      if (parts.length === 1) {
        throw new StepSetupError("Add an intro or an outro in Settings, under Brand.");
      }
      const main = facts.video_url;
      if (!main?.width || !main.height) {
        throw new StepSetupError("The video's size could not be read.");
      }
      const w = evenDown(main.width);
      const h = evenDown(main.height);
      const rate = rateOf(main);
      const sound = parts.some((part) => !silent(part.facts));
      const filters = parts.map(
        (_, index) =>
          `[${index}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${rate},format=yuv420p[v${index}]`,
      );
      if (sound) {
        parts.forEach((part, index) => {
          if (!silent(part.facts)) {
            filters.push(`[${index}:a]aresample=48000,aformat=channel_layouts=stereo[a${index}]`);
          } else if (part.facts?.duration) {
            filters.push(
              `anullsrc=r=48000:cl=stereo,atrim=duration=${seconds(part.facts.duration)}[a${index}]`,
            );
          } else {
            throw new StepSetupError(
              "One of the videos has no sound and its length could not be read.",
            );
          }
        });
      }
      const pieces = parts.map((_, index) => `[v${index}]${sound ? `[a${index}]` : ""}`).join("");
      filters.push(
        `${pieces}concat=n=${parts.length}:v=1:a=${sound ? 1 : 0}${sound ? "[v][a]" : "[v]"}`,
      );
      return {
        inputs: parts.map((part) => ({ file_url: part.url })),
        filters: filters.map((filter) => ({ filter })),
        outputs: [
          {
            options: [opt("-map", "[v]"), ...(sound ? [opt("-map", "[a]")] : []), ...VIDEO_OUT],
          },
        ],
      };
    },
  }),
  editStep({
    id: "recipe-change-format",
    title: "Change the file type",
    description:
      "Saves a file as another type, such as MOV to MP4 or video to MP3. When the new type can hold the picture and sound as they are, they are copied, which takes seconds instead of minutes.",
    primaryInput: "media_url",
    blanks: {
      media_url: url("The video or audio file"),
      to: choice(
        Object.keys(FORMATS) as ["MP4", "MOV", "WebM", "MP3", "WAV"],
        "The new type",
      ).default("MP4"),
      quick: z
        .boolean()
        .default(true)
        .describe("Copy the picture and sound as they are when the new type can hold them"),
    },
    toRequest: (b) => {
      const target = FORMATS[b.to];
      const options: Option[] =
        b.to === "MP3"
          ? [opt("-vn"), opt("-c:a", "libmp3lame"), opt("-b:a", "192k")]
          : b.to === "WAV"
            ? [opt("-vn"), opt("-c:a", "pcm_s16le")]
            : b.to === "WebM"
              ? [
                  opt("-c:v", "libvpx-vp9"),
                  opt("-crf", 32),
                  opt("-b:v", 0),
                  opt("-deadline", "good"),
                  opt("-cpu-used", 4),
                  opt("-row-mt", 1),
                  opt("-c:a", "libopus"),
                ]
              : b.quick
                ? [opt("-c", "copy")]
                : [
                    opt("-c:v", "libx264"),
                    opt("-preset", "veryfast"),
                    opt("-crf", 21),
                    opt("-c:a", "aac"),
                  ];
      return {
        inputs: [{ file_url: b.media_url }],
        filters: [],
        outputs: [
          {
            options: [
              ...(target.video ? [opt("-map", "0:v:0?"), opt("-map", "0:a:0?")] : []),
              ...options,
              ...(b.to === "MP4" ? [opt("-movflags", "+faststart")] : []),
              opt("-f", target.format),
            ],
          },
        ],
      };
    },
  }),
];
