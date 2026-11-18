import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { dash, dashFor, plainError } from "./convex";

/**
 * The agent writes the team's own FFmpeg steps. When no ready-made step does what the
 * person wants, it writes one FFmpeg compose request with a few plain settings, tries it
 * on one of the team's files, and saves it. Saved, it is a step like any other
 * ("step:team-…" in list_step_types), run by plain FFmpeg with no AI per video.
 */

type ToolCtx = { agent?: { resourceId?: string } } | undefined;
const userOf = (ctx: ToolCtx) => ctx?.agent?.resourceId;

const option = z.object({
  option: z.string().describe('An FFmpeg flag, such as "-c:v" or "-filter_complex"'),
  argument: z.union([z.string(), z.number()]).optional().describe("Its value, if it takes one"),
});

const blank = z.object({
  name: z
    .string()
    .describe('Lowercase letters, digits and _, such as "video_url" or "blur_amount". Written as {{name}} in the request.'),
  label: z.string().describe("What it is, in a few plain words, for the person filling it in."),
  kind: z
    .enum(["file", "text", "number", "color", "choice"])
    .describe(
      "file: a file link (always the whole file_url of an input). text: plain words (no quotes, colons, commas or brackets). number: with min/max. color: a name or #hex. choice: one of options.",
    ),
  default: z.union([z.string(), z.number()]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  whole: z.boolean().optional().describe("For a number that must be whole."),
  options: z.array(z.string()).optional().describe("For a choice: 2 to 20 values FFmpeg takes as they are."),
});

const template = z.object({
  title: z.string().describe('Short, plain and specific, such as "Blur the background behind a vertical video".'),
  description: z.string().describe("One or two sentences on what it makes, for the step list."),
  blanks: z.array(blank).max(12),
  primary: z
    .string()
    .nullable()
    .describe("The file setting that takes the file from the step before, usually the video. null when none should."),
  request: z
    .object({
      inputs: z.array(
        z.object({ file_url: z.string().describe("{{a file setting}}"), options: z.array(option).optional() }),
      ),
      filters: z.array(z.object({ filter: z.string() })).optional(),
      outputs: z.array(z.object({ options: z.array(option) })),
      global_options: z.array(option).optional(),
    })
    .describe(
      "The toolkit's /v1/ffmpeg/compose request, with {{name}} wherever a setting's value goes. Outputs need a format, such as -f mp4 with -c:v libx264.",
    ),
});

const fileValues = z
  .record(z.string(), z.string())
  .optional()
  .describe("For each file setting, an upload id from list_uploads.");
const otherValues = z
  .record(z.string(), z.union([z.string(), z.number()]))
  .optional()
  .describe("Values for the other settings; leave one out to use its default.");

export const tryTeamStep = createTool({
  id: "try_team_step",
  description:
    "Try an FFmpeg step you wrote, before saving it, on one of the team's uploads: it runs once on the team's toolkit. Then call check_job with the jobId until it is done, and look at what it made. Fix the request and try again until it works.",
  inputSchema: z.object({ step: template, files: fileValues, values: otherValues }),
  outputSchema: z.object({ jobId: z.string() }),
  execute: async ({ step, files, values }, ctx) => {
    const { client, session } = dashFor(userOf(ctx));
    if (!session.organizationId) throw new Error("Open the dashboard on a team first.");
    const filled: Record<string, string | number> = { ...(values ?? {}) };
    for (const [name, uploadId] of Object.entries(files ?? {})) {
      filled[name] = /^https?:\/\//.test(uploadId) ? uploadId : `upload:${uploadId}`;
    }
    try {
      return (await client.mutation(dash.teamSteps.tryOut, {
        organizationId: session.organizationId,
        template: step,
        values: filled,
      })) as { jobId: string };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

type Job = {
  status: string;
  outputs: string[];
  error: string | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A file's name from its link, without the signing that follows "?". */
function fileNameOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || url);
  } catch {
    return url;
  }
}

export const checkJob = createTool({
  id: "check_job",
  description:
    'How a step tried with try_team_step went: "queued", "running", "done" with the files it made, or "failed" with the toolkit\'s error. Waits up to waitSeconds for it to finish.',
  inputSchema: z.object({
    jobId: z.string(),
    waitSeconds: z.number().int().min(0).max(120).default(60),
  }),
  outputSchema: z.object({
    status: z.string(),
    finished: z.boolean(),
    made: z.array(z.string()),
    error: z.string().nullable(),
  }),
  execute: async ({ jobId, waitSeconds }, ctx) => {
    const { client } = dashFor(userOf(ctx));
    const until = Date.now() + (waitSeconds ?? 60) * 1000;
    try {
      for (;;) {
        const job = (await client.query(dash.jobs.get, { jobId })) as Job | null;
        if (!job) throw new Error("There is no such job for this team.");
        const finished = job.status === "done" || job.status === "failed";
        if (finished || Date.now() >= until) {
          return {
            status: job.status,
            finished,
            made: job.outputs.slice(0, 10).map(fileNameOf),
            error: job.error ? job.error.slice(0, 1500) : null,
          };
        }
        await sleep(3000);
      }
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const saveTeamStep = createTool({
  id: "save_team_step",
  description:
    "Save an FFmpeg step you wrote and tried as one of the team's own steps. It can then be added to any automation as step:<stepId>; people see it only inside the automations that use it. Pass stepId to change one already saved.",
  inputSchema: z.object({
    step: template,
    stepId: z.string().optional().describe("A saved team step's id, to change it rather than add one."),
  }),
  outputSchema: z.object({ stepId: z.string(), title: z.string(), type: z.string() }),
  execute: async ({ step, stepId }, ctx) => {
    const { client, session } = dashFor(userOf(ctx));
    if (!session.organizationId) throw new Error("Open the dashboard on a team first.");
    try {
      const saved = (await client.mutation(dash.teamSteps.save, {
        organizationId: session.organizationId,
        template: step,
        ...(stepId ? { stepId } : {}),
      })) as { stepId: string; title: string };
      return { ...saved, type: `step:${saved.stepId}` };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const teamStepTools = {
  try_team_step: tryTeamStep,
  check_job: checkJob,
  save_team_step: saveTeamStep,
};

export const TEAM_STEP_INSTRUCTIONS = `- When no step in list_step_types does what the person wants, write the team its own FFmpeg step: one /v1/ffmpeg/compose request with {{name}} where each setting goes, and only the settings a person would really change (a file setting for each input, then a few numbers, colours, choices or words). Try it with try_team_step on one of their uploads and check_job; fix it until it makes the right file. Then save it with save_team_step and add it to the automation as step:<stepId>. Say what the step does as part of the automation; do not call it a new step in a list. It runs as plain FFmpeg every time, with no AI.`;
