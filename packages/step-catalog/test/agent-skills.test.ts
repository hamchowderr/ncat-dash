import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { teamStepDefinition, teamStepProblem, type TeamStepTemplate } from "../src";

/**
 * The agent's FFmpeg skills (packages/agent/skills) hold worked team steps, in
 * ```json team-step blocks. Each must be a template save_team_step accepts, and must make
 * a file on a real FFmpeg, built the way the toolkit's compose route builds the command.
 */

const SKILLS = path.resolve(__dirname, "../../agent/skills");

type Option = { option: string; argument?: string | number };
type ComposeRequest = {
  inputs: { file_url: string; options?: Option[] }[];
  filters?: { filter: string }[];
  outputs: { options: Option[] }[];
  global_options?: Option[];
};

function markdownFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full);
    return entry.name.endsWith(".md") ? [full] : [];
  });
}

const worked: [string, TeamStepTemplate][] = markdownFiles(SKILLS).flatMap((file) =>
  [...fs.readFileSync(file, "utf8").matchAll(/```json team-step\n([\s\S]*?)\n```/g)].map(
    (match) => {
      const template = JSON.parse(match[1]) as TeamStepTemplate;
      return [`${path.relative(SKILLS, file)}: ${template.title}`, template] as [string, TeamStepTemplate];
    },
  ),
);

/** The test file a file setting gets, from its name. */
function mediaFor(name: string, index: number): string {
  if (/music|audio|sound/.test(name)) return "music.mp3";
  if (/logo|image|picture/.test(name)) return "logo.png";
  return index === 0 ? "a.mp4" : "b.mp4";
}

/** What a person filling it in untouched would give: defaults, else the lowest value. */
function sampleValues(template: TeamStepTemplate): Record<string, unknown> {
  let files = 0;
  const values: Record<string, unknown> = {};
  for (const blank of template.blanks) {
    if (blank.kind === "file") values[blank.name] = `https://files.example.com/${mediaFor(blank.name, files++)}`;
    else if (blank.default !== undefined) values[blank.name] = blank.default;
    else if (blank.kind === "number") values[blank.name] = blank.min ?? 1;
    else if (blank.kind === "choice") values[blank.name] = blank.options![0];
    else if (blank.kind === "color") values[blank.name] = "white";
    else values[blank.name] = "Sample words";
  }
  return values;
}

function build(template: TeamStepTemplate): ComposeRequest {
  const step = teamStepDefinition({ ...template, id: "worked" });
  return step.toRequest!(step.input.parse(sampleValues(template)), {}) as ComposeRequest;
}

describe("the worked steps in the agent's FFmpeg skills", () => {
  it("are there: at least ten, each with its own title", () => {
    expect(worked.length).toBeGreaterThanOrEqual(10);
    const titles = worked.map(([, template]) => template.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it.each(worked)("%s is a step save_team_step accepts", (_name, template) => {
    expect(teamStepProblem(template)).toBeNull();
  });

  it("every skill reference a SKILL.md names is there", () => {
    for (const skill of fs.readdirSync(SKILLS)) {
      const text = fs.readFileSync(path.join(SKILLS, skill, "SKILL.md"), "utf8");
      for (const [, ref] of text.matchAll(/`(references\/[a-z0-9-]+\.md)`/g)) {
        expect(fs.existsSync(path.join(SKILLS, skill, ref)), `${skill}: ${ref}`).toBe(true);
      }
    }
  });
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

/** Skipped where FFmpeg is not installed; CI installs it. */
describe.skipIf(!hasFfmpeg)("the worked steps on a real FFmpeg", () => {
  let dir = "";
  const ffmpeg = (args: string[]) =>
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  const probe = (file: string, entries: string) =>
    execFileSync("ffprobe", ["-v", "error", "-show_entries", entries, "-of", "csv=p=0", file])
      .toString()
      .trim();

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-skills-"));
    const video = (name: string, source: string, tone: number) =>
      ffmpeg([
        ...["-f", "lavfi", "-i", `${source}=size=1280x720:rate=30:duration=2`],
        ...["-f", "lavfi", "-i", `sine=frequency=${tone}:duration=2`],
        ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac"],
        path.join(dir, name),
      ]);
    video("a.mp4", "testsrc", 440);
    video("b.mp4", "testsrc2", 660);
    ffmpeg(["-f", "lavfi", "-i", "sine=frequency=220:duration=1", path.join(dir, "music.mp3")]);
    ffmpeg([
      ...["-f", "lavfi", "-i", "color=c=white:size=300x300", "-frames:v", "1"],
      path.join(dir, "logo.png"),
    ]);
  }, 60_000);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** The command the toolkit's services/v1/ffmpeg/ffmpeg_compose.py builds. */
  function run(request: ComposeRequest, name: string): string[] {
    const push = (args: string[], options: Option[] = []) => {
      for (const item of options) {
        args.push(item.option);
        if (item.argument !== undefined && item.argument !== null) args.push(String(item.argument));
      }
    };
    const args: string[] = [];
    push(args, request.global_options);
    for (const input of request.inputs) {
      push(args, input.options);
      args.push("-i", path.join(dir, path.basename(new URL(input.file_url).pathname)));
    }
    if (request.filters?.length) {
      args.push("-filter_complex", request.filters.map((item) => item.filter).join(";"));
    }
    const extensions: Record<string, string> = { image2: "png", mp3: "mp3", wav: "wav", gif: "gif" };
    const outputs = request.outputs.map((output, index) => {
      push(args, output.options);
      const format = output.options.find((item) => item.option === "-f")?.argument;
      const file = path.join(dir, `${name}-${index}.${extensions[String(format)] ?? "mp4"}`);
      args.push(file);
      return file;
    });
    ffmpeg(args);
    return outputs;
  }

  it.each(worked.map(([name, template], index) => [name, template, index] as const))(
    "%s runs and makes a file",
    (_name, template, index) => {
      for (const file of run(build(template), `step${index}`)) {
        expect(fs.statSync(file).size).toBeGreaterThan(500);
      }
    },
    60_000,
  );

  const byTitle = (title: string) => worked.find(([, template]) => template.title === title)![1];

  it("stacks two videos into a 1080 by 1920 frame", () => {
    const [file] = run(build(byTitle("Stack two videos")), "stack-size");
    expect(probe(file, "stream=width,height")).toContain("1080,1920");
  }, 60_000);

  it("changes the speed of the picture and the sound together", () => {
    const [file] = run(build(byTitle("Change the speed")), "speed-length");
    // Two seconds at 1.5 times is about 1.33 seconds.
    expect(Number(probe(file, "format=duration"))).toBeCloseTo(1.33, 0);
    expect(probe(file, "stream=codec_type")).toContain("audio");
  }, 60_000);

  it("keeps the video's length when the music under it is shorter", () => {
    const [file] = run(build(byTitle("Music that dips under the voice")), "duck-length");
    expect(Number(probe(file, "format=duration"))).toBeCloseTo(2, 0);
  }, 60_000);

  it("leaves no sound in a muted video", () => {
    const [file] = run(build(byTitle("Mute a video")), "mute-streams");
    expect(probe(file, "stream=codec_type")).not.toContain("audio");
  }, 60_000);
});
