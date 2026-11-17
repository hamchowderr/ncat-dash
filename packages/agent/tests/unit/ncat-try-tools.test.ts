import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DashClient, useDashClientForTests } from "../../src/mastra/ncat/convex";
import { forgetSessions, rememberSession } from "../../src/mastra/ncat/session-store";
import { checkRun, listUploads, runReport, tryAutomation } from "../../src/mastra/ncat/tools";

/**
 * The tools the agent uses to try an automation before it offers to switch it on. Convex
 * is stood in for by a client that writes down what it was asked.
 */
const USER = "u-try";
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

// biome-ignore lint/suspicious/noExplicitAny: a tool's context is wide; these tools read only agent.resourceId
const ctx = { agent: { resourceId: USER } } as any;
// biome-ignore lint/suspicious/noExplicitAny: execute's input type comes from each schema
const run = (tool: { execute?: (input: any, ctx: any) => unknown }, input: unknown) =>
  tool.execute?.(input, ctx);

const nodes = [
  { id: "clips", kind: "clips", label: "Cut into short clips" },
  { id: "caption", kind: "step", stepId: "video-caption" },
];
type Step = {
  nodeId: string;
  status: string;
  error: string | null;
  outputs: string[];
  retries: number;
};
const runView = (status: string, steps: Step[]) => ({
  _id: "run_1",
  automationId: "auto_1",
  status,
  error: null,
  nodes,
  steps,
});

beforeEach(() => {
  calls = [];
  answers = {};
  useDashClientForTests(() => client as unknown as DashClient);
  rememberSession(USER, { convexToken: "t", organizationId: "team_1", automationId: "auto_1" });
});
afterEach(() => {
  useDashClientForTests();
  forgetSessions();
});

describe("list_uploads", () => {
  it("lists the files a run can start from, newest first, without brand files", async () => {
    answers["storage:listUploads"] = () => [
      {
        _id: "up_2",
        fileName: "talk.mp4",
        contentType: "video/mp4",
        status: "ready",
        purpose: null,
        details: { duration: 62.5 },
      },
      {
        _id: "up_logo",
        fileName: "logo.png",
        contentType: "image/png",
        status: "ready",
        purpose: "brand",
        details: null,
      },
      {
        _id: "up_3",
        fileName: "half.mp4",
        contentType: "video/mp4",
        status: "uploading",
        purpose: null,
        details: null,
      },
      {
        _id: "up_1",
        fileName: "song.mp3",
        contentType: "audio/mpeg",
        status: "ready",
        purpose: null,
        details: null,
      },
    ];
    expect(await run(listUploads, {})).toEqual({
      uploads: [
        { id: "up_2", name: "talk.mp4", kind: "video", seconds: 62.5 },
        { id: "up_1", name: "song.mp3", kind: "audio", seconds: null },
      ],
    });
    expect(calls[0]?.args).toEqual({ organizationId: "team_1" });
  });
});

describe("try_automation", () => {
  it("tries the open automation and gives the address of the run", async () => {
    answers["automations:tryOnUpload"] = () => ({ runId: "run_1", fileName: "talk.mp4" });
    expect(await run(tryAutomation, {})).toEqual({
      runId: "run_1",
      fileName: "talk.mp4",
      address: "/automations/auto_1/runs/run_1",
    });
    expect(calls).toEqual([
      { kind: "action", name: "automations:tryOnUpload", args: { automationId: "auto_1" } },
    ]);
  });

  it("passes on the upload asked for", async () => {
    answers["automations:tryOnUpload"] = () => ({ runId: "run_2", fileName: "song.mp3" });
    await run(tryAutomation, { automationId: "auto_9", uploadId: "up_1" });
    expect(calls[0]?.args).toEqual({ automationId: "auto_9", uploadId: "up_1" });
  });

  it("gives the dashboard's own reason when it cannot", async () => {
    answers["automations:tryOnUpload"] = () => {
      throw Object.assign(new Error("x"), {
        data: {
          message: "There are no uploads to try it on. Upload a file on the Uploads page first.",
        },
      });
    };
    await expect(run(tryAutomation, {})).rejects.toThrow(/Upload a file on the Uploads page/);
  });
});

describe("check_run", () => {
  it("reads each step in canvas order, with what it made", () => {
    const report = runReport(
      runView("done", [
        {
          nodeId: "caption",
          status: "done",
          error: null,
          outputs: ["https://s3.test/b/out/clip-1-captioned.mp4?X-Amz-Signature=abc"],
          retries: 0,
        },
        {
          nodeId: "clips",
          status: "done",
          error: null,
          outputs: ["https://s3.test/b/out/clip-1.mp4", "https://s3.test/b/out/clip-2.mp4"],
          retries: 1,
        },
      ]),
    );
    expect(report.finished).toBe(true);
    expect(report.address).toBe("/automations/auto_1/runs/run_1");
    expect(report.steps).toEqual([
      {
        id: "clips",
        type: "clips",
        name: "Cut into short clips",
        status: "done",
        error: null,
        made: ["clip-1.mp4", "clip-2.mp4"],
        madeCount: 2,
        triedAgain: 1,
      },
      {
        id: "caption",
        type: "step:video-caption",
        name: null,
        status: "done",
        error: null,
        made: ["clip-1-captioned.mp4"],
        madeCount: 1,
        triedAgain: 0,
      },
    ]);
  });

  it("waits while the run is going, and answers once it stops", async () => {
    let asked = 0;
    answers["runs:get"] = () =>
      ++asked < 2
        ? runView("running", [
            { nodeId: "clips", status: "running", error: null, outputs: [], retries: 0 },
          ])
        : runView("failed", [
            {
              nodeId: "clips",
              status: "failed",
              error: "The toolkit could not read the file.",
              outputs: [],
              retries: 2,
            },
          ]);
    const report = (await run(checkRun, { runId: "run_1", waitSeconds: 10 })) as ReturnType<
      typeof runReport
    >;
    expect(asked).toBe(2);
    expect(report.status).toBe("failed");
    expect(report.steps[0]?.error).toBe("The toolkit could not read the file.");
    expect(report.steps[1]?.status).toBe("pending");
  }, 15_000);

  it("does not wait on a run that is waiting for a person", async () => {
    answers["runs:get"] = () => runView("waiting", []);
    const report = (await run(checkRun, { runId: "run_1", waitSeconds: 60 })) as ReturnType<
      typeof runReport
    >;
    expect(report.status).toBe("waiting");
    expect(report.finished).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("says so when there is no such run", async () => {
    answers["runs:get"] = () => null;
    await expect(run(checkRun, { runId: "nope", waitSeconds: 0 })).rejects.toThrow(/no such run/);
  });
});
