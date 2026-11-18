import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DashClient, useDashClientForTests } from "../../src/mastra/ncat/convex";
import { forgetSessions, rememberSession } from "../../src/mastra/ncat/session-store";
import { checkJob, saveTeamStep, tryTeamStep } from "../../src/mastra/ncat/team-steps";
import { NCAT_READ_TOOLS, ncatTools } from "../../src/mastra/ncat/tools";

/** The tools the agent writes, tries and saves a team's own FFmpeg step with. */
const USER = "u-team-steps";
type Call = { kind: string; name: string; args: Record<string, unknown> };
let calls: Call[] = [];
let answers: Record<string, (args: Record<string, unknown>) => unknown> = {};

const fake = (kind: string) => async (ref: never, args: Record<string, unknown>) => {
  const name = getFunctionName(ref);
  calls.push({ kind, name, args });
  const answer = answers[name];
  if (!answer) throw new Error(`No answer for ${name}`);
  return answer(args);
};
const client = { query: fake("query"), mutation: fake("mutation"), action: fake("action") };

// biome-ignore lint/suspicious/noExplicitAny: these tools read only agent.resourceId
const ctx = { agent: { resourceId: USER } } as any;
// biome-ignore lint/suspicious/noExplicitAny: execute's input type comes from each schema
const run = (tool: { execute?: (input: any, ctx: any) => unknown }, input: unknown) =>
  tool.execute?.(input, ctx);

const STEP = {
  title: "Blur the background behind a vertical video",
  description: "Puts the video in the middle of a 9:16 frame over a blurred copy.",
  blanks: [
    { name: "video_url", label: "Video", kind: "file" },
    { name: "blur", label: "Blur amount", kind: "number", default: 20 },
  ],
  primary: "video_url",
  request: {
    inputs: [{ file_url: "{{video_url}}" }],
    filters: [{ filter: "boxblur={{blur}}" }],
    outputs: [{ options: [{ option: "-f", argument: "mp4" }] }],
  },
};

beforeEach(() => {
  calls = [];
  answers = {};
  useDashClientForTests(() => client as unknown as DashClient);
  rememberSession(USER, { convexToken: "t", organizationId: "team_1", automationId: null });
});
afterEach(() => {
  useDashClientForTests();
  forgetSessions();
});

describe("trying a step the agent wrote", () => {
  it("sends uploads as upload ids and links as they are", async () => {
    answers["teamSteps:tryOut"] = () => ({ jobId: "job_1" });
    const result = await run(tryTeamStep, {
      step: STEP,
      files: { video_url: "up_1", logo_url: "https://files.example/logo.png" },
      values: { blur: 30 },
    });
    expect(result).toEqual({ jobId: "job_1" });
    expect(calls[0].args).toMatchObject({
      organizationId: "team_1",
      values: { blur: 30, video_url: "upload:up_1", logo_url: "https://files.example/logo.png" },
    });
  });

  it("passes the dashboard's plain words back when the step is not right", async () => {
    answers["teamSteps:tryOut"] = () => {
      throw new Error('The setting "blur" is never used in the request.');
    };
    await expect(run(tryTeamStep, { step: STEP, files: { video_url: "up_1" } })).rejects.toThrow(
      /never used/,
    );
  });
});

describe("checking the try", () => {
  it("gives back the files it made by name, without their signing", async () => {
    answers["jobs:get"] = () => ({
      status: "done",
      outputs: ["https://r2.example/teams/t/out%20file.mp4?X-Amz-Signature=abc"],
      error: null,
    });
    const result = await run(checkJob, { jobId: "job_1", waitSeconds: 0 });
    expect(result).toEqual({ status: "done", finished: true, made: ["out file.mp4"], error: null });
  });

  it("gives back the toolkit's error when it failed", async () => {
    answers["jobs:get"] = () => ({ status: "failed", outputs: [], error: "Invalid filtergraph" });
    const result = await run(checkJob, { jobId: "job_1", waitSeconds: 0 });
    expect(result).toMatchObject({ finished: true, error: "Invalid filtergraph" });
  });

  it("says when it is still going after the wait", async () => {
    answers["jobs:get"] = () => ({ status: "running", outputs: [], error: null });
    const result = await run(checkJob, { jobId: "job_1", waitSeconds: 0 });
    expect(result).toMatchObject({ status: "running", finished: false });
  });
});

describe("saving it", () => {
  it("returns the step type to add to an automation", async () => {
    answers["teamSteps:save"] = () => ({ stepId: "team-abc", title: STEP.title });
    const result = await run(saveTeamStep, { step: STEP });
    expect(result).toEqual({ stepId: "team-abc", title: STEP.title, type: "step:team-abc" });
    expect(calls[0].args).not.toHaveProperty("stepId");
  });

  it("changes a saved one when given its id", async () => {
    answers["teamSteps:save"] = () => ({ stepId: "team-abc", title: STEP.title });
    await run(saveTeamStep, { step: STEP, stepId: "team-abc" });
    expect(calls[0].args).toMatchObject({ stepId: "team-abc" });
  });
});

describe("the agent's tool list", () => {
  it("has the three tools; trying and saving ask first, checking does not", () => {
    expect(Object.keys(ncatTools)).toEqual(
      expect.arrayContaining(["try_team_step", "check_job", "save_team_step"]),
    );
    expect(NCAT_READ_TOOLS).toContain("check_job");
    expect(NCAT_READ_TOOLS).not.toContain("try_team_step");
    expect(NCAT_READ_TOOLS).not.toContain("save_team_step");
  });
});
