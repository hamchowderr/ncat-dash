import { z } from "zod";
import { defineStep, type StepDefinition } from "./define";

/**
 * Recipes: ready-made FFmpeg jobs with a few blanks to fill in. Each one sends a
 * request to /v1/ffmpeg/compose, so nobody has to write a filter graph by hand.
 * They are the compose examples from the NCA Toolkit's Postman collection, with the
 * sample values turned into blanks.
 */

const ENDPOINT = "/v1/ffmpeg/compose";

type Option = { option: string; argument?: string | number };
const opt = (option: string, argument?: string | number): Option =>
  argument === undefined ? { option } : { option, argument };

const X264: Option[] = [
  opt("-c:v", "libx264"),
  opt("-crf", 21),
  opt("-preset", "veryfast"),
  opt("-f", "mp4"),
];
// The toolkit names an image2 output .png, so the picture is left as a PNG.
const STILL: Option[] = [opt("-frames:v", 1), opt("-f", "image2")];

function request(urls: string[], filters: string[], options: Option[]) {
  return {
    inputs: urls.map((file_url) => ({ file_url })),
    filters: filters.map((filter) => ({ filter })),
    outputs: [{ options }],
  };
}

/**
 * Makes any text safe to put in a drawtext filter. FFmpeg reads it three times: as a
 * filter graph, as the filter's options, and as text with %{...} expansions.
 */
export function drawtextValue(text: string): string {
  const expanded = text
    .replace(/[\r\n]+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%");
  const asOption = expanded.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
  return `'${asOption.replace(/'/g, "'\\''")}'`;
}

// Blanks that end up inside a filter graph are limited to what cannot break out of it.
const url = (what: string) => z.string().url().describe(what);
const text = (what: string) => z.string().min(1).max(500).describe(what);
const number = (what: string, min: number, max: number) =>
  z.number().min(min).max(max).describe(what);
const whole = (what: string, min: number, max: number) => number(what, min, max).int();
const color = z
  .string()
  .regex(/^[A-Za-z]+$|^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/)
  .describe("A colour name such as white, or a hex value such as #FFCC00");
const font = z
  .string()
  .regex(/^[A-Za-z0-9 ._-]{1,80}$/)
  .describe("A font installed on your toolkit");

const textBlanks = {
  video_url: url("The video to write on"),
  text: text("The words to show"),
  font: font.default("The Bold Font"),
  font_size: whole("Text size in pixels", 8, 400).default(50),
  font_color: color.default("white"),
};
type TextBlanks = { text: string; font: string; font_size: number; font_color: string };
const CENTRED = "x=(w-text_w)/2:y=(h-text_h)/2";
const drawtext = (b: TextBlanks, extra: string, shown = drawtextValue(b.text)) =>
  `drawtext=font='${b.font}':text=${shown}:fontsize=${b.font_size}:fontcolor=${b.font_color}${extra}`;

/** A recipe that writes text over a video; they differ only in the extra blanks and options. */
function textRecipe<Extra extends z.ZodRawShape>(args: {
  id: string;
  title: string;
  description: string;
  extra: Extra;
  filter: (blanks: TextBlanks & z.output<z.ZodObject<Extra>>) => string;
}): StepDefinition {
  const input = z.object({ ...textBlanks, ...args.extra });
  return defineStep({
    id: args.id,
    category: "recipe",
    title: args.title,
    description: args.description,
    endpoint: ENDPOINT,
    method: "POST",
    output: "files",
    primaryInput: "video_url",
    brandInputs: { font: "font", font_color: "color" },
    input,
    toRequest: (blanks) => {
      const filled = blanks as unknown as { video_url: string } & TextBlanks &
        z.output<z.ZodObject<Extra>>;
      return request([filled.video_url], [args.filter(filled)], X264);
    },
  }) as unknown as StepDefinition;
}

function recipe<Shape extends z.ZodRawShape>(args: {
  id: string;
  title: string;
  description: string;
  primaryInput: (keyof Shape & string) | null;
  listInput?: { field: string; itemKey: string };
  brandInputs?: StepDefinition["brandInputs"];
  blanks: Shape;
  toRequest: (blanks: z.output<z.ZodObject<Shape>>) => Record<string, unknown>;
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
    input: z.object(args.blanks),
    toRequest: args.toRequest,
  }) as unknown as StepDefinition;
}

export const recipes: StepDefinition[] = [
  recipe({
    id: "recipe-join-videos",
    title: "Join videos into one",
    description:
      "Plays several videos one after another as a single video, re-encoding so clips of different kinds still join cleanly. Every video needs sound.",
    primaryInput: null,
    listInput: { field: "video_urls", itemKey: "video_url" },
    blanks: {
      video_urls: z
        .array(z.object({ video_url: z.string().url() }))
        .min(2)
        .max(20)
        .describe("The videos, in the order they should play"),
    },
    toRequest: ({ video_urls }) => {
      const n = video_urls.length;
      const pads = video_urls.map((_, i) => `[${i}:v][${i}:a]`).join("");
      return request(
        video_urls.map((item) => item.video_url),
        [`${pads}concat=n=${n}:v=1:a=1[outv][outa]`],
        [
          opt("-map", "[outv]"),
          opt("-map", "[outa]"),
          opt("-c:v", "libx264"),
          opt("-crf", 21),
          opt("-preset", "veryfast"),
          opt("-c:a", "aac"),
          opt("-b:a", "128k"),
        ],
      );
    },
  }),
  recipe({
    id: "recipe-clip",
    title: "Take a clip",
    description: "Keeps one stretch of a video, from a start second to an end second.",
    primaryInput: "video_url",
    blanks: {
      video_url: url("The video to take the clip from"),
      start: number("Second the clip starts at", 0, 86400).default(10),
      end: number("Second the clip ends at", 0, 86400).default(15),
    },
    toRequest: ({ video_url, start, end }) =>
      request(
        [video_url],
        [
          `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[vout];[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[aout]`,
        ],
        [
          opt("-map", "[vout]"),
          opt("-map", "[aout]"),
          opt("-c:v", "libx264"),
          opt("-preset", "veryfast"),
          opt("-c:a", "aac"),
        ],
      ),
  }),
  recipe({
    id: "recipe-crop-vertical",
    title: "Crop to vertical",
    description:
      "Cuts a tall slice out of a wide video and scales it up for Shorts, Reels and TikTok. The defaults take the middle of a 1920 by 1080 video.",
    primaryInput: "video_url",
    blanks: {
      video_url: url("The wide video"),
      crop_width: whole("Width of the slice to keep, in pixels", 2, 8000).default(608),
      crop_height: whole("Height of the slice to keep, in pixels", 2, 8000).default(1080),
      crop_x: whole("How far from the left the slice starts", 0, 8000).default(656),
      crop_y: whole("How far from the top the slice starts", 0, 8000).default(0),
      out_width: whole("Width of the finished video", 2, 8000).default(1080),
      out_height: whole("Height of the finished video", 2, 8000).default(1920),
    },
    toRequest: (b) =>
      request(
        [b.video_url],
        [
          `[0:v]crop=${b.crop_width}:${b.crop_height}:${b.crop_x}:${b.crop_y},scale=${b.out_width}:${b.out_height}[v]`,
        ],
        [opt("-map", "[v]"), opt("-map", "0:a"), opt("-c:a", "copy")],
      ),
  }),
  recipe({
    id: "recipe-frame",
    title: "Save one frame as a picture",
    description: "Saves the picture at a chosen second of a video as an image.",
    primaryInput: "video_url",
    blanks: {
      video_url: url("The video"),
      second: number("How many seconds in", 0, 86400).default(1),
    },
    toRequest: ({ video_url, second }) =>
      request(
        [video_url],
        [`select='gte(t,${second})',showinfo`],
        [opt("-frames:v", 1), opt("-f", "image2")],
      ),
  }),
  recipe({
    id: "recipe-logo",
    title: "Add a logo",
    description: "Puts a logo in the bottom-left corner of a video for its whole length.",
    primaryInput: "video_url",
    brandInputs: { logo_url: "logo" },
    blanks: {
      video_url: url("The video"),
      logo_url: url("The logo image, ideally a PNG with a clear background"),
      logo_size: whole("Logo size in pixels, along its longest side", 8, 4000).default(150),
      margin: whole("Gap from the edges in pixels", 0, 4000).default(50),
    },
    toRequest: (b) =>
      request(
        [b.video_url, b.logo_url],
        [
          // Fits the logo in a square of that size and keeps its own shape, so a wide logo
          // is not squashed.
          `[1:v]scale=w=${b.logo_size}:h=${b.logo_size}:force_original_aspect_ratio=decrease[logo];[0:v][logo]overlay=x=${b.margin}:y=main_h-overlay_h-${b.margin}`,
        ],
        [opt("-f", "mp4"), opt("-c:v", "libx264"), opt("-preset", "veryfast")],
      ),
  }),
  recipe({
    id: "recipe-picture-on-picture",
    title: "Put a picture on a picture",
    description:
      "Centres one image over another, such as a screenshot of a post over a background. Makes an image.",
    primaryInput: "background_url",
    blanks: {
      background_url: url("The background image"),
      overlay_url: url("The image to put on top"),
      offset_down: whole("How far below the centre to place it, in pixels", -4000, 4000).default(
        200,
      ),
    },
    toRequest: (b) =>
      request(
        [b.background_url, b.overlay_url],
        [`[0:v][1:v]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2+${b.offset_down}[outv]`],
        [opt("-map", "[outv]"), opt("-f", "image2")],
      ),
  }),
  recipe({
    id: "recipe-picture-on-video",
    title: "Put a picture on a video",
    description:
      "Centres an image over a video for its whole length, such as a screenshot of a post over footage.",
    primaryInput: "video_url",
    blanks: {
      video_url: url("The video"),
      overlay_url: url("The image to put on top"),
      offset_down: whole("How far below the centre to place it, in pixels", -4000, 4000).default(
        200,
      ),
    },
    toRequest: (b) =>
      request(
        [b.video_url, b.overlay_url],
        [`[0:v][1:v]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2+${b.offset_down}[outv]`],
        [
          opt("-map", "[outv]"),
          opt("-map", "0:a"),
          opt("-c:v", "libx264"),
          opt("-preset", "veryfast"),
          opt("-c:a", "aac"),
          opt("-f", "mp4"),
        ],
      ),
  }),
  recipe({
    id: "recipe-reaction",
    title: "Reaction video",
    description:
      "Plays a second video in a bordered box over the main one and mixes both soundtracks. Both videos need sound.",
    primaryInput: "video_url",
    blanks: {
      video_url: url("The main video"),
      reaction_url: url("The video shown in the box"),
      box_scale: number("Size of the box, as a share of a 1080 by 1920 frame", 0.05, 1).default(
        0.45,
      ),
      box_x: whole("How far from the left the box sits", 0, 8000).default(500),
      box_y: whole("How far from the top the box sits", 0, 8000).default(950),
      show_until: number("Second at which the box disappears", 0, 86400).default(39),
      border_color: color.default("red"),
      border_width: whole("Border thickness in pixels", 0, 200).default(25),
    },
    toRequest: (b) =>
      request(
        [b.video_url, b.reaction_url],
        [
          `[1:v]scale=1080:1920[preScaledB];[preScaledB]scale=iw*${b.box_scale}:ih*${b.box_scale}[scaledB];[scaledB]drawbox=x=0:y=0:w=iw:h=ih:color=${b.border_color}@1:t=${b.border_width}[borderB];[0:v][borderB]overlay=x=${b.box_x}:y=${b.box_y}:enable='lte(t,${b.show_until})'[videoOut]`,
          "[0:a][1:a]amix=inputs=2:duration=longest[audioOut]",
        ],
        [
          opt("-map", "[videoOut]"),
          opt("-map", "[audioOut]"),
          opt("-c:v", "libx264"),
          opt("-preset", "veryfast"),
          opt("-c:a", "aac"),
          opt("-b:a", "192k"),
        ],
      ),
  }),
  recipe({
    id: "recipe-background-music",
    title: "Add background music",
    description:
      "Mixes a music track under a video's own sound without re-encoding the picture. The video needs sound.",
    primaryInput: "video_url",
    brandInputs: { music_url: "music" },
    blanks: {
      video_url: url("The video"),
      music_url: url("The music track"),
      video_volume: number("Loudness of the video's own sound (1 is unchanged)", 0, 10).default(1),
      music_volume: number("Loudness of the music (1 is unchanged)", 0, 10).default(0.6),
    },
    toRequest: (b) =>
      request(
        [b.video_url, b.music_url],
        [
          `[0:a]volume=${b.video_volume}[audio1];[1:a]volume=${b.music_volume}[audio2];[audio1][audio2]amix=inputs=2:duration=longest[outa]`,
        ],
        [opt("-map", "0:v"), opt("-map", "[outa]"), opt("-c:v", "copy"), opt("-c:a", "aac")],
      ),
  }),
  recipe({
    id: "recipe-text-on-picture",
    title: "Write on a picture",
    description: "Writes a line of text in the middle of an image. Makes an image.",
    primaryInput: "image_url",
    blanks: {
      image_url: url("The image"),
      text: text("The words to show"),
      font_size: whole("Text size in pixels", 8, 400).default(70),
      font_color: color.default("white"),
    },
    toRequest: (b) =>
      request(
        [b.image_url],
        [
          `drawtext=text=${drawtextValue(b.text)}:fontsize=${b.font_size}:fontcolor=${b.font_color}:${CENTRED}`,
        ],
        STILL,
      ),
  }),
  recipe({
    id: "recipe-certificate",
    title: "Fill in a certificate",
    description:
      "Writes a name, a course, an instructor and a date onto a certificate image. The positions suit a 2000 by 1414 template; change them to fit yours.",
    primaryInput: "image_url",
    blanks: {
      image_url: url("The blank certificate image"),
      name: text("Who it is for"),
      course: text("What it is for"),
      instructor: text("Who signed it"),
      date: text("The date to print"),
      font_color: color.default("black"),
      name_y: whole("How far from the top the name sits", 0, 20000).default(820),
      course_y: whole("How far from the top the course sits", 0, 20000).default(1000),
      footer_up: whole("How far from the bottom the instructor and date sit", 0, 20000).default(
        310,
      ),
    },
    toRequest: (b) =>
      request(
        [b.image_url],
        [
          `[0:v]drawtext=text=${drawtextValue(b.name)}:fontsize=55:fontcolor=${b.font_color}:x=(w-text_w)/2:y=${b.name_y}[v1]`,
          `[v1]drawtext=text=${drawtextValue(b.course)}:fontsize=30:fontcolor=${b.font_color}:x=(w-text_w)/2:y=${b.course_y}[v2]`,
          `[v2]drawtext=text=${drawtextValue(b.instructor)}:fontsize=25:fontcolor=${b.font_color}:x=410:y=h-${b.footer_up}[v3]`,
          `[v3]drawtext=text=${drawtextValue(b.date)}:fontsize=25:fontcolor=${b.font_color}:x=w-560:y=h-${b.footer_up}[outv]`,
        ],
        [opt("-map", "[outv]"), ...STILL],
      ),
  }),
  textRecipe({
    id: "recipe-text",
    title: "Write on a video",
    description: "Shows a line of text in the middle of a video for its whole length.",
    extra: {},
    filter: (b) => `[0:v]${drawtext(b, `:${CENTRED}`)}`,
  }),
  textRecipe({
    id: "recipe-text-scrolling",
    title: "Scrolling text",
    description: "Runs a line of text across the video from right to left, over and over.",
    extra: { speed: whole("Pixels moved each second", 1, 5000).default(100) },
    filter: (b) => `[0:v]${drawtext(b, `:x=w-mod(t*${b.speed}\\,w+text_w):y=(h-text_h)/2`)}`,
  }),
  textRecipe({
    id: "recipe-text-bouncing",
    title: "Bouncing text",
    description: "Shows text in the middle of the video, gently moving up and down.",
    extra: { bounce: whole("How far it moves, in pixels", 1, 2000).default(20) },
    filter: (b) => `[0:v]${drawtext(b, `:x=(w-text_w)/2:y=(h-text_h)/2+${b.bounce}*sin(2*t)`)}`,
  }),
  textRecipe({
    id: "recipe-text-shadow",
    title: "Text with a shadow",
    description: "Shows text with a drop shadow so it stands out from the picture.",
    extra: {
      shadow_color: color.default("black"),
      shadow_offset: whole("How far the shadow is pushed, in pixels", 0, 100).default(2),
    },
    filter: (b) =>
      `[0:v]${drawtext(b, `:shadowcolor=${b.shadow_color}:shadowx=${b.shadow_offset}:shadowy=${b.shadow_offset}:${CENTRED}`)}`,
  }),
  textRecipe({
    id: "recipe-text-outline",
    title: "Text with an outline",
    description: "Shows text with a coloured outline so it reads on any background.",
    extra: {
      outline_color: color.default("black"),
      outline_width: whole("Outline thickness in pixels", 0, 100).default(2),
    },
    filter: (b) =>
      `[0:v]${drawtext(b, `:borderw=${b.outline_width}:bordercolor=${b.outline_color}:${CENTRED}`)}`,
  }),
  textRecipe({
    id: "recipe-text-box",
    title: "Text on a box",
    description: "Shows text on a see-through box, like a lower-third title.",
    extra: {
      box_color: color.default("black"),
      box_opacity: number("How solid the box is, from 0 to 1", 0, 1).default(0.5),
    },
    filter: (b) =>
      `[0:v]${drawtext(b, `:box=1:boxcolor=${b.box_color}@${b.box_opacity}:${CENTRED}`)}`,
  }),
  textRecipe({
    id: "recipe-text-fade-in",
    title: "Text that fades in",
    description: "Fades text in at the start of the video and keeps it there.",
    extra: { fade_seconds: number("How long the fade takes", 0.1, 60).default(1) },
    filter: (b) =>
      `[0:v]${drawtext(b, `:alpha='if(lt(t,${b.fade_seconds}),t/${b.fade_seconds},1)':${CENTRED}`)}`,
  }),
  textRecipe({
    id: "recipe-text-see-through",
    title: "See-through text",
    description: "Shows partly see-through text, useful as a watermark.",
    extra: { opacity: number("How solid the text is, from 0 to 1", 0, 1).default(0.5) },
    filter: (b) =>
      `[0:v]${drawtext({ ...b, font_color: `${b.font_color}@${b.opacity}` }, `:${CENTRED}`)}`,
  }),
  textRecipe({
    id: "recipe-text-timestamp",
    title: "Running clock with text",
    description: "Shows the time elapsed in the video, followed by your text.",
    extra: {},
    filter: (b) =>
      // The clock is FFmpeg's own expansion; only the person's words are escaped.
      `[0:v]${drawtext(b, `:${CENTRED}`, `'%{pts\\:hms} '${drawtextValue(b.text)}`)}`,
  }),
  textRecipe({
    id: "recipe-text-rotated",
    title: "Tilted video with text",
    description: "Writes text on the video, then tilts the whole picture by an angle.",
    extra: { angle: number("Degrees to tilt, clockwise", -360, 360).default(45) },
    filter: (b) => {
      const radians = `${b.angle}*(PI/180)`;
      return `[0:v]${drawtext(b, `:${CENTRED}:alpha=1`)}[text]; [text]rotate=${radians}:ow=rotw(${radians}):oh=roth(${radians})[rotated_text]; [0:v][rotated_text]overlay=(W-w)/2:(H-h)/2`;
    },
  }),
  textRecipe({
    id: "recipe-text-mirrored",
    title: "Mirrored video with text",
    description: "Writes text on the video, then flips the whole picture left to right.",
    extra: {},
    filter: (b) =>
      `[0:v]${drawtext(b, `:${CENTRED}`)}[text]; [text]hflip[mirrored_text]; [0:v][mirrored_text]overlay=(W-w)/2:(H-h)/2`,
  }),
];

const even = (what: string, min: number, max: number) =>
  whole(what, min, max).refine((value) => value % 2 === 0, "Use an even number of pixels.");

/**
 * More ready-made FFmpeg jobs, written for this dashboard rather than taken from the
 * toolkit's examples. They are the jobs people ask for most (see the FFmpeg automation
 * research) that one compose request can do today.
 */
export const moreRecipes: StepDefinition[] = [
  recipe({
    id: "recipe-blur-fill",
    title: "Fit with a blurred background",
    description:
      "Fits the whole picture into a new shape, such as vertical for Shorts, Reels and TikTok, and fills the empty space with a blurred copy of it. Nothing is cut off.",
    primaryInput: "video_url",
    blanks: {
      video_url: url("The video"),
      width: even("Width of the finished video", 2, 8000).default(1080),
      height: even("Height of the finished video", 2, 8000).default(1920),
      blur: whole("How blurred the background is", 1, 100).default(20),
    },
    toRequest: (b) => {
      const size = `${b.width}:${b.height}`;
      // The blur's reach cannot be more than half the shorter side.
      const blur = Math.min(b.blur, Math.floor(Math.min(b.width, b.height) / 2) - 1);
      return request(
        [b.video_url],
        [
          `[0:v]split=2[back][front];[back]scale=${size}:force_original_aspect_ratio=increase,crop=${size},boxblur=${blur}:1[blurred];[front]scale=${size}:force_original_aspect_ratio=decrease[fitted];[blurred][fitted]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]`,
        ],
        [
          opt("-map", "[v]"),
          opt("-map", "0:a?"),
          ...X264.slice(0, 3),
          opt("-c:a", "aac"),
          opt("-movflags", "+faststart"),
          opt("-f", "mp4"),
        ],
      );
    },
  }),
  recipe({
    id: "recipe-cover-art-video",
    title: "Audio with cover art",
    description:
      "Turns a song or episode into a video: the cover art for the whole length, with a moving sound wave under it if you want one. Your logo is used until you pick cover art.",
    primaryInput: "audio_url",
    brandInputs: { image_url: "logo", wave_color: "color" },
    blanks: {
      audio_url: url("The song or episode"),
      image_url: url("The cover art"),
      width: even("Width of the video", 2, 8000).default(1920),
      height: even("Height of the video", 2, 8000).default(1080),
      waveform: z.boolean().default(true).describe("Show a moving sound wave"),
      wave_color: color.default("white"),
    },
    toRequest: (b) => {
      const size = `${b.width}:${b.height}`;
      const background = `[0:v]scale=${size}:force_original_aspect_ratio=decrease,pad=${size}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=25`;
      const waveHeight = Math.max(2, Math.round(b.height / 5 / 2) * 2);
      const filter = b.waveform
        ? `${background}[art];[1:a]showwaves=s=${b.width}x${waveHeight}:mode=cline:rate=25:colors=${b.wave_color}[wave];[art][wave]overlay=0:H-h-${Math.round(b.height / 20)},format=yuv420p[v]`
        : `${background},format=yuv420p[v]`;
      return {
        // The picture repeats for as long as the sound plays.
        inputs: [{ file_url: b.image_url, options: [opt("-loop", 1)] }, { file_url: b.audio_url }],
        filters: [{ filter }],
        outputs: [
          {
            options: [
              opt("-map", "[v]"),
              opt("-map", "1:a"),
              opt("-c:v", "libx264"),
              opt("-preset", "veryfast"),
              opt("-tune", "stillimage"),
              opt("-crf", 21),
              opt("-c:a", "aac"),
              opt("-b:a", "192k"),
              opt("-shortest"),
              opt("-movflags", "+faststart"),
              opt("-f", "mp4"),
            ],
          },
        ],
      };
    },
  }),
  recipe({
    id: "recipe-loudness",
    title: "Even out loudness for platforms",
    description:
      "Brings a video's sound to the loudness platforms expect, so it is not quieter or louder than everything around it. YouTube, Spotify and TikTok use about -14, Apple Podcasts -16, broadcast -23. The picture is not touched. One pass, not two.",
    primaryInput: "video_url",
    blanks: {
      video_url: url("The video"),
      loudness: number("Target loudness in LUFS", -31, -5).default(-14),
      peak: number("Highest peak allowed, in dBTP", -9, 0).default(-1.5),
    },
    toRequest: (b) =>
      request(
        [b.video_url],
        [`[0:a]loudnorm=I=${b.loudness}:TP=${b.peak}:LRA=11[a]`],
        [
          opt("-map", "0:v?"),
          opt("-map", "[a]"),
          opt("-c:v", "copy"),
          opt("-c:a", "aac"),
          opt("-b:a", "192k"),
          opt("-ar", 48000),
          opt("-movflags", "+faststart"),
          opt("-f", "mp4"),
        ],
      ),
  }),
  recipe({
    id: "recipe-web-ready",
    title: "Make it web-ready",
    description:
      "A smaller MP4 that starts playing at once on a website or in a feed. Taller videos are scaled down; smaller ones are left at their size.",
    primaryInput: "video_url",
    blanks: {
      video_url: url("The video"),
      max_height: even("Tallest it may be, in pixels", 144, 4320).default(1080),
    },
    toRequest: (b) =>
      request(
        [b.video_url],
        [`[0:v]scale=-2:'min(${b.max_height},ih)',format=yuv420p[v]`],
        [
          opt("-map", "[v]"),
          opt("-map", "0:a?"),
          ...X264.slice(0, 3),
          opt("-c:a", "aac"),
          opt("-b:a", "128k"),
          opt("-movflags", "+faststart"),
          opt("-f", "mp4"),
        ],
      ),
  }),
  recipe({
    id: "recipe-gif-preview",
    title: "GIF preview",
    description: "A short looping GIF from the start of a video, for previews and link cards.",
    primaryInput: "video_url",
    blanks: {
      video_url: url("The video"),
      seconds: number("How many seconds from the start", 0.5, 15).default(4),
      width: even("Width in pixels", 64, 1280).default(480),
      frames_per_second: whole("Frames each second", 1, 30).default(12),
    },
    toRequest: (b) =>
      request(
        [b.video_url],
        [
          `[0:v]trim=duration=${b.seconds},fps=${b.frames_per_second},scale=${b.width}:-2:flags=lanczos,split[a][b];[a]palettegen[palette];[b][palette]paletteuse[v]`,
        ],
        [opt("-map", "[v]"), opt("-loop", 0), opt("-f", "gif")],
      ),
  }),
  recipe({
    id: "recipe-voice-master",
    title: "Clean up a voice recording",
    description:
      "Takes out rumble and steady background hiss, evens out the voice, brings it to podcast loudness and saves an MP3. Works on audio or video. Fixed settings, so very noisy rooms still need an editor.",
    primaryInput: "audio_url",
    blanks: {
      audio_url: url("The recording, audio or video"),
      loudness: number("Target loudness in LUFS", -31, -5).default(-16),
      reduce_noise: z.boolean().default(true).describe("Reduce steady background noise"),
    },
    toRequest: (b) =>
      request(
        [b.audio_url],
        [
          `[0:a]highpass=f=80,${b.reduce_noise ? "afftdn=nf=-25," : ""}acompressor=threshold=0.089:ratio=3:attack=20:release=250,loudnorm=I=${b.loudness}:TP=-1.5:LRA=11,aresample=44100[a]`,
        ],
        [opt("-map", "[a]"), opt("-c:a", "libmp3lame"), opt("-b:a", "128k"), opt("-f", "mp3")],
      ),
  }),
];
