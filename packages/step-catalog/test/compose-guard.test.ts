import { describe, expect, it } from "vitest";
import {
  allSteps,
  callStep,
  composeProblem,
  filterProblem,
  type StepDefinition,
  StepSetupError,
  teamStepProblem,
  userInputJsonSchema,
} from "../src";

/**
 * Compose requests may not make FFmpeg read, write or load a file on the toolkit
 * (src/compose-guard.ts). On a toolkit several teams share, drawtext's textfile alone
 * would print the toolkit's own keys into a video.
 */

const VIDEO = "https://files.example.com/a.mp4";
const request = (extra: Record<string, unknown>) => ({
  inputs: [{ file_url: VIDEO }],
  outputs: [{ options: [{ option: "-c:v", argument: "libx264" }] }],
  ...extra,
});
const filter = (graph: string) => request({ filters: [{ filter: graph }] });

describe("filters that read files on the toolkit", () => {
  it.each([
    ["drawtext textfile", "[0:v]drawtext=textfile=/proc/1/environ:fontsize=20[v]"],
    ["textfile after other settings", "drawtext=fontsize=20:textfile=/etc/passwd"],
    ["textfile in quotes", "drawtext=textfile='/proc/self/environ'"],
    ["a setting read from a file", "drawtext=/text=/proc/1/environ"],
    ["movie", "movie=/etc/passwd[m];[0:v][m]overlay"],
    ["amovie", "amovie=/app/config.py"],
    ["sendcmd", "sendcmd=f=/tmp/cmds,drawtext=text=x"],
    ["a plugin", "ladspa=file=/tmp/evil.so"],
    ["lut3d", "lut3d=file=/etc/passwd"],
    ["subtitles from a path", "subtitles=/etc/passwd"],
    ["subtitles named filename", "subtitles=filename=/etc/passwd"],
    ["a file: address", "drawtext=fontfile=file\\:/x:text=a"],
    ["fontfile on the toolkit", "drawtext=fontfile=/usr/share/fonts/x.ttf:text=hi"],
  ])("refuses %s", (_, graph) => {
    expect(filterProblem(graph)).not.toBeNull();
    expect(composeProblem(filter(graph))).not.toBeNull();
  });

  it.each([
    ["scale and overlay", "[0:v]scale=1080:-2[a];[a][1:v]overlay=10:10[v]"],
    [
      "drawtext with awkward text",
      "drawtext=font='Sans':text='It\\'s 1/2 done... a=b /etc':fontsize=40",
    ],
    ["subtitles from a link", `subtitles=${VIDEO.replace("a.mp4", "c.srt")}`],
    ["subtitles from a quoted link", `subtitles='${VIDEO.replace("a.mp4", "c.ass")}'`],
    ["highpass f", "highpass=f=80,afftdn=nf=-25"],
  ])("allows %s", (_, graph) => {
    expect(filterProblem(graph)).toBeNull();
  });
});

describe("settings", () => {
  it.each([
    [
      "a bare word, which FFmpeg takes as another output file",
      { outputs: [{ options: [{ option: "/app/app.py" }] }] },
    ],
    ["a second input", { global_options: [{ option: "-i", argument: "/etc/passwd" }] }],
    [
      "a filter script",
      { global_options: [{ option: "-filter_complex_script", argument: "/tmp/x" }] },
    ],
    [
      "a path as a value",
      { outputs: [{ options: [{ option: "-hls_segment_filename", argument: "/app/x%d.ts" }] }] },
    ],
    [
      "a parent folder",
      { outputs: [{ options: [{ option: "-segment_list", argument: "../../app/x" }] }] },
    ],
    [
      "a concat input",
      { inputs: [{ file_url: VIDEO, options: [{ option: "-f", argument: "concat" }] }] },
    ],
    [
      "an hls input",
      { inputs: [{ file_url: VIDEO, options: [{ option: "-f", argument: "hls" }] }] },
    ],
    ["a local input", { inputs: [{ file_url: "/etc/passwd" }] }],
    ["a file: input", { inputs: [{ file_url: "file:///etc/passwd" }] }],
    [
      "a -vf reading a file",
      { outputs: [{ options: [{ option: "-vf", argument: "drawtext=textfile=/etc/passwd" }] }] },
    ],
    ["writing a stats file", { global_options: [{ option: "-vstats_file", argument: "x" }] }],
  ])("refuses %s", (_, extra) => {
    expect(composeProblem(request(extra))).not.toBeNull();
  });

  it("allows ordinary settings", () => {
    expect(
      composeProblem(
        request({
          global_options: [{ option: "-y" }],
          outputs: [
            {
              options: [
                { option: "-map", argument: "[v]" },
                { option: "-c:v", argument: "libx264" },
                { option: "-crf", argument: 20 },
                { option: "-metadata", argument: "title=Wait... it works" },
                { option: "-f", argument: "mp4" },
              ],
            },
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe("callStep", () => {
  it("never sends a refused compose request to the toolkit", async () => {
    const custom = allSteps.find((step) => step.id === "ffmpeg-compose")!;
    let sent = false;
    await expect(
      callStep(
        { baseUrl: "https://toolkit.example.com", apiKey: "k" },
        custom,
        filter("drawtext=textfile=/proc/1/environ"),
        {
          fetch: (async () => {
            sent = true;
            return new Response("{}");
          }) as typeof fetch,
        },
      ),
    ).rejects.toBeInstanceOf(StepSetupError);
    expect(sent).toBe(false);
  });
});

/** The least a person could fill in, enough to build each step's request. */
function minimalInput(step: StepDefinition): Record<string, unknown> {
  const schema = userInputJsonSchema(step) as {
    properties: Record<string, { type?: string; format?: string }>;
    required?: string[];
  };
  const input: Record<string, unknown> = {};
  for (const name of schema.required ?? []) {
    const property = schema.properties[name];
    if (name === "video_urls") input[name] = [{ video_url: VIDEO }, { video_url: VIDEO }];
    else if (property.format === "uri") input[name] = VIDEO;
    else if (property.type === "string")
      input[name] = `It's 100%: "done", [ok]; a=b \\ %{pts} 1/2 end...`;
  }
  return input;
}

describe("every ready-made compose step", () => {
  const compose = allSteps.filter(
    (step) =>
      step.endpoint === "/v1/ffmpeg/compose" &&
      step.toRequest &&
      !step.readsFirst &&
      !step.readsWords,
  );

  it("there are many to check", () => {
    expect(compose.length).toBeGreaterThan(20);
  });

  it.each(compose.map((step) => [step.id, step] as const))("%s passes the guard", (_, step) => {
    let built: Record<string, unknown>;
    try {
      built = step.toRequest!(step.input.parse(minimalInput(step)), {}) as Record<string, unknown>;
    } catch {
      return; // needs more than the least input; covered by its own tests
    }
    expect(composeProblem(built)).toBeNull();
  });
});

describe("team steps", () => {
  it("can't be saved when they would read a file on the toolkit", () => {
    expect(
      teamStepProblem({
        title: "Print a file",
        description: "Draws a file from the toolkit onto the video.",
        blanks: [{ name: "video_url", label: "The video", kind: "file" }],
        primary: "video_url",
        request: {
          inputs: [{ file_url: "{{video_url}}" }],
          filters: [{ filter: "[0:v]drawtext=textfile=/proc/1/environ[v]" }],
          outputs: [{ options: [{ option: "-map", argument: "[v]" }] }],
        },
      }),
    ).toMatch(/read a file/);
  });
});
