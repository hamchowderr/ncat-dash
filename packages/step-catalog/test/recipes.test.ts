import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  allSteps,
  callStep,
  drawtextValue,
  getStep,
  moreRecipes,
  recipes,
  type StepDefinition,
  userInputJsonSchema,
} from "../src";

type Option = { option: string; argument?: string | number };
type ComposeRequest = {
  inputs: { file_url: string; options?: Option[] }[];
  filters: { filter: string }[];
  outputs: { options: Option[] }[];
};

// Text that would break a filter graph if any of FFmpeg's three readings were missed.
const AWKWARD = `It's 100%: "done", [ok]; a=b \\ %{pts} end`;

const MEDIA: Record<string, string> = {
  "https://files.example.com/a.mp4": "a.mp4",
  "https://files.example.com/b.mp4": "b.mp4",
  "https://files.example.com/picture.png": "picture.png",
  "https://files.example.com/logo.png": "logo.png",
  "https://files.example.com/dark.mp4": "dark.mp4",
  "https://files.example.com/white-logo.png": "white-logo.png",
  "https://files.example.com/music.mp3": "music.mp3",
};
const urlFor = (file: string) => Object.keys(MEDIA).find((url) => MEDIA[url] === file)!;

type Property = { type?: string; format?: string };

/** The least a person could fill in: every required blank, nothing else. */
function minimalInput(step: StepDefinition): Record<string, unknown> {
  const schema = userInputJsonSchema(step) as {
    properties: Record<string, Property>;
    required?: string[];
  };
  const input: Record<string, unknown> = {};
  for (const name of schema.required ?? []) {
    const property = schema.properties[name];
    if (name === "video_urls") {
      input[name] = [{ video_url: urlFor("a.mp4") }, { video_url: urlFor("b.mp4") }];
    } else if (property.format === "uri") {
      const file =
        name === "logo_url"
          ? "logo.png"
          : name === "music_url"
            ? "music.mp3"
            : name === "reaction_url"
              ? "b.mp4"
              : name === "audio_url"
                ? "music.mp3"
                : name.startsWith("video")
                  ? "a.mp4"
                  : "picture.png";
      input[name] = urlFor(file);
    } else if (property.type === "string") {
      input[name] = AWKWARD;
    } else {
      throw new Error(`${step.id}: no test value for required blank ${name}`);
    }
  }
  // The sample videos are one second long, so the default 10 to 15 seconds is past the end.
  if (step.id === "recipe-clip") Object.assign(input, { start: 0.2, end: 0.8 });
  if (step.id === "recipe-frame") input.second = 0.5;
  return input;
}

function toRequest(step: StepDefinition, input: Record<string, unknown>): ComposeRequest {
  return step.toRequest!(step.input.parse(input), {}) as ComposeRequest;
}

const everyRecipe = [...recipes, ...moreRecipes];

describe("recipes", () => {
  it("puts the logo top right unless another corner is picked", () => {
    const recipe = getStep("recipe-logo")!;
    const filter = (input: Record<string, unknown>) =>
      toRequest(recipe, { ...minimalInput(recipe), margin: 50, ...input }).filters[0].filter;
    expect(filter({})).toContain("overlay=x=main_w-overlay_w-50:y=50");
    expect(filter({ corner: "top left" })).toContain("overlay=x=50:y=50");
    expect(filter({ corner: "bottom left" })).toContain("overlay=x=50:y=main_h-overlay_h-50");
    expect(filter({ corner: "bottom right" })).toContain(
      "overlay=x=main_w-overlay_w-50:y=main_h-overlay_h-50",
    );
    expect(() => toRequest(recipe, { ...minimalInput(recipe), corner: "middle" })).toThrow();
  });

  it("has 22 recipes with unique ids that do not clash with the toolkit steps", () => {
    expect(recipes).toHaveLength(22);
    expect(new Set(allSteps.map((step) => step.id)).size).toBe(allSteps.length);
    for (const recipe of recipes) {
      expect(recipe.category).toBe("recipe");
      expect(recipe.id).toMatch(/^recipe-/);
      expect(getStep(recipe.id)).toBe(recipe);
    }
  });

  it("has the dashboard's own recipes as steps too, each with its own id", () => {
    expect(moreRecipes.length).toBeGreaterThanOrEqual(6);
    for (const recipe of moreRecipes) {
      expect(recipe.category).toBe("recipe");
      expect(recipe.id).toMatch(/^recipe-/);
      expect(getStep(recipe.id)).toBe(recipe);
    }
  });

  it("refuses odd sizes, which H.264 cannot make", () => {
    const fill = getStep("recipe-blur-fill")!;
    expect(() => fill.input.parse({ ...minimalInput(fill), width: 1081 })).toThrow();
  });

  it.each(everyRecipe.map((recipe) => [recipe.id, recipe] as const))(
    "%s builds a request the toolkit's compose route accepts",
    (_id, recipe) => {
      const compose = getStep("ffmpeg-compose")!;
      const request = toRequest(recipe, minimalInput(recipe));
      expect(() => compose.input.strict().parse(request)).not.toThrow();
    },
  );

  it("names a real, required blank as the one the step before fills in", () => {
    for (const recipe of everyRecipe) {
      const schema = userInputJsonSchema(recipe) as { required?: string[] };
      const filled = recipe.listInput?.field ?? recipe.primaryInput;
      expect(filled, recipe.id).toBeTruthy();
      expect(schema.required, recipe.id).toContain(filled);
    }
  });

  it("refuses blanks that could break out of the filter graph", () => {
    const text = getStep("recipe-text")!;
    const good = minimalInput(text);
    expect(() => text.input.parse({ ...good, font_color: "white:x=0" })).toThrow();
    expect(() => text.input.parse({ ...good, font: "Arial':text='x" })).toThrow();
    expect(() => text.input.parse({ ...good, font_size: "50,scale=1" })).toThrow();
    const shadow = getStep("recipe-text-shadow")!;
    expect(() => shadow.input.parse({ ...good, shadow_color: "black[x];[x]" })).toThrow();
  });

  it("sends the built request, not the blanks, to the toolkit", async () => {
    let sent: Record<string, unknown> = {};
    const fetchStub = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return new Response("{}", { status: 202 });
    }) as unknown as typeof fetch;
    const clip = getStep("recipe-clip")!;
    await callStep(
      { baseUrl: "https://toolkit.example.com", apiKey: "k" },
      clip,
      { video_url: urlFor("a.mp4") },
      { fetch: fetchStub, webhookUrl: "https://hooks.example.com/x", id: "job1" },
    );
    expect(Object.keys(sent).sort()).toEqual(["filters", "id", "inputs", "outputs", "webhook_url"]);
    expect((sent as ComposeRequest).filters[0].filter).toContain("trim=start=10:end=15");
  });
});

describe("drawtextValue", () => {
  it("escapes for the filter graph, the options and the text expansion", () => {
    expect(drawtextValue("Hello")).toBe("'Hello'");
    expect(drawtextValue("a:b")).toBe("'a\\:b'");
    expect(drawtextValue("50%")).toBe("'50\\\\%'");
    expect(drawtextValue("line one\nline two")).toBe("'line one line two'");
    expect(drawtextValue("it's")).toBe("'it\\'\\''s'");
  });
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

/**
 * Runs each recipe through a real FFmpeg, building the command the way the toolkit's
 * services/v1/ffmpeg/ffmpeg_compose.py does. Skipped where FFmpeg is not installed;
 * CI installs it.
 */
describe.skipIf(!hasFfmpeg)("recipes on a real FFmpeg", () => {
  let dir = "";
  const ffmpeg = (args: string[]) =>
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "recipes-"));
    const video = (name: string, source: string, tone: number) =>
      ffmpeg([
        ...["-f", "lavfi", "-i", `${source}=size=1920x1080:rate=10:duration=1`],
        ...["-f", "lavfi", "-i", `sine=frequency=${tone}:duration=1`],
        ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac"],
        path.join(dir, name),
      ]);
    video("a.mp4", "testsrc", 440);
    video("b.mp4", "testsrc2", 660);
    const still = (name: string, size: string) =>
      ffmpeg([
        ...["-f", "lavfi", "-i", `color=c=gray:size=${size}`, "-frames:v", "1"],
        path.join(dir, name),
      ]);
    still("picture.png", "2000x1414");
    still("logo.png", "300x300");
    still("wide-logo.png", "600x200");
    ffmpeg([
      ...["-f", "lavfi", "-i", "color=c=black:size=1920x1080:rate=10:duration=1"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"],
      path.join(dir, "dark.mp4"),
    ]);
    ffmpeg([
      ...["-f", "lavfi", "-i", "color=c=white:size=300x300", "-frames:v", "1"],
      path.join(dir, "white-logo.png"),
    ]);
    ffmpeg([
      ...["-f", "lavfi", "-i", "sine=frequency=220:duration=1"],
      path.join(dir, "music.mp3"),
    ]);
  }, 60_000);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** The same command the toolkit builds from a compose request. */
  function run(request: ComposeRequest, name: string): string {
    const args: string[] = [];
    for (const input of request.inputs) {
      for (const item of input.options ?? []) {
        args.push(item.option);
        if (item.argument !== undefined) args.push(String(item.argument));
      }
      args.push("-i", path.join(dir, MEDIA[input.file_url]));
    }
    args.push("-filter_complex", request.filters.map((item) => item.filter).join(";"));
    const options = request.outputs[0].options;
    const format = options.find((item) => item.option === "-f")?.argument;
    for (const item of options) {
      args.push(item.option);
      if (item.argument !== undefined) args.push(String(item.argument));
    }
    // The extension the toolkit gives each output format.
    const extension =
      format === "image2" ? "png" : ["gif", "mp3"].includes(String(format)) ? format : "mp4";
    const output = path.join(dir, `${name}.${extension}`);
    ffmpeg([...args, output]);
    return output;
  }

  it.each(everyRecipe.map((recipe) => [recipe.id, recipe] as const))(
    "%s runs and makes a file",
    (id, recipe) => {
      const output = run(toRequest(recipe, minimalInput(recipe)), id);
      expect(fs.statSync(output).size).toBeGreaterThan(500);
    },
    60_000,
  );

  it("fits a logo in its size without squashing it", () => {
    const recipe = getStep("recipe-logo")!;
    const request = toRequest(recipe, { ...minimalInput(recipe), logo_size: 150 });
    // Only the part that resizes the logo, run on a logo three times wider than tall.
    const scale = request.filters[0].filter.match(/\[1:v\](scale=[^[]+)\[logo\]/)![1];
    const out = path.join(dir, "wide-logo-scaled.png");
    ffmpeg(["-i", path.join(dir, "wide-logo.png"), "-vf", scale, out]);
    const size = execFileSync("ffprobe", [
      ...["-v", "error", "-select_streams", "v:0"],
      ...["-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", out],
    ])
      .toString()
      .trim();
    expect(size).toBe("150x50");
  }, 60_000);

  it.each([
    ["top right", [1920 - 125, 125]],
    ["top left", [125, 125]],
    ["bottom left", [125, 1080 - 125]],
    ["bottom right", [1920 - 125, 1080 - 125]],
  ] as const)(
    "puts the logo in the %s corner",
    (corner, [x, y]) => {
      const recipe = getStep("recipe-logo")!;
      const request = toRequest(recipe, {
        video_url: urlFor("dark.mp4"),
        logo_url: urlFor("white-logo.png"),
        logo_size: 150,
        margin: 50,
        corner,
      });
      const output = run(request, `logo-${corner.replace(" ", "-")}`);
      // The first frame in grey; a white logo on black shows up as bright pixels only where it sits.
      const frame = execFileSync(
        "ffmpeg",
        [
          ...["-hide_banner", "-loglevel", "error", "-i", output],
          ...["-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        ],
        { maxBuffer: 8 * 1024 * 1024 },
      );
      const at = (px: number, py: number) => frame[py * 1920 + px];
      const corners = {
        "top left": [125, 125],
        "top right": [1795, 125],
        "bottom left": [125, 955],
        "bottom right": [1795, 955],
      };
      expect(at(x, y)).toBeGreaterThan(200);
      for (const [other, [ox, oy]] of Object.entries(corners)) {
        if (other !== corner) expect(at(ox, oy), other).toBeLessThan(50);
      }
    },
    60_000,
  );

  it("draws awkward text exactly as typed", () => {
    // FFmpeg reads a text file without any of the escaping, so it is the reference.
    const frame = (drawtext: string) =>
      createHash("md5")
        .update(
          execFileSync("ffmpeg", [
            ...["-hide_banner", "-loglevel", "error"],
            ...["-f", "lavfi", "-i", "color=c=black:size=1600x200"],
            ...["-vf", drawtext, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
          ]),
        )
        .digest("hex");
    const style = "fontsize=40:fontcolor=white:x=10:y=80";
    const samples = [AWKWARD, "plain", "50% off: today's 'best', \\n [x]=y;z", "%{localtime}"];
    for (const [index, sample] of samples.entries()) {
      const file = path.join(dir, `text-${index}.txt`);
      fs.writeFileSync(file, sample);
      const expected = frame(`drawtext=textfile=${file}:expansion=none:${style}`);
      expect(frame(`drawtext=text=${drawtextValue(sample)}:${style}`), sample).toBe(expected);
    }
    const blank = frame(`drawtext=text='':${style}`);
    expect(frame(`drawtext=text=${drawtextValue("plain")}:${style}`)).not.toBe(blank);
  }, 60_000);
});
