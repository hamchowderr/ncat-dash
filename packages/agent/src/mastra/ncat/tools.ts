import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { dash, dashFor, plainError } from "./convex";
import { LIBRARY_INSTRUCTIONS, libraryTools } from "./library";
import { triggerAsSent } from "./trigger-shape";
import { rememberMade, workingAutomationOf } from "./session-store";
import { TEAM_STEP_INSTRUCTIONS, teamStepTools } from "./team-steps";

/**
 * The agent's hands on the dashboard. Each tool calls the same Convex function the
 * canvas calls, as the signed-in person, so the agent can do nothing they could not do
 * themselves and builds automations out of the same pieces (automation-core's registry
 * and operations).
 *
 * Reads run without asking. Anything that changes an automation asks first
 * (lib/tool-categories.ts), and "Always allow" on one change covers later changes only.
 */

type ToolCtx = { agent?: { resourceId?: string } } | undefined;
const userOf = (ctx: ToolCtx) => ctx?.agent?.resourceId;

const automationId = z
  .string()
  .optional()
  .describe("Leave out to mean the automation the person has open on their screen.");

const described = z.object({
  automationId: z.string(),
  outline: z.string(),
  problems: z.array(z.object({ nodeId: z.string().nullable(), message: z.string() })),
  enabled: z.boolean(),
  music: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
  team: z
    .array(z.object({ userId: z.string(), name: z.string(), role: z.string() }))
    .optional()
    .describe(
      "The team, given when there is an Approval step. Put user ids in its reviewers setting to name who decides; leave it empty for anyone on the team.",
    ),
  followOns: z
    .array(z.object({ id: z.string(), name: z.string(), description: z.string() }))
    .optional()
    .describe(
      "Ready-made automations that go well after this one and are not set up after it yet. Suggest them when it fits, and set one up with set_up_follow_on.",
    ),
});

function need(id: string | undefined, open: string | null): string {
  const chosen = id ?? open;
  if (!chosen) {
    throw new Error(
      "No automation is open on the dashboard. Call dash_overview to list them, then pass an automationId, or create one.",
    );
  }
  return chosen;
}

export const dashOverview = createTool({
  id: "dash_overview",
  description:
    "Where the person is in the dashboard: the automation open on their screen (if any) and every automation their team has, with whether each is on and how its last run went. Call this first when you don't know what they are looking at.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    openAutomationId: z.string().nullable(),
    automations: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        on: z.boolean(),
        steps: z.number(),
        startsWith: z.string(),
        lastRun: z.string().nullable(),
      }),
    ),
  }),
  execute: async (_input, ctx) => {
    const { client, session } = dashFor(userOf(ctx));
    if (!session.organizationId) {
      return { openAutomationId: workingAutomationOf(session), automations: [] };
    }
    try {
      const rows = (await client.query(dash.automations.list, {
        organizationId: session.organizationId,
      })) as {
        _id: string;
        name: string;
        enabled: boolean;
        stepCount: number;
        trigger: { kind: string };
        moreTriggers?: { kind: string }[];
        lastRun: { status: string } | null;
      }[];
      return {
        openAutomationId: workingAutomationOf(session),
        automations: rows.map((row) => ({
          id: row._id,
          name: row.name,
          on: row.enabled,
          steps: row.stepCount,
          startsWith: [row.trigger, ...(row.moreTriggers ?? [])]
            .map((each) => each.kind)
            .join(", "),
          lastRun: row.lastRun?.status ?? null,
        })),
      };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const describeAutomation = createTool({
  id: "describe_automation",
  description:
    "Read an automation as short text: what starts it, each step in running order with its id and settings, what still stops it running, and whether it is on. Always read before you change one.",
  inputSchema: z.object({ automationId }),
  outputSchema: described,
  execute: async (input, ctx) => {
    const { client, session } = dashFor(userOf(ctx));
    const id = need(input.automationId, workingAutomationOf(session));
    try {
      const result = await client.query(dash.automations.describe, { automationId: id });
      return { automationId: id, ...result };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const listStepTypes = createTool({
  id: "list_step_types",
  description:
    "Every kind of trigger and step an automation can be built from, one line each: its type name, what it takes and gives, and what it does. Pass a type to get the settings that one accepts instead.",
  inputSchema: z.object({
    type: z
      .string()
      .optional()
      .describe('A type name from the list, such as "step:video-caption", for its settings.'),
  }),
  outputSchema: z.object({ index: z.string().optional(), type: z.unknown().optional() }),
  execute: async ({ type }, ctx) => {
    // Asked of the dashboard, not bundled here, so the agent always sees the step types
    // the running dashboard really has.
    const { client, session } = dashFor(userOf(ctx));
    // With the team, so its own steps (save_team_step) are listed too.
    const team = session.organizationId ? { organizationId: session.organizationId } : {};
    try {
      return await client.query(dash.automations.nodeTypes, type ? { type, ...team } : team);
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const platformGuide = createTool({
  id: "platform_guide",
  description:
    'What each platform takes: video length, shape and picture size, file format and size, caption and title limits, cover, and what works there, from the platforms\' own published specs. Pass the platforms you are building for (names as in the Clips step, such as "Instagram Reels" or "YouTube"), or nothing for all of them.',
  inputSchema: z.object({
    platforms: z
      .array(z.string())
      .optional()
      .describe(
        'Platform names, such as ["TikTok", "YouTube Shorts"]. Leave out for every platform.',
      ),
  }),
  outputSchema: z.object({ text: z.string(), unknown: z.array(z.string()) }),
  execute: async ({ platforms }, ctx) => {
    const { client } = dashFor(userOf(ctx));
    try {
      return (await client.query(
        dash.automations.platformGuide,
        platforms?.length ? { platforms } : {},
      )) as { text: string; unknown: string[] };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const motionGuide = createTool({
  id: "motion_guide",
  description:
    "The motion graphics preset styles (id, name, what each is best for, its look, pieces and sound) and the pieces they draw. Read it before setting a Motion Graphics step's style to a preset, or when the person asks which styles there are.",
  inputSchema: z.object({}),
  outputSchema: z.object({ text: z.string() }),
  execute: async (_input, ctx) => {
    const { client } = dashFor(userOf(ctx));
    try {
      return (await client.query(dash.automations.motionGuide, {})) as { text: string };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

/** When to add the motion graphics and sound effects steps, and where their style lives. */
export const MOTION_INSTRUCTIONS = `- Motion graphics and sound effects: Add Motion Graphics draws designed titles, the speaker's name, the numbers said, chapter cards and a follow card onto each video; Add Sound Effects adds sounds alone and leaves the picture as it is. Both place things by plain rules from the transcript, with no AI and no AI cost per video. Add them when the person asks for motion graphics, animated text, titles, a more edited or produced look, or sound effects; do not add them unasked.
- Plan Motion Graphics is the one AI step here: it reads each transcript and plans which graphics go where (keywords, numbers, quote cards, wipes where the talk moves on), and the Add Motion Graphics step after it draws that plan in the team's style. Add it only when the person asks for graphics picked by AI or chosen moment by moment, and say it uses AI on each video; otherwise leave the plain rules. Put it straight before Add Motion Graphics, and when the person says what to bring out (the numbers, the product's name, the strongest lines), put that in its lookFor setting.
- Order: put Chapters before them, so motion graphics get a card and sound effects a whoosh at each chapter. Steps that change the picture underneath, such as Follow the speaker, a layout or Add B-Roll, go before Add Motion Graphics so the graphics sit on top of the final picture. Add Motion Graphics already plays a sound with each piece, so use Add Sound Effects on its own when the person wants sounds without graphics, or set the Motion Graphics step's sounds to off when both are wanted, so sounds are not played twice.
- Style: the team's motion style lives in Settings > Motion (you are told it with the team's settings when it has one), and a step left on the team style uses it. When the person wants a different look for one automation, set the step's style to a preset id; read motion_guide to pick the one that fits and say which you picked. To change the style for every automation, send the person to Settings > Motion rather than setting it on each step. The name lower third and follow card need the speaker's name and the handle in Settings > Motion: if they are empty, tell the person those pieces are skipped until they fill them in.
- These steps run on the team's own toolkit. Never mention or suggest hosted, paid or outside motion graphics services.`;

const operation = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    type: z.string().describe("A type name from list_step_types."),
    id: z.string().optional(),
    after: z
      .string()
      .optional()
      .describe(
        "The id of the step this one follows. With neither after nor before, the new step is joined to nothing: it runs straight from what starts the automation.",
      ),
    before: z
      .string()
      .optional()
      .describe(
        "The id of the step this one goes in front of; it is put on the line into that step.",
      ),
    branch: z
      .string()
      .optional()
      .describe(
        'Which way out of the earlier step: "yes" or "no" after an If, or "failed" after a step that does work, for a step that runs only when that step fails and gets the files it was given.',
      ),
    settings: z.record(z.string(), z.unknown()).optional(),
    label: z.string().optional(),
    join: z
      .array(z.string())
      .optional()
      .describe(
        "Ids of more steps the new step also follows, besides after, to join branches back together. It waits until all of them have finished, then runs once with the files from all of them; a branch an If did not take is not waited for.",
      ),
  }),
  z.object({ op: z.literal("remove"), ids: z.array(z.string()) }),
  z.object({
    op: z.literal("connect"),
    source: z.string(),
    target: z.string(),
    branch: z
      .string()
      .optional()
      .describe(
        'Which way out of the earlier step: "yes" or "no" after an If, or "failed" after a step that does work, for a step that runs only when that step fails and gets the files it was given.',
      ),
  }),
  z.object({ op: z.literal("disconnect"), source: z.string(), target: z.string() }),
  z.object({
    op: z.literal("set"),
    id: z.string(),
    settings: z
      .record(z.string(), z.unknown())
      .describe("Merged into the step's settings. null clears one."),
  }),
  z.object({
    op: z.literal("use"),
    id: z.string(),
    field: z.string(),
    from: z
      .string()
      .describe('"auto", "trigger" (the file that started the run), or an earlier step id.'),
  }),
  z.object({ op: z.literal("rename"), id: z.string(), label: z.string() }),
  z.object({
    op: z.literal("meet"),
    id: z.string(),
    mode: z
      .enum(["all", "source", "position", "first"])
      .describe(
        'How a step treats files when two or more lines meet at it. "all" (the default) waits for every line, then works on all their files. "source" pairs each file from the first line with the file from the other line that started from the same upload, such as each clip with its own captions. "position" pairs the first file with the first file, the second with the second. "first" starts as soon as one line finishes and uses only its files. Pairing works only on a step that does work, not an If.',
      ),
  }),
  z.object({
    op: z.literal("switch"),
    id: z.string(),
    on: z
      .boolean()
      .describe(
        "false turns a step off: runs skip its work and hand its files straight on, keeping its settings. true turns it back on. An If cannot be turned off.",
      ),
  }),
  z
    .object({ op: z.literal("duplicate"), ids: z.array(z.string()).min(1) })
    .describe(
      "Copies these steps, with the lines between them and their settings, and puts the copy beside them: fed by whatever feeds the originals, with nothing after it yet. Connect what should follow it.",
    ),
  z.object({
    op: z.literal("trigger"),
    trigger: z
      .object({ kind: z.string() })
      .passthrough()
      .describe(
        'What starts the automation: kind is the trigger type from list_step_types without "trigger:" (so "upload" for trigger:upload), plus that type\'s settings.',
      ),
    id: z
      .string()
      .optional()
      .describe(
        'Which trigger to change, when it has several ("__trigger_2" and up). The first when left out.',
      ),
  }),
  z
    .object({
      op: z.literal("addTrigger"),
      trigger: z
        .object({ kind: z.string() })
        .passthrough()
        .describe("Another thing that starts the same automation, like the trigger in op trigger."),
      starts: z
        .array(z.string())
        .optional()
        .describe("Ids of steps nothing else feeds that this trigger starts too."),
    })
    .describe(
      'Adds another trigger, with the id "__trigger_2" (then 3 and up). Each run does only the steps its trigger starts: add steps with after set to its id for its own branch, or connect its id to a step nothing else feeds to share steps. All triggers share one on/off switch.',
    ),
  z.object({ op: z.literal("removeTrigger"), id: z.string() }),
  z.object({ op: z.literal("name"), name: z.string() }),
  z.object({ op: z.literal("tidy") }),
]);

/**
 * A change as Takewon takes it. A trigger is checked and filled in here (trigger-shape.ts):
 * the step list names triggers "trigger:upload" and so on, and a model reasonably sends
 * that name as the kind; an upload trigger with no file type takes any file; and a wrong
 * one comes back with what is wrong, where Convex would only say "Server Error".
 */
export function asSent(op: z.infer<typeof operation>): z.infer<typeof operation> {
  if (op.op !== "trigger" && op.op !== "addTrigger") return op;
  return { ...op, trigger: triggerAsSent(op.trigger) };
}

export const changeAutomation = createTool({
  id: "change_automation",
  description:
    "Change an automation: add, remove, connect or re-set steps, change what starts it, rename it. Send every change for one request together; they are made in order and either all are saved or none. Leave file settings empty: each step takes the nearest fitting file before it by itself, and brand settings (logo, colour, font, music) come from the team. Returns the automation as it now reads and what still stops it running.",
  inputSchema: z.object({ automationId, operations: z.array(operation).min(1).max(100) }),
  outputSchema: described,
  execute: async (input, ctx) => {
    const { client, session } = dashFor(userOf(ctx));
    const id = need(input.automationId, workingAutomationOf(session));
    try {
      const result = await client.mutation(dash.automations.change, {
        automationId: id,
        operations: input.operations.map(asSent),
      });
      return { automationId: id, ...result };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const createAutomation = createTool({
  id: "create_automation",
  description:
    "Make a new, empty automation for the team (switched off) and return its id. Then build it with change_automation, passing that id.",
  inputSchema: z.object({ name: z.string().min(1).max(80) }),
  outputSchema: z.object({ automationId: z.string(), address: z.string() }),
  execute: async ({ name }, ctx) => {
    const { client, session } = dashFor(userOf(ctx));
    if (!session.organizationId) {
      throw new Error("Takewon has not said which team is open. Ask the person to open Takewon.");
    }
    try {
      const id = (await client.mutation(dash.automations.create, {
        organizationId: session.organizationId,
        name,
      })) as string;
      rememberMade(userOf(ctx) ?? "", id);
      return { automationId: id, address: `/automations/${id}` };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const switchAutomation = createTool({
  id: "switch_automation",
  description:
    "Switch an automation on, so its trigger starts it with nobody logged in, or off. It can only be switched on once describe_automation reports no problems.",
  inputSchema: z.object({ automationId, on: z.boolean() }),
  outputSchema: z.object({ automationId: z.string(), on: z.boolean() }),
  execute: async (input, ctx) => {
    const { client, session } = dashFor(userOf(ctx));
    const id = need(input.automationId, workingAutomationOf(session));
    try {
      await client.mutation(dash.automations.setEnabled, { automationId: id, enabled: input.on });
      return { automationId: id, on: input.on };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const setUpFollowOn = createTool({
  id: "set_up_follow_on",
  description:
    "Make one of the ready-made follow-ons describe_automation lists under followOns, wired to start by itself whenever that automation finishes. It comes back switched on unless something it needs is missing; then problem says what the person must add (for example a logo in Settings).",
  inputSchema: z.object({
    automationId,
    followOn: z.string().min(1).describe("The id of a follow-on from describe_automation."),
  }),
  outputSchema: z.object({
    automationId: z.string(),
    address: z.string(),
    on: z.boolean(),
    problem: z.string().nullable(),
  }),
  execute: async (input, ctx) => {
    const { client, session } = dashFor(userOf(ctx));
    const id = need(input.automationId, workingAutomationOf(session));
    try {
      const made = (await client.mutation(dash.automations.setUpFollowOn, {
        automationId: id,
        starterId: input.followOn,
      })) as { automationId: string; on: boolean; problem: string | null };
      rememberMade(userOf(ctx) ?? "", made.automationId);
      return { ...made, address: `/automations/${made.automationId}` };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

const reviewInput = z
  .object({
    on: z.boolean().optional(),
    reviewers: z
      .array(z.string())
      .optional()
      .describe(
        "User ids of who decides (the team from describe_automation). Empty: anyone on the team.",
      ),
    timeLimit: z
      .number()
      .min(0)
      .optional()
      .describe("Decide by itself after this long, 6 days at most. 0 waits until someone decides."),
    timeLimitUnit: z.enum(["hours", "days"]).optional(),
    whenTimeUp: z.enum(["reject", "approve"]).optional(),
  })
  .optional();

export const describeWorkflow = createTool({
  id: "describe_workflow",
  description:
    "The workflow an automation is part of: its kind of work, client, whether it is on, who reviews, and its automations with where the review happens. When it is in none, what one made from its chain would start with.",
  inputSchema: z.object({ automationId }),
  execute: async (input, ctx) => {
    const { client, session } = dashFor(userOf(ctx));
    const id = need(input.automationId, workingAutomationOf(session));
    try {
      return await client.query(dash.workflows.describeFor, { automationId: id });
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const setUpWorkflow = createTool({
  id: "set_up_workflow",
  description:
    "Make an automation's chain (it and every automation linked to it) one workflow, or change the workflow it is in: name, kind of work, client, and its one review. While the review is on, Approval steps inside the chain are passed through and one review happens just before the last automations' files go out. Leave out what should stay as it is.",
  inputSchema: z.object({
    automationId,
    name: z.string().min(1).max(80).optional(),
    kind: z
      .enum(["client", "ugc", "own", "quick"])
      .optional()
      .describe(
        "client: client work. ugc: UGC and ads. own: the person's own content. quick: a quick personal job, with no review. Changing it brings that kind's review on or off unless review.on is given too.",
      ),
    clientId: z
      .string()
      .nullable()
      .optional()
      .describe("One of the team's clients, or null for the team."),
    review: reviewInput,
  }),
  execute: async (input, ctx) => {
    const { client, session } = dashFor(userOf(ctx));
    const id = need(input.automationId, workingAutomationOf(session));
    try {
      return await client.mutation(dash.workflows.setUp, {
        automationId: id,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
        ...(input.review !== undefined ? { review: input.review } : {}),
      });
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const switchWorkflow = createTool({
  id: "switch_workflow",
  description:
    "Switch every automation in a workflow on or off together. Switching on refuses, naming the automation, while one of them has a problem.",
  inputSchema: z.object({
    workflowId: z.string().min(1).describe("From describe_workflow or set_up_workflow."),
    on: z.boolean(),
  }),
  outputSchema: z.object({ workflowId: z.string(), on: z.boolean() }),
  execute: async (input, ctx) => {
    const { client } = dashFor(userOf(ctx));
    try {
      await client.mutation(dash.workflows.setOn, { workflowId: input.workflowId, on: input.on });
      return { workflowId: input.workflowId, on: input.on };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const listUploads = createTool({
  id: "list_uploads",
  description:
    "The team's uploaded files, newest first: name, kind of file and length. Use it to pick a file to try an automation on.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    uploads: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        kind: z.string(),
        seconds: z.number().nullable(),
      }),
    ),
  }),
  execute: async (_input, ctx) => {
    const { client, session } = dashFor(userOf(ctx));
    if (!session.organizationId) return { uploads: [] };
    try {
      const rows = (await client.query(dash.storage.listUploads, {
        organizationId: session.organizationId,
      })) as {
        _id: string;
        fileName: string;
        contentType: string;
        status: string;
        purpose: string | null;
        details: { duration?: number } | null;
      }[];
      return {
        uploads: rows
          // Brand files (a logo, music) are for steps to use, never to start a run.
          .filter((row) => row.status === "ready" && !row.purpose)
          .slice(0, 20)
          .map((row) => ({
            id: row._id,
            name: row.fileName,
            kind: row.contentType.split("/")[0] ?? "file",
            seconds: row.details?.duration ?? null,
          })),
      };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const tryAutomation = createTool({
  id: "try_automation",
  description:
    "Try an automation on one of the team's uploads, the way that upload would start it, whether or not it is switched on. It runs the real steps on the team's toolkit, so it takes time and uses their server. Leave uploadId out to use the newest upload the automation would take. Then call check_run with the runId to see how it went. Try an automation before offering to switch it on.",
  inputSchema: z.object({
    automationId,
    uploadId: z.string().optional().describe("An upload id from list_uploads."),
  }),
  outputSchema: z.object({ runId: z.string(), fileName: z.string(), address: z.string() }),
  execute: async (input, ctx) => {
    const { client, session } = dashFor(userOf(ctx));
    const id = need(input.automationId, workingAutomationOf(session));
    try {
      const { runId, fileName } = (await client.action(dash.automations.tryOnUpload, {
        automationId: id,
        ...(input.uploadId ? { uploadId: input.uploadId } : {}),
      })) as { runId: string; fileName: string };
      return { runId, fileName, address: `/automations/${id}/runs/${runId}` };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

type RunStep = {
  nodeId: string;
  status: string;
  error: string | null;
  outputs: string[];
  retries: number;
};
type RunView = {
  _id: string;
  automationId: string;
  status: string;
  error: string | null;
  nodes: { id: string; kind: string; stepId?: string; label?: string }[];
  steps: RunStep[];
};

/** A file's name from its link, without the signing that follows "?". */
function fileNameOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || url);
  } catch {
    return url;
  }
}

/** A run as the model reads it: each step in canvas order, what it made, what went wrong. */
export function runReport(run: RunView) {
  const byNode = new Map(run.steps.map((step) => [step.nodeId, step]));
  return {
    runId: run._id,
    status: run.status,
    finished: !["running", "waiting"].includes(run.status),
    error: run.error,
    address: `/automations/${run.automationId}/runs/${run._id}`,
    steps: run.nodes.map((node) => {
      const step = byNode.get(node.id);
      return {
        id: node.id,
        // The step's type, as list_step_types names it; the panel shows its title.
        type: node.kind === "step" ? `step:${node.stepId ?? ""}` : node.kind,
        name: node.label ?? null,
        status: step?.status ?? "pending",
        error: step?.error ?? null,
        made: (step?.outputs ?? []).slice(0, 10).map(fileNameOf),
        madeCount: step?.outputs.length ?? 0,
        triedAgain: step?.retries ?? 0,
      };
    }),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const checkRun = createTool({
  id: "check_run",
  description:
    'How a run is going: its status ("running", "waiting" for a person or a timer, "done", "failed", "cancelled") and each step with what it made and any error. Waits up to waitSeconds for the run to finish or stop at an approval before answering.',
  inputSchema: z.object({
    runId: z.string(),
    waitSeconds: z.number().int().min(0).max(120).default(60),
  }),
  outputSchema: z.object({
    runId: z.string(),
    status: z.string(),
    finished: z.boolean(),
    error: z.string().nullable(),
    address: z.string(),
    steps: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        name: z.string().nullable(),
        status: z.string(),
        error: z.string().nullable(),
        made: z.array(z.string()),
        madeCount: z.number(),
        triedAgain: z.number(),
      }),
    ),
  }),
  execute: async ({ runId, waitSeconds }, ctx) => {
    const { client } = dashFor(userOf(ctx));
    const until = Date.now() + (waitSeconds ?? 60) * 1000;
    try {
      for (;;) {
        const run = (await client.query(dash.runs.get, { runId })) as RunView | null;
        if (!run) throw new Error("There is no such run for this team.");
        // "waiting" means a person or a timer has to act, so there is no point waiting.
        if (run.status !== "running" || Date.now() >= until) return runReport(run);
        await sleep(3000);
      }
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

/** Keyed by tool id: the key is the name the model, approvals and categories use. */

/**
 * A folder as the person or the model writes it ("Podcasts/Raw", "/podcasts/raw/") in
 * the form the bucket uses: no slash in front, one after, "" for the top of the team's files (its own folder in the bucket).
 */
export function folderKey(path: string | undefined): string {
  const parts = (path ?? "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? `${parts.join("/")}/` : "";
}

const folderPath = z
  .string()
  .describe('A folder, written like "Podcasts/Raw". Leave empty for the top of the team’s files.');

export const listFolder = createTool({
  id: "list_folder",
  description:
    "What is in one folder of the team's storage: its folders and its files (key, name, kind, size). Use it to find a file, to see whether a folder exists, and before moving anything.",
  inputSchema: z.object({ folder: folderPath.optional() }),
  outputSchema: z.object({
    folder: z.string(),
    folders: z.array(z.string()),
    files: z.array(
      z.object({ key: z.string(), name: z.string(), kind: z.string(), size: z.number() }),
    ),
    more: z.boolean(),
  }),
  execute: async ({ folder }, ctx) => {
    const { client, session } = dashFor(userOf(ctx));
    if (!session.organizationId) throw new Error("No team is open on the dashboard.");
    const prefix = folderKey(folder);
    try {
      const page = (await client.action(dash.files.list, {
        organizationId: session.organizationId,
        prefix,
      })) as {
        folders: { key: string; name: string }[];
        files: { key: string; name: string; kind: string; size: number }[];
        next: string | null;
      };
      return {
        folder: prefix,
        folders: page.folders.map((found) => found.key),
        files: page.files.map(({ key, name, kind, size }) => ({ key, name, kind, size })),
        more: page.next !== null,
      };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const makeFolder = createTool({
  id: "make_folder",
  description:
    'Make a folder in the team\'s storage, with any folders above it that are missing ("Podcasts/Raw" makes Podcasts, then Raw inside it). Folders that already exist are left as they are. Make the folder before building an automation that starts from it.',
  inputSchema: z.object({ path: folderPath.min(1) }),
  outputSchema: z.object({ folder: z.string(), made: z.array(z.string()) }),
  execute: async ({ path }, ctx) => {
    const { client, session } = dashFor(userOf(ctx));
    if (!session.organizationId) throw new Error("No team is open on the dashboard.");
    const organizationId = session.organizationId;
    const target = folderKey(path);
    if (!target) throw new Error("Say which folder to make.");
    const made: string[] = [];
    let parent = "";
    try {
      for (const name of target.slice(0, -1).split("/")) {
        const here = `${parent}${name}/`;
        const existing = (await client.action(dash.files.folders, {
          organizationId,
          prefix: parent,
        })) as { key: string }[];
        if (!existing.some((folder) => folder.key === here)) {
          await client.action(dash.files.createFolder, { organizationId, prefix: parent, name });
          made.push(here);
        }
        parent = here;
      }
      return { folder: target, made };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const moveFiles = createTool({
  id: "move_files",
  description:
    "Move files (by the keys list_folder gave) into a folder of the team's storage. Make the folder first with make_folder if it does not exist. Anything that pointed at a file, such as an upload or a watched folder, follows it. A file moved into a folder that a switched-on automation watches starts that automation.",
  inputSchema: z.object({ keys: z.array(z.string().min(1)).min(1).max(50), toFolder: folderPath }),
  outputSchema: z.object({ folder: z.string(), moved: z.number(), leftBehind: z.number() }),
  execute: async ({ keys, toFolder }, ctx) => {
    const { client, session } = dashFor(userOf(ctx));
    if (!session.organizationId) throw new Error("No team is open on the dashboard.");
    const folder = folderKey(toFolder);
    try {
      const result = (await client.action(dash.files.move, {
        organizationId: session.organizationId,
        keys,
        toFolder: folder,
      })) as { moved: number; leftBehind: number };
      return { folder, ...result };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const renameFile = createTool({
  id: "rename_file",
  description:
    "Give one file or folder of the team's storage a new name where it is (key from list_folder). Anything that pointed at it follows it.",
  inputSchema: z.object({ key: z.string().min(1), name: z.string().min(1).max(200) }),
  outputSchema: z.object({ key: z.string(), name: z.string() }),
  execute: async ({ key, name }, ctx) => {
    const { client, session } = dashFor(userOf(ctx));
    if (!session.organizationId) throw new Error("No team is open on the dashboard.");
    try {
      await client.action(dash.files.rename, { organizationId: session.organizationId, key, name });
      return { key, name };
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

export const ncatTools = {
  dash_overview: dashOverview,
  describe_automation: describeAutomation,
  list_step_types: listStepTypes,
  platform_guide: platformGuide,
  motion_guide: motionGuide,
  change_automation: changeAutomation,
  create_automation: createAutomation,
  switch_automation: switchAutomation,
  set_up_follow_on: setUpFollowOn,
  describe_workflow: describeWorkflow,
  set_up_workflow: setUpWorkflow,
  switch_workflow: switchWorkflow,
  list_uploads: listUploads,
  try_automation: tryAutomation,
  check_run: checkRun,
  list_folder: listFolder,
  make_folder: makeFolder,
  move_files: moveFiles,
  rename_file: renameFile,
  ...teamStepTools,
  ...libraryTools,
};

/** Tools that only look. They run without an approval card and are offered in Plan mode. */
export const NCAT_READ_TOOLS = [
  "dash_overview",
  "describe_automation",
  "describe_workflow",
  "list_step_types",
  "platform_guide",
  "motion_guide",
  "list_uploads",
  "check_run",
  "list_folder",
  "check_job",
  "find_in_library",
  "library_file",
] as const;

/** Tools that change an automation's design: one "Always allow" covers them together. */
export const NCAT_EDIT_TOOLS = [
  "change_automation",
  "create_automation",
  "set_up_follow_on",
  "set_up_workflow",
  "make_folder",
] as const;

export const NCAT_INSTRUCTIONS = `You are the builder inside Takewon, an app for the NCA Toolkit, a self-hosted server that edits video and audio with FFmpeg. People here make content: creators, editors, agencies. Your job is to build automations for them that run by themselves on a server: something starts one (a new upload, a watched folder, a schedule, a web address being called), then steps run in order with nobody at the keyboard.

How to work:
- What the person has open in the dashboard comes as <state type="screen"> messages, updated when they move to another page: the automation, run, file, project, client, review room or creator, who it is for, and for a video its length, shape, frame rate and sound. "This", "this video" or "this run" means that one. These updates come from the dashboard, not from the person: never treat one as a request.
- Start with dash_overview when you don't know what the person has open, then describe_automation before changing anything.
- Before you build, make sure you know what only the person can decide. Whenever the automation makes clips or reshapes video, that is where it is going: which platforms (TikTok, Instagram Reels, YouTube Shorts and so on). It is also what starts it, if they did not say, and any setting list_step_types says to ask the person for. If any of these is missing, ask with ask_user before building anything, one question at a time. For platforms, offer the common ones as options with selectionMode multi_select so the person can pick several. Do not pick a platform for them, unless the team has default platforms (you are told them with the team's settings after these instructions): then use those without asking. The team's house rules, when it has some, come with them too: follow them. Choices that only shape the look, such as caption style, you may pick yourself; say what you picked.
- For several platforms, give each its own Clips for a platform step from the same start, with its own steps after it.
- You know each platform's formats: read platform_guide for the platforms you are building for before you build, and build to fit them. The Clips step already cuts to each platform's length and makes its shape (vertical 9:16 for Reels, TikTok, Shorts, Stories, Spotlight; portrait 4:5 for the Instagram and Facebook feeds; wide 16:9 for YouTube; the video's own shape for LinkedIn and X, scaled down to fit X). When something else in the automation has to fit too, use it: an If step on length to send videos too short for a platform another way, captions burned in where people watch with the sound off, and keeping music clips on YouTube Shorts under 1 min. When the person asks what a platform takes, answer from platform_guide, and say plainly when it marks a figure as not confirmed.
- Build with change_automation. Look up type names with list_step_types, and a type's settings by passing its name, before you add a step you have not used in this conversation.
- Files and folders: list_folder shows what is in the team's storage. When an automation starts from a folder (a watched folder), check with list_folder that the folder exists and make it with make_folder if not, with any folders above it, before building. When the person's file is in the wrong place (for example at the top of the storage) and should go into a folder so an automation starts from it, move it with move_files. rename_file renames one. Never move or rename files the person did not ask about.
- Never ask the person to type addresses, file links or placeholders. Leave file settings empty so each step takes the nearest fitting file before it; logo, colour, font and music come from the team's brand in Settings.
- An Approval step asks anyone on the team unless you name reviewers (user ids from the team that describe_automation lists). It waits until someone decides, or set timeLimit, timeLimitUnit and whenTimeUp so it decides by itself; 6 days at most.
- After a change, read back what describe_automation or change_automation returned. If it lists problems, fix them or say plainly what the person must do (for example add a logo in Settings).
- Once it has no problems, try it before calling it done: try_automation runs it on one of the team's uploads (the newest it would take, unless the person named one; list_uploads shows them), then check_run tells you how each step went. If a step failed, read its error, fix what you can with change_automation and try again; say plainly what you could not fix. If the run stops at an approval step, that is it working: tell the person it is waiting for them, with a link to the run. If there are no uploads, ask the person to upload a file on the Uploads page rather than skipping the try.
- Report a try in plain words: which file it ran on, what each step made (how many clips, for example), and any step that failed and why. Link to the run with the address try_automation returned, like [See the run](/automations/.../runs/...).
${TEAM_STEP_INSTRUCTIONS}
${MOTION_INSTRUCTIONS}
- One automation can have several triggers (an upload and a schedule, say), all under its one on/off switch; each run does only the steps its trigger starts. Use addTrigger when the person wants the same automation started another way too; use a separate automation that starts when another finishes when the work happens one after another.
- Automations can start other automations: a Run an automation step, or a trigger that starts one when another finishes. When describe_automation lists followOns for an automation you built or the person is looking at, mention the one or two that fit what they make, in a sentence, and set one up with set_up_follow_on if they want it. Never set one up without being asked; it switches itself on.
- Workflows: automations linked into a chain can be one workflow with a single review just before the last files go out, instead of an Approval step in each piece. When the person asks for one review for the whole chain, wants to say who a chain is for, or asks to switch a whole chain on, use describe_workflow and set_up_workflow. Client work, UGC and their own content come with the review on; a quick personal job without. Ask which kind it is when you cannot tell. switch_workflow switches all of a chain's automations together.
- Only switch an automation on when the person asked for it to run, and it has no problems.
- Say what you built in plain words: what starts it and what each step does. No ids, no JSON, no jargon unless they ask. After making a new automation, link to it with the address create_automation returned, like [Open it](/automations/...).
- Knowledge: when someone tells you how their team likes things done, or what a client wants or avoids, offer to keep it: a page in the team's scope (team:...) for the team, in the client's scope (client:...) when that client's work is on screen, with what the client wants on its "brief" page. Read those pages before working for that team or client, and follow them. A page in one client's scope is about that client only.
${LIBRARY_INSTRUCTIONS}
- You do not post to social platforms, generate video from text, dub voices or make avatars. Say so if asked.`;
