import { afterEach, describe, expect, it } from "vitest";
import {
  currentTeamSteps,
  fillRequest,
  getStep,
  setTeamSteps,
  teamStepDefinition,
  teamStepProblem,
  type TeamStepTemplate,
  userInputSchema,
} from "../src";

const LOGO: TeamStepTemplate = {
  title: "Put a logo in a corner",
  description: "Lays a logo over the video in the chosen corner, at the chosen size.",
  blanks: [
    { name: "video_url", label: "Video", kind: "file" },
    { name: "logo_url", label: "Logo", kind: "file" },
    { name: "size", label: "Logo width", kind: "number", default: 200, min: 40, max: 800, whole: true },
    { name: "corner", label: "Corner", kind: "choice", options: ["10:10", "W-w-10:10"], default: "10:10" },
    { name: "tag", label: "Words at the bottom", kind: "text", default: "Salt House" },
  ],
  primary: "video_url",
  request: {
    inputs: [{ file_url: "{{video_url}}" }, { file_url: "{{logo_url}}" }],
    filters: [
      { filter: "[1:v]scale={{size}}:-1[l];[0:v][l]overlay={{corner}},drawtext=text='{{tag}}'" },
    ],
    outputs: [{ options: [{ option: "-f", argument: "mp4" }] }],
  },
};

type Compose = { inputs: { file_url: string }[]; filters: { filter: string }[] };

afterEach(() => setTeamSteps([]));

describe("checking a team step before it is saved", () => {
  it("passes a well-made step", () => {
    expect(teamStepProblem(LOGO)).toBeNull();
  });

  it("names a {{setting}} the request uses that does not exist", () => {
    const broken = { ...LOGO, request: { ...LOGO.request, filters: [{ filter: "scale={{width}}:-1" }] } };
    expect(teamStepProblem(broken)).toMatch(/\{\{width\}\}/);
  });

  it("wants each file setting to be a whole input link", () => {
    const broken = {
      ...LOGO,
      request: { ...LOGO.request, inputs: [{ file_url: "https://x.example/{{video_url}}" }, { file_url: "{{logo_url}}" }] },
    };
    expect(teamStepProblem(broken)).toMatch(/whole file_url/);
  });

  it("turns away a main input that is not a file setting", () => {
    expect(teamStepProblem({ ...LOGO, primary: "size" })).toMatch(/main input/);
  });

  it("turns away a default that does not fit its setting", () => {
    const blanks = LOGO.blanks.map((blank) =>
      blank.name === "size" ? { ...blank, default: 5000 } : blank,
    );
    expect(teamStepProblem({ ...LOGO, blanks })).toMatch(/default of "size"/);
  });

  it("turns away a request that is not a compose request", () => {
    expect(teamStepProblem({ ...LOGO, request: { ...LOGO.request, outputs: [] } })).toMatch(
      /not a valid FFmpeg compose request/,
    );
  });
});

describe("filling a team step in", () => {
  it("keeps numbers as numbers where a setting is the whole value", () => {
    expect(fillRequest({ a: "{{n}}", b: "x={{n}}" }, { n: 4 })).toEqual({ a: 4, b: "x=4" });
  });

  it("makes the compose request, with defaults for settings left out", () => {
    const step = teamStepDefinition({ ...LOGO, id: "abc" });
    const parsed = userInputSchema(step).parse({
      video_url: "https://files.example/a.mp4",
      logo_url: "https://files.example/logo.png",
    });
    const request = step.toRequest!(parsed, {}) as Compose;
    expect(request.inputs).toEqual([
      { file_url: "https://files.example/a.mp4" },
      { file_url: "https://files.example/logo.png" },
    ]);
    expect(request.filters[0].filter).toBe(
      "[1:v]scale=200:-1[l];[0:v][l]overlay=10:10,drawtext=text='Salt House'",
    );
  });

  it("will not let words break out of the filter", () => {
    const step = teamStepDefinition({ ...LOGO, id: "abc" });
    const base = { video_url: "https://f.example/a.mp4", logo_url: "https://f.example/l.png" };
    expect(userInputSchema(step).safeParse({ ...base, tag: "a':x=1,scale=1" }).success).toBe(false);
    // An apostrophe is fine: it becomes ’, which cannot end the quoted text.
    const parsed = userInputSchema(step).parse({ ...base, tag: "Maya's show" });
    const request = step.toRequest!(parsed, {}) as Compose;
    expect(request.filters[0].filter).toContain("text='Maya’s show'");
  });

  it("only takes one of a choice's values", () => {
    const step = teamStepDefinition({ ...LOGO, id: "abc" });
    const base = { video_url: "https://f.example/a.mp4", logo_url: "https://f.example/l.png" };
    expect(userInputSchema(step).safeParse({ ...base, corner: "0:0[x]" }).success).toBe(false);
  });
});

describe("the team's steps in the catalog", () => {
  it("are found by id while set, and dropped when another team's are set", () => {
    setTeamSteps([{ ...LOGO, id: "one" }]);
    expect(getStep("team-one")).toMatchObject({ title: LOGO.title, category: "team" });
    expect(currentTeamSteps()).toHaveLength(1);
    setTeamSteps([{ ...LOGO, id: "two" }]);
    expect(getStep("team-one")).toBeUndefined();
    expect(getStep("team-two")).toBeDefined();
  });

  it("never stand in for a ready-made step", () => {
    setTeamSteps([{ ...LOGO, id: "x" }]);
    expect(getStep("video-trim")?.category).not.toBe("team");
  });
});
