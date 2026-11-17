import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { dash, dashFor, plainError } from "./convex";
import { rememberMade, workingAutomationOf } from "./session-store";

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
        lastRun: { status: string } | null;
      }[];
      return {
        openAutomationId: workingAutomationOf(session),
        automations: rows.map((row) => ({
          id: row._id,
          name: row.name,
          on: row.enabled,
          steps: row.stepCount,
          startsWith: row.trigger.kind,
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
    const { client } = dashFor(userOf(ctx));
    try {
      return await client.query(dash.automations.nodeTypes, type ? { type } : {});
    } catch (caught) {
      throw new Error(plainError(caught));
    }
  },
});

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
  }),
  z.object({ op: z.literal("name"), name: z.string() }),
  z.object({ op: z.literal("tidy") }),
]);

/**
 * A change as the dashboard takes it. The step list names triggers "trigger:upload" and
 * so on, and a model reasonably sends that name as the kind; the dashboard wants "upload".
 */
export function asSent(op: z.infer<typeof operation>): z.infer<typeof operation> {
  if (op.op !== "trigger" || !op.trigger.kind.startsWith("trigger:")) return op;
  return { ...op, trigger: { ...op.trigger, kind: op.trigger.kind.slice("trigger:".length) } };
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
      throw new Error(
        "The dashboard has not said which team is open. Ask the person to open the dashboard.",
      );
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

/** Keyed by tool id: the key is the name the model, approvals and categories use. */
export const ncatTools = {
  dash_overview: dashOverview,
  describe_automation: describeAutomation,
  list_step_types: listStepTypes,
  change_automation: changeAutomation,
  create_automation: createAutomation,
  switch_automation: switchAutomation,
};

/** Tools that only look. They run without an approval card and are offered in Plan mode. */
export const NCAT_READ_TOOLS = ["dash_overview", "describe_automation", "list_step_types"] as const;

/** Tools that change an automation's design: one "Always allow" covers them together. */
export const NCAT_EDIT_TOOLS = ["change_automation", "create_automation"] as const;

export const NCAT_INSTRUCTIONS = `You are the builder inside a dashboard for the NCA Toolkit, a self-hosted server that edits video and audio with FFmpeg. People here make content: creators, editors, agencies. Your job is to build automations for them that run by themselves on a server: something starts one (a new upload, a watched folder, a schedule, a web address being called), then steps run in order with nobody at the keyboard.

How to work:
- Start with dash_overview when you don't know what the person has open, then describe_automation before changing anything.
- Build with change_automation. Look up type names with list_step_types, and a type's settings by passing its name, before you add a step you have not used in this conversation.
- Never ask the person to type addresses, file links or placeholders. Leave file settings empty so each step takes the nearest fitting file before it; logo, colour, font and music come from the team's brand in Settings.
- An Approval step asks anyone on the team unless you name reviewers (user ids from the team that describe_automation lists). It waits until someone decides, or set timeLimit, timeLimitUnit and whenTimeUp so it decides by itself; 6 days at most.
- After a change, read back what describe_automation or change_automation returned. If it lists problems, fix them or say plainly what the person must do (for example add a logo in Settings).
- Only switch an automation on when the person asked for it to run, and it has no problems.
- Say what you built in plain words: what starts it and what each step does. No ids, no JSON, no jargon unless they ask. After making a new automation, link to it with the address create_automation returned, like [Open it](/automations/...).
- You do not post to social platforms, generate video from text, dub voices or make avatars. Say so if asked.`;
