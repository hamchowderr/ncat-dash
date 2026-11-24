import { PRODUCT_NAME } from "@takewon/automation-core";
import { getStep } from "@takewon/step-catalog";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  httpAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { APPS, OPERATION_SCHEMA, RUN_APP_URI, SKILLS } from "./lib/mcpContent";
import { icon } from "./lib/mcpIcons";
import {
  EventRefused,
  handleMcp,
  type McpCallContext,
  type McpComplete,
  type McpData,
  type McpEventOccurrence,
  type McpEvents,
  type McpForm,
  type McpLink,
  type McpPrompt,
  type McpTask,
  type McpTasks,
  type McpTool,
  NeedsInput,
  StartedTask,
  ToolSaid,
  LEGACY_VERSIONS,
  MODERN_VERSIONS,
} from "./lib/mcpServer";
import { mcpResource } from "./lib/agentSignIn";
import { approvalView, membersOf, type TeamMembers } from "./lib/approvals";
import { decideApproval, incomingFiles, startRun } from "./lib/runner";
import { publishDraft, switchAutomation } from "./automations";
import { cancelRun } from "./runs";
import { withTeamSteps } from "./lib/teamSteps";

/**
 * The dashboard as an MCP server, at <Convex site>/mcp. An agent signs in with OAuth as a
 * person on one team (claude.ai connectors, Claude Code, Cursor), or sends one of the
 * team's keys (Settings, MCP). It can do what that person can in the dashboard for
 * automations: list them, build and change them (changes wait as a draft until published),
 * publish, switch them on or off, run one on a file, follow the run, and decide approvals.
 *
 * In chat apps that can show forms it asks the person directly where that helps: which
 * file to run on, whether to switch an automation on, and what should change when sending
 * an approval back. In apps that follow tasks (and do not show the run page), a run comes
 * back as a task the app follows to the end, and a review it reaches is asked as a form.
 */

const INSTRUCTIONS =
  "This is Takewon, a content automation dashboard. Each automation is a set of plain steps (cut clips, add captions, reframe, and so on) that runs by itself on the team's own toolkit, with no AI per video. Read the content-automations skill before building. list_automations and describe_automation show what the team has; create_automation and change_automation build (changes are kept as a draft until publish_automation makes them live); switch_automation switches one on or off; start_automation runs one on an upload or a file link; check_run shows how a run is going and the files it made. list_approvals shows what waits for someone to approve, and decide_approval approves it or sends it back when the person asks you to. A chain of linked automations can be one workflow (set_up_workflow) with a single review before its files go out.";

const SERVER_INFO = { name: "takewon", title: PRODUCT_NAME, version: "2.0.0" };

const automationId = { type: "string", description: "From list_automations or create_automation." };

/** An object's fields, for an output schema. Nothing is required, so extra fields still fit. */
const shape = (properties: Record<string, unknown>) => ({ type: "object", properties });
const list = (item: Record<string, unknown>) => shape({ items: { type: "array", items: item } });
const textOrNull = { type: ["string", "null"] };
const files = { type: "array", items: { type: "string" }, description: "Links to the files." };
const RUN_LINE = shape({
  run_id: { type: "string" },
  automation_id: { type: "string" },
  automation: { type: "string" },
  status: { type: "string", enum: ["running", "waiting", "done", "failed", "cancelled"] },
  started_at: { type: "string" },
  finished_at: textOrNull,
  error: { type: ["string", "null"] },
  address: { type: "string", description: "The run in the dashboard." },
});
const APPROVAL = shape({
  approval_id: { type: "string" },
  step: { type: "string" },
  waiting_since: { type: "string" },
  asked: { type: ["string", "array"], items: { type: "string" } },
  you_may_decide: { type: "boolean" },
  decide_by: textOrNull,
  when_time_up: textOrNull,
  files,
});

const TOOLS: McpTool[] = [
  {
    name: "list_automations",
    title: "List automations",
    description:
      "The team's automations: id, name, whether it is on, what usually starts it, whether it has an unpublished draft, and its latest run.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    icons: icon("workflow"),
    outputSchema: list(
      shape({
        automation_id: { type: "string" },
        name: { type: "string" },
        on: { type: "boolean" },
        starts_with: { type: "string" },
        steps: { type: "integer" },
        has_draft: { type: "boolean" },
        address: { type: "string" },
        latest_run: { anyOf: [RUN_LINE, { type: "null" }] },
      }),
    ),
  },
  {
    name: "describe_automation",
    title: "Describe an automation",
    description:
      "An automation as text: what starts it, each step in running order with its id, and what still stops it running. Read this before changing one. Shows the draft when there is one.",
    inputSchema: {
      type: "object",
      properties: { automation_id: automationId },
      required: ["automation_id"],
      additionalProperties: false,
    },
    readOnly: true,
    icons: icon("file-text"),
  },
  {
    name: "list_step_types",
    title: "List step types",
    description:
      'Every kind of trigger and step an automation can be built from, one line each. Pass a type (such as "step:video-caption") for the settings that one takes.',
    inputSchema: {
      type: "object",
      properties: { type: { type: "string" } },
      additionalProperties: false,
    },
    readOnly: true,
    icons: icon("blocks"),
  },
  {
    name: "create_automation",
    title: "Create an automation",
    description:
      "Makes a new, empty automation for the team, switched off, and returns its id and dashboard address. Build it with change_automation.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", minLength: 1, maxLength: 80 } },
      required: ["name"],
      additionalProperties: false,
    },
    readOnly: false,
    destructive: false,
    icons: icon("plus"),
    outputSchema: shape({ automation_id: { type: "string" }, address: { type: "string" } }),
  },
  {
    name: "set_up_follow_on",
    title: "Set up a follow-on automation",
    description:
      "Makes one of the ready-made follow-ons that describe_automation lists under followOns, wired to start by itself when that automation finishes. It is switched on straight away unless something it needs is missing, which problem then says. Returns its id and dashboard address.",
    inputSchema: {
      type: "object",
      properties: {
        automation_id: automationId,
        follow_on: {
          type: "string",
          description: "The id of a follow-on from describe_automation's followOns.",
        },
      },
      required: ["automation_id", "follow_on"],
      additionalProperties: false,
    },
    readOnly: false,
    destructive: false,
    icons: icon("git-branch-plus"),
  },
  {
    name: "change_automation",
    title: "Change an automation",
    description:
      "Adds, removes, connects or re-sets steps, changes what starts it, or renames it. Send every change for one request together: they are made in order and all are kept or none. Changes are kept as a draft; the published version keeps running until publish_automation (or someone in the dashboard) publishes the draft. Leave file settings empty: each step takes the nearest fitting file before it, and brand settings come from the team. Returns the automation as it now reads and what still stops it running.",
    inputSchema: {
      type: "object",
      properties: {
        automation_id: automationId,
        operations: { type: "array", minItems: 1, maxItems: 100, items: OPERATION_SCHEMA },
      },
      required: ["automation_id", "operations"],
      additionalProperties: false,
    },
    readOnly: false,
    icons: icon("pencil"),
  },
  {
    name: "publish_automation",
    title: "Publish an automation",
    description:
      'Makes an automation\'s draft its live version, so its next runs use the changes. An automation that is on stays on; a draft that could not run is refused and the live version carries on. Try the draft first (start_automation with version "draft") and publish when the person is happy with it.',
    inputSchema: {
      type: "object",
      properties: { automation_id: automationId },
      required: ["automation_id"],
      additionalProperties: false,
    },
    readOnly: false,
    icons: icon("upload"),
    outputSchema: shape({
      automation_id: { type: "string" },
      published: { type: "boolean" },
      on: { type: "boolean" },
      address: { type: "string" },
    }),
  },
  {
    name: "switch_automation",
    title: "Switch an automation on or off",
    description:
      "Switches an automation on, so what starts it (an upload, a folder, a schedule and so on) runs it by itself, or off. Switching on refuses, saying why, while something stops it running.",
    inputSchema: {
      type: "object",
      properties: { automation_id: automationId, on: { type: "boolean" } },
      required: ["automation_id", "on"],
      additionalProperties: false,
    },
    readOnly: false,
    icons: icon("power"),
    outputSchema: shape({
      automation_id: { type: "string" },
      on: { type: "boolean" },
      address: { type: "string" },
    }),
  },
  {
    name: "list_uploads",
    title: "List uploads",
    description: "The team's uploaded files, newest first, with the id start_automation takes.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
      additionalProperties: false,
    },
    readOnly: true,
    icons: icon("folder-open"),
    outputSchema: list(
      shape({
        upload_id: { type: "string" },
        name: { type: "string" },
        type: { type: "string" },
        size_bytes: { type: "number" },
        seconds: { type: ["number", "null"] },
        uploaded_at: { type: "string" },
      }),
    ),
  },
  {
    name: "start_automation",
    title: "Start an automation",
    description:
      'Runs one of the team\'s automations now, on an upload (upload_id from list_uploads) or a file link (file_url), whether it is on or off. Given neither, a chat app that shows forms asks the person which file. It runs the published version; pass version "draft" to try unpublished changes. Returns the run, for check_run.',
    inputSchema: {
      type: "object",
      properties: {
        automation_id: automationId,
        upload_id: { type: "string", description: "One of the team's uploads." },
        file_url: { type: "string", description: "Or a link to a file, starting with https://." },
        version: { type: "string", enum: ["live", "draft"], default: "live" },
      },
      required: ["automation_id"],
      additionalProperties: false,
    },
    readOnly: false,
    appUri: RUN_APP_URI,
    icons: icon("play"),
    outputSchema: shape({
      run_id: { type: "string" },
      automation: { type: "string" },
      status: { type: "string" },
      address: { type: "string" },
    }),
  },
  {
    name: "check_run",
    title: "Check a run",
    description:
      "How a run is going: running, waiting (for an approval), done, failed or cancelled; each step; and links to the files it finished.",
    inputSchema: {
      type: "object",
      properties: { run_id: { type: "string" } },
      required: ["run_id"],
      additionalProperties: false,
    },
    readOnly: true,
    appUri: RUN_APP_URI,
    icons: icon("activity"),
    outputSchema: {
      ...RUN_LINE,
      properties: {
        ...RUN_LINE.properties,
        steps: {
          type: "array",
          items: shape({
            step: { type: "string" },
            status: { type: "string" },
            error: textOrNull,
            files: { type: "integer" },
          }),
        },
        files,
        approval: { anyOf: [APPROVAL, { type: "null" }] },
      },
    },
  },
  {
    name: "list_runs",
    title: "List runs",
    description: "The team's latest runs, newest first, optionally of one automation.",
    inputSchema: {
      type: "object",
      properties: {
        automation_id: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
      additionalProperties: false,
    },
    readOnly: true,
    icons: icon("history"),
    outputSchema: list(RUN_LINE),
  },
  {
    name: "list_approvals",
    title: "List approvals",
    description:
      "Runs waiting at an Approval step or a workflow's review: which automation, since when, who is asked, whether the person you act for may decide, and the files to look at.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    appUri: RUN_APP_URI,
    icons: icon("list-checks"),
    outputSchema: shape({
      approvals: {
        type: "array",
        items: {
          ...APPROVAL,
          properties: {
            ...APPROVAL.properties,
            run_id: { type: "string" },
            automation: { type: "string" },
            address: { type: "string" },
          },
        },
      },
    }),
  },
  {
    name: "decide_approval",
    title: "Approve or send back",
    description:
      "Approves a waiting approval, so the run carries on with those files, or sends it back, which stops it there. Only when the person has said which: an approval is their check, so never decide one by yourself. The same people may decide as in the dashboard. A reason given when sending back shows on the run.",
    inputSchema: {
      type: "object",
      properties: {
        approval_id: { type: "string", description: "From list_approvals or check_run." },
        decision: { type: "string", enum: ["approve", "send_back"] },
        reason: {
          type: "string",
          maxLength: 500,
          description:
            "When sending back: what should change, in the person's words. Left out, a chat app that shows forms asks the person.",
        },
      },
      required: ["approval_id", "decision"],
      additionalProperties: false,
    },
    readOnly: false,
    icons: icon("circle-check"),
    outputSchema: shape({
      approval_id: { type: "string" },
      run_id: { type: "string" },
      decided: { type: "string", enum: ["approved", "sent back"] },
    }),
  },
  {
    name: "list_workflows",
    title: "List workflows",
    description:
      "The team's workflows: chains of linked automations with one review before their files go out. For each: its kind of work, client, whether it is on, who reviews and any time limit, and its automations, with where the review happens.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    icons: icon("git-fork"),
  },
  {
    name: "set_up_workflow",
    title: "Set up a workflow",
    description:
      "Makes the chain an automation is part of (it and every automation linked to it) into a workflow, or changes the workflow it is already in. While the review is on, Approval steps inside the chain are passed through and one review happens just before the last automations' files go out. Client work, UGC and your own content come with the review on; a quick personal job without. Leave out anything that should stay as it is.",
    inputSchema: {
      type: "object",
      properties: {
        automation_id: automationId,
        name: { type: "string", minLength: 1, maxLength: 80 },
        kind: {
          type: "string",
          enum: ["client", "ugc", "own", "quick"],
          description:
            "client: client work. ugc: UGC and ads. own: your own content. quick: a quick personal job. Changing it switches the review to that kind's default unless review.on is sent too.",
        },
        client_id: {
          type: ["string", "null"],
          description: "A client of the team, or null for the team itself.",
        },
        review: {
          type: "object",
          properties: {
            on: { type: "boolean" },
            reviewers: {
              type: "array",
              items: { type: "string" },
              description: "User ids of who decides. Empty: anyone on the team.",
            },
            time_limit: {
              type: "number",
              minimum: 0,
              description: "Decide by itself after this long; 0 waits until someone decides.",
            },
            time_limit_unit: { type: "string", enum: ["hours", "days"] },
            when_time_up: { type: "string", enum: ["reject", "approve"] },
          },
          additionalProperties: false,
        },
      },
      required: ["automation_id"],
      additionalProperties: false,
    },
    readOnly: false,
    icons: icon("settings-2"),
  },
  {
    name: "switch_workflow",
    title: "Switch a workflow on or off",
    description:
      "Switches every automation in a workflow on or off together. Switching on refuses, naming the automation, while one of them still has a problem.",
    inputSchema: {
      type: "object",
      properties: {
        workflow_id: { type: "string", description: "From list_workflows or set_up_workflow." },
        on: { type: "boolean" },
      },
      required: ["workflow_id", "on"],
      additionalProperties: false,
    },
    readOnly: false,
    icons: icon("power"),
  },
];

/** Slash commands: ready-made requests the person picks from the chat app's menu. */
const PROMPTS: McpPrompt[] = [
  {
    name: "whats_waiting",
    title: "What's waiting for me",
    description: "Runs waiting for an approval, with the files to look at.",
    icons: icon("inbox"),
    text: () =>
      "Show me what's waiting in Takewon for an approval. For each one, say which automation, since when, who is asked and what the files are. Don't decide any yourself: I'll say which to approve or send back.",
  },
  {
    name: "run_automation",
    title: "Run an automation",
    description: "Runs one of the team's automations on a file and follows the run.",
    arguments: [
      { name: "automation", description: "Which automation, by name.", required: true },
      { name: "file", description: "An upload's name or a link. Left out: ask me." },
    ],
    icons: icon("play"),
    text: (args) =>
      `Run my Takewon automation "${args.automation}" on ${
        args.file ? `"${args.file}"` : "a file: ask me which one"
      }. Then show me how the run goes and the files it makes.`,
  },
  {
    name: "build_automation",
    title: "Build an automation",
    description: "Builds a new automation from what you want it to do, kept as a draft.",
    arguments: [{ name: "goal", description: "What it should do, in your words.", required: true }],
    icons: icon("layout-template"),
    text: (args) =>
      `Build me a Takewon automation that ${args.goal}. Read the content-automations skill first. Keep it as a draft, tell me in plain words what it will do and what starts it, and try it on a file before you publish it or switch it on.`,
  },
  {
    name: "how_runs_went",
    title: "How my runs went",
    description: "The latest runs and how each went, with what to fix in any that failed.",
    arguments: [{ name: "automation", description: "Only this automation, by name." }],
    icons: icon("history"),
    text: (args) =>
      `Show my latest Takewon runs${
        args.automation ? ` of "${args.automation}"` : ""
      } and how each went. For any that failed, say which step, why, and what to change.`,
  },
];

const MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  srt: "application/x-subrip",
  vtt: "text/vtt",
  txt: "text/plain",
  json: "application/json",
  zip: "application/zip",
  pdf: "application/pdf",
};

/** A file link as a resource link: named after its last part, typed from its ending. */
export function fileLink(address: string): McpLink | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const last = url.pathname.split("/").filter(Boolean).pop() ?? url.hostname;
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    // Keep it as written.
  }
  const ending = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  return { uri: address, name, ...(MIME_TYPES[ending] ? { mimeType: MIME_TYPES[ending] } : {}) };
}

/** The files a tool's result names: a run's finished files, and those to review. */
export function linksOf(result: unknown): McpLink[] {
  if (!result || typeof result !== "object") return [];
  const found: string[] = [];
  const take = (value: unknown) => {
    if (Array.isArray(value))
      for (const each of value) if (typeof each === "string") found.push(each);
  };
  const record = result as { files?: unknown; approval?: unknown; approvals?: unknown };
  take(record.files);
  if (record.approval && typeof record.approval === "object") {
    take((record.approval as { files?: unknown }).files);
  }
  if (Array.isArray(record.approvals)) {
    for (const each of record.approvals) {
      if (each && typeof each === "object") take((each as { files?: unknown }).files);
    }
  }
  return [...new Set(found)]
    .slice(0, 50)
    .map(fileLink)
    .filter((link): link is McpLink => link !== null);
}

const site = () => (process.env.SITE_URL ?? "").replace(/\/+$/, "");
const automationLink = (id: string) => `${site()}/automations/${id}`;
const runLink = (automation: string, run: string) =>
  `${site()}/automations/${automation}/runs/${run}`;

function said(message: string): never {
  throw new ConvexError({ code: "mcp", message });
}

const STARTS: Record<string, string> = {
  manual: "Run by hand",
  webhook: "Its webhook address",
  schedule: "A schedule",
  upload: "A new upload",
  folder: "A file in a watched folder",
  finished: "Another automation ending",
};

function stepName(node: Doc<"runs">["nodes"][number]): string {
  if (node.label) return node.label;
  const named: Record<string, string> = {
    approval: "Approval",
    clips: "Clips for a platform",
    if: "If",
    wait: "Wait",
    export: "Export for editors",
    automation: "Run an automation",
  };
  return named[node.kind] ?? getStep(node.stepId ?? "")?.title ?? node.stepId ?? "Step";
}

function runLine(run: Doc<"runs">) {
  return {
    run_id: run._id,
    automation_id: run.automationId,
    automation: run.automationName,
    status: run.status,
    started_at: new Date(run._creationTime).toISOString(),
    finished_at: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
    error: run.error,
    address: runLink(run.automationId, run._id),
  };
}

async function ownAutomation(ctx: QueryCtx, organizationId: string, automationId: string) {
  const id = ctx.db.normalizeId("automations", automationId);
  const automation = id ? await ctx.db.get(id) : null;
  if (!automation || automation.organizationId !== organizationId) {
    said("There is no automation with that id on this team. list_automations gives the ids.");
  }
  return automation;
}

export const automations = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const list = await ctx.db
      .query("automations")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(200);
    return await Promise.all(
      list.map(async (automation) => {
        const last = await ctx.db
          .query("runs")
          .withIndex("by_automation", (q) => q.eq("automationId", automation._id))
          .order("desc")
          .first();
        return {
          automation_id: automation._id,
          name: automation.name,
          on: automation.enabled,
          starts_with: [
            automation.trigger,
            ...(automation.moreTriggers ?? []).map((each) => each.trigger),
          ]
            .map((trigger) => STARTS[trigger.kind] ?? trigger.kind)
            .join(", or "),
          steps: automation.nodes.length,
          has_draft: automation.draft !== undefined,
          address: automationLink(automation._id),
          latest_run: last ? runLine(last) : null,
        };
      }),
    );
  },
});

export const uploads = internalQuery({
  args: { organizationId: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    const list = await ctx.db
      .query("uploads")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(200);
    return list
      .filter((upload) => upload.status === "ready" && !upload.purpose)
      .slice(0, args.limit)
      .map((upload) => ({
        upload_id: upload._id,
        name: upload.fileName,
        type: upload.contentType,
        size_bytes: upload.size,
        seconds: upload.details?.duration ?? null,
        uploaded_at: new Date(upload._creationTime).toISOString(),
      }));
  },
});

export const start = internalMutation({
  args: {
    organizationId: v.string(),
    startedBy: v.string(),
    automationId: v.string(),
    uploadId: v.optional(v.string()),
    fileUrl: v.optional(v.string()),
    draft: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const automation = await ownAutomation(ctx, args.organizationId, args.automationId);
    if (args.draft && !automation.draft) {
      said("This automation has no draft. Leave version out to run the published version.");
    }
    await withTeamSteps(ctx, args.organizationId);
    let fileUrl: string | null = null;
    if (args.uploadId) {
      const id = ctx.db.normalizeId("uploads", args.uploadId);
      const upload = id ? await ctx.db.get(id) : null;
      if (!upload || upload.organizationId !== args.organizationId || upload.status !== "ready") {
        said("There is no upload with that id on this team. list_uploads gives the ids.");
      }
      // Swapped for a signed link to the file when each job is sent (storage.ts).
      fileUrl = `upload:${upload._id}`;
    } else if (args.fileUrl) {
      const link = args.fileUrl.trim();
      if (!/^https?:\/\//.test(link) || link.length > 2000) {
        said("file_url must be a link starting with https:// or http://.");
      }
      fileUrl = link;
    }
    const started = await startRun(
      ctx,
      args.draft && automation.draft ? { ...automation, ...automation.draft } : automation,
      "manual",
      fileUrl ? { file_url: fileUrl } : {},
      args.startedBy,
    );
    if (!started.ok) said(started.message);
    return {
      run_id: started.runId,
      automation: automation.name,
      status: "running",
      address: runLink(automation._id, started.runId),
    };
  },
});

export const run = internalQuery({
  args: { organizationId: v.string(), runId: v.string(), userId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("runs", args.runId);
    const found = id ? await ctx.db.get(id) : null;
    if (!found || found.organizationId !== args.organizationId) {
      said("There is no run with that id on this team.");
    }
    const steps = await ctx.db
      .query("runSteps")
      .withIndex("by_run", (q) => q.eq("runId", found._id))
      .take(200);
    const byNode = new Map(steps.map((step) => [step.nodeId, step]));
    // The finished files are those of the steps nothing comes after.
    const leads = new Set(found.edges.map((edge) => edge.source));
    const files = found.nodes
      .filter((node) => !leads.has(node.id))
      .flatMap((node) => {
        const step = byNode.get(node.id);
        return step?.status === "done" ? step.outputs : [];
      });
    return {
      ...runLine(found),
      steps: found.nodes.map((node) => {
        const step = byNode.get(node.id);
        return {
          step: stepName(node),
          status: step?.status ?? "pending",
          error: step?.error ?? null,
          files: step?.outputs.length ?? 0,
        };
      }),
      files: [...new Set(files)].slice(0, 100),
      approval: await waitingApproval(ctx, found, steps, args.userId ?? ""),
    };
  },
});

/** An approval as an agent sees it: who decides, whether its person may, what to look at. */
function approvalLine(
  step: Doc<"runSteps">,
  run: Doc<"runs">,
  byNode: Map<string, Doc<"runSteps">>,
  members: TeamMembers,
  userId: string,
) {
  const view = approvalView(step, run, members, userId);
  const node = run.nodes.find((each) => each.id === step.nodeId);
  return {
    approval_id: step._id,
    step: node ? stepName(node) : "Approval",
    waiting_since: new Date(step.startedAt ?? step._creationTime).toISOString(),
    asked: view.asked.length ? view.asked : "anyone on the team",
    you_may_decide: view.mayDecide,
    decide_by: view.decideBy ? new Date(view.decideBy).toISOString() : null,
    when_time_up: view.decideBy ? view.whenTimeUp : null,
    files: node ? [...new Set(incomingFiles(node, run, byNode))].slice(0, 50) : [],
  };
}

/** The approval a run is waiting at, if it is waiting at one. */
async function waitingApproval(
  ctx: QueryCtx,
  run: Doc<"runs">,
  steps: Doc<"runSteps">[],
  userId: string,
) {
  const step = steps.find((each) => each.status === "waiting_approval");
  if (!step) return null;
  const byNode = new Map(steps.map((each) => [each.nodeId, each]));
  return approvalLine(step, run, byNode, await membersOf(ctx, run.organizationId), userId);
}

export const approvals = internalQuery({
  args: { organizationId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    const waiting = await ctx.db
      .query("runSteps")
      .withIndex("by_organization_and_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "waiting_approval"),
      )
      .take(50);
    if (waiting.length === 0) return { approvals: [] };
    const members = await membersOf(ctx, args.organizationId);
    const found = [];
    for (const step of waiting) {
      const run = await ctx.db.get(step.runId);
      if (!run || (run.status !== "running" && run.status !== "waiting")) continue;
      const steps = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .take(200);
      const byNode = new Map(steps.map((each) => [each.nodeId, each]));
      found.push({
        ...approvalLine(step, run, byNode, members, args.userId),
        run_id: run._id,
        automation: run.automationName,
        address: runLink(run.automationId, run._id),
      });
    }
    return { approvals: found };
  },
});

export const decide = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    approvalId: v.string(),
    approve: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("runSteps", args.approvalId);
    const step = id ? await ctx.db.get(id) : null;
    if (!step || step.organizationId !== args.organizationId) {
      said("There is no approval with that id on this team. list_approvals gives the ids.");
    }
    if (step.status !== "waiting_approval") said("Someone has already decided this.");
    await decideApproval(ctx, step, args.approve, args.userId, args.reason);
    return {
      approval_id: step._id,
      run_id: step.runId,
      decided: args.approve ? "approved" : "sent back",
    };
  },
});

export const publish = internalMutation({
  args: { organizationId: v.string(), userId: v.string(), automationId: v.string() },
  handler: async (ctx, args) => {
    const automation = await ownAutomation(ctx, args.organizationId, args.automationId);
    if (!automation.draft) said("This automation has no draft to publish.");
    await withTeamSteps(ctx, args.organizationId);
    await publishDraft(ctx, automation, args.userId);
    return {
      automation_id: automation._id,
      published: true,
      on: automation.enabled,
      address: automationLink(automation._id),
    };
  },
});

export const setOn = internalMutation({
  args: { organizationId: v.string(), automationId: v.string(), on: v.boolean() },
  handler: async (ctx, args) => {
    const automation = await ownAutomation(ctx, args.organizationId, args.automationId);
    await withTeamSteps(ctx, args.organizationId);
    await switchAutomation(ctx, automation, args.on);
    return { automation_id: automation._id, on: args.on, address: automationLink(automation._id) };
  },
});

/** What a form about an automation shows: its name, what starts it, and the latest uploads. */
export const brief = internalQuery({
  args: { organizationId: v.string(), automationId: v.string() },
  handler: async (ctx, args) => {
    const automation = await ownAutomation(ctx, args.organizationId, args.automationId);
    const uploads = await ctx.db
      .query("uploads")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(60);
    return {
      name: automation.name,
      on: automation.enabled,
      starts_with: [
        automation.trigger,
        ...(automation.moreTriggers ?? []).map((each) => each.trigger),
      ]
        .map((trigger) => STARTS[trigger.kind] ?? trigger.kind)
        .join(", or "),
      uploads: uploads
        .filter((upload) => upload.status === "ready" && !upload.purpose)
        .slice(0, 20)
        .map((upload) => ({ id: upload._id as string, name: upload.fileName })),
    };
  },
});

/** Which approval, by name, for the form that asks why it is sent back. */
export const approvalBrief = internalQuery({
  args: { organizationId: v.string(), approvalId: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("runSteps", args.approvalId);
    const step = id ? await ctx.db.get(id) : null;
    if (!step || step.organizationId !== args.organizationId) {
      said("There is no approval with that id on this team. list_approvals gives the ids.");
    }
    if (step.status !== "waiting_approval") said("Someone has already decided this.");
    const run = await ctx.db.get(step.runId);
    const node = run?.nodes.find((each) => each.id === step.nodeId);
    return {
      automation: run?.automationName ?? "The run",
      step: node ? stepName(node) : "Approval",
    };
  },
});

/** Stops one of the team's runs, for a chat app cancelling its task. */
export const cancel = internalMutation({
  args: { organizationId: v.string(), runId: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("runs", args.runId);
    const found = id ? await ctx.db.get(id) : null;
    if (!found || found.organizationId !== args.organizationId) {
      said("There is no run with that id on this team.");
    }
    await cancelRun(ctx, found);
  },
});

/** The team's automations, as resources an app can attach to the chat. */
export const automationEntries = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const list = await ctx.db
      .query("automations")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(200);
    return list.map((automation) => ({
      automation_id: automation._id as string,
      name: automation.name,
      starts_with: [
        automation.trigger,
        ...(automation.moreTriggers ?? []).map((each) => each.trigger),
      ]
        .map((trigger) => STARTS[trigger.kind] ?? trigger.kind)
        .join(", or "),
    }));
  },
});

/** Names to suggest as someone types: the team's automations, uploads or latest runs. */
export const suggestions = internalQuery({
  args: { organizationId: v.string(), of: v.union(v.literal("uploads"), v.literal("runs")) },
  handler: async (ctx, args) => {
    if (args.of === "uploads") {
      const uploads = await ctx.db
        .query("uploads")
        .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
        .order("desc")
        .take(200);
      return uploads
        .filter((upload) => upload.status === "ready" && !upload.purpose)
        .map((upload) => upload.fileName);
    }
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(100);
    return runs.map((run) => run._id as string);
  },
});

/** Runs that ended after a moment, oldest first, as run.finished events. */
export const finishedRuns = internalQuery({
  args: {
    organizationId: v.string(),
    after: v.number(),
    automationId: v.optional(v.string()),
    most: v.number(),
  },
  handler: async (ctx, args) => {
    const ended = await ctx.db
      .query("runs")
      .withIndex("by_organization_and_finishedAt", (q) =>
        q.eq("organizationId", args.organizationId).gt("finishedAt", args.after),
      )
      .take(500);
    const wanted = ended
      .filter((run) => !run.test && (!args.automationId || run.automationId === args.automationId))
      .slice(0, args.most + 1);
    return await Promise.all(
      wanted.map(async (run) => {
        const steps = await ctx.db
          .query("runSteps")
          .withIndex("by_run", (q) => q.eq("runId", run._id))
          .take(200);
        const byNode = new Map(steps.map((step) => [step.nodeId, step]));
        const leads = new Set(run.edges.map((edge) => edge.source));
        const files = run.nodes
          .filter((node) => !leads.has(node.id))
          .flatMap((node) => {
            const step = byNode.get(node.id);
            return step?.status === "done" ? step.outputs : [];
          });
        return {
          ...runLine(run),
          finished: run.finishedAt ?? 0,
          files: [...new Set(files)].slice(0, 50),
        };
      }),
    );
  },
});

export const runs = internalQuery({
  args: { organizationId: v.string(), automationId: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, args) => {
    if (args.automationId) {
      const automation = await ownAutomation(ctx, args.organizationId, args.automationId);
      const list = await ctx.db
        .query("runs")
        .withIndex("by_automation", (q) => q.eq("automationId", automation._id))
        .order("desc")
        .take(args.limit);
      return list.map(runLine);
    }
    const list = await ctx.db
      .query("runs")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(args.limit);
    return list.map(runLine);
  },
});

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const count = (value: unknown, fallback: number, most: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(most, Math.max(1, Math.floor(value)))
    : fallback;

/** Who is asking: a person on a team (OAuth), or a team key acting as its maker. */
type Caller = { organizationId: string; userId: string };

type Brief = {
  name: string;
  on: boolean;
  starts_with: string;
  uploads: { id: string; name: string }[];
};

/** Which file to run on: one of the latest uploads, a link, or neither. */
function fileForm(brief: Brief): McpForm {
  return {
    message: `Which file should "${brief.name}" run on? Pick an upload or paste a link. Leave both empty to run it without a file.`,
    fields: {
      ...(brief.uploads.length
        ? {
            upload_id: {
              type: "string",
              title: "An upload",
              oneOf: brief.uploads.map((upload) => ({ const: upload.id, title: upload.name })),
            },
          }
        : {}),
      file_url: {
        type: "string",
        format: "uri",
        title: brief.uploads.length ? "Or a link to a file" : "A link to a file",
        description: "Starting with https://",
      },
    },
  };
}

/** The decision on a review a run is waiting at, asked inside a task. */
function reviewForm(approval: { step: string; files: string[] }, automation: string): McpForm {
  const shown = approval.files.slice(0, 10);
  return {
    message: [
      `"${automation}" is waiting at ${approval.step} for your decision.`,
      shown.length ? `Files to look at:\n${shown.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    fields: {
      decision: {
        type: "string",
        title: "Decision",
        oneOf: [
          { const: "approve", title: "Approve" },
          { const: "send_back", title: "Send back" },
        ],
      },
      reason: { type: "string", title: "If sending back, what should change", maxLength: 500 },
    },
    required: ["decision"],
  };
}

const answerText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

async function callTool(
  ctx: ActionCtx,
  caller: Caller,
  name: string,
  args: Record<string, unknown>,
  context: McpCallContext,
): Promise<unknown> {
  const { organizationId, userId } = caller;
  const automation = () => {
    const id = text(args.automation_id);
    if (!id) throw new ToolSaid("automation_id is needed. list_automations gives the ids.");
    return id;
  };
  try {
    switch (name) {
      case "list_automations":
        return await ctx.runQuery(internal.mcp.automations, { organizationId });
      case "describe_automation":
        return await ctx.runQuery(internal.automations.describeAs, {
          organizationId,
          automationId: automation(),
        });
      case "list_step_types":
        return await ctx.runQuery(internal.automations.nodeTypesAs, {
          organizationId,
          type: text(args.type),
        });
      case "create_automation": {
        const named = text(args.name);
        if (!named) throw new ToolSaid("Give the automation a name.");
        const id = await ctx.runMutation(internal.automations.createAs, {
          organizationId,
          userId,
          name: named,
        });
        return { automation_id: id, address: automationLink(id) };
      }
      case "set_up_follow_on": {
        const followOn = text(args.follow_on);
        if (!followOn) throw new ToolSaid("follow_on is needed. describe_automation lists them.");
        const made = await ctx.runMutation(internal.automations.setUpFollowOnAs, {
          organizationId,
          userId,
          automationId: automation(),
          starterId: followOn,
        });
        return {
          automation_id: made.automationId,
          address: automationLink(made.automationId),
          on: made.on,
          problem: made.problem,
        };
      }
      case "change_automation": {
        const id = automation();
        const operations = Array.isArray(args.operations) ? args.operations : [];
        const changed = await ctx.runMutation(internal.automations.changeAs, {
          organizationId,
          userId,
          automationId: id,
          // Checked by the mutation's own validator; a wrong shape comes back as a tool error.
          operations: operations.map(asSent) as never,
        });
        return { automation_id: id, address: automationLink(id), ...changed };
      }
      case "publish_automation":
        return await ctx.runMutation(internal.mcp.publish, {
          organizationId,
          userId,
          automationId: automation(),
        });
      case "switch_automation": {
        if (typeof args.on !== "boolean") throw new ToolSaid("on is needed: true or false.");
        const id = automation();
        if (args.on && context.forms) {
          // From then on it runs by itself, so the person says so in the chat first.
          const answer = context.answers.switch_on;
          if (!answer) {
            const brief = await ctx.runQuery(internal.mcp.brief, {
              organizationId,
              automationId: id,
            });
            if (!brief.on) {
              return new NeedsInput({
                switch_on: {
                  message: `Switch on "${brief.name}"? From then on it runs by itself on: ${brief.starts_with.toLowerCase()}.`,
                  fields: {},
                },
              });
            }
          } else if (answer.action !== "accept") {
            throw new ToolSaid("The person chose not to switch it on, so it stays off.");
          }
        }
        return await ctx.runMutation(internal.mcp.setOn, {
          organizationId,
          automationId: id,
          on: args.on,
        });
      }
      case "list_approvals":
        return await ctx.runQuery(internal.mcp.approvals, { organizationId, userId });
      case "decide_approval": {
        const approvalId = text(args.approval_id);
        if (!approvalId) throw new ToolSaid("approval_id is needed. list_approvals gives the ids.");
        if (args.decision !== "approve" && args.decision !== "send_back") {
          throw new ToolSaid('decision is needed: "approve" or "send_back".');
        }
        let reason = typeof args.reason === "string" ? args.reason.trim() : undefined;
        if (args.decision === "send_back" && reason === undefined && context.forms) {
          const answer = context.answers.send_back;
          if (!answer) {
            const brief = await ctx.runQuery(internal.mcp.approvalBrief, {
              organizationId,
              approvalId,
            });
            return new NeedsInput({
              send_back: {
                message: `Send back "${brief.automation}" at ${brief.step}? The run stops there.`,
                fields: {
                  reason: { type: "string", title: "What should change", maxLength: 500 },
                },
              },
            });
          }
          if (answer.action !== "accept") {
            throw new ToolSaid("The person did not send it back, so it is still waiting.");
          }
          reason = answerText(answer.content.reason);
        }
        return await ctx.runMutation(internal.mcp.decide, {
          organizationId,
          userId,
          approvalId,
          approve: args.decision === "approve",
          ...(reason ? { reason } : {}),
        });
      }
      case "list_uploads":
        return await ctx.runQuery(internal.mcp.uploads, {
          organizationId,
          limit: count(args.limit, 20, 50),
        });
      case "start_automation": {
        const id = automation();
        let uploadId = text(args.upload_id);
        let fileUrl = text(args.file_url);
        if (!uploadId && !fileUrl && context.forms) {
          const answer = context.answers.file;
          if (!answer) {
            const brief = await ctx.runQuery(internal.mcp.brief, {
              organizationId,
              automationId: id,
            });
            return new NeedsInput({ file: fileForm(brief) });
          }
          if (answer.action !== "accept") {
            throw new ToolSaid(
              "The person closed the form without choosing, so nothing was started.",
            );
          }
          uploadId = text(answer.content.upload_id);
          fileUrl = uploadId ? undefined : text(answer.content.file_url);
        }
        const started = await ctx.runMutation(internal.mcp.start, {
          organizationId,
          startedBy: userId,
          automationId: id,
          uploadId,
          fileUrl,
          draft: args.version === "draft",
        });
        // An app showing the run page follows the run there; one that follows tasks gets one.
        if (context.tasks && !context.apps) {
          const now = new Date().toISOString();
          return new StartedTask({
            taskId: started.run_id,
            status: "working",
            statusMessage: `Running "${started.automation}".`,
            createdAt: now,
            lastUpdatedAt: now,
          });
        }
        return started;
      }
      case "check_run": {
        const runId = text(args.run_id);
        if (!runId) throw new ToolSaid("run_id is needed.");
        return await ctx.runQuery(internal.mcp.run, { organizationId, runId, userId });
      }
      case "list_runs":
        return await ctx.runQuery(internal.mcp.runs, {
          organizationId,
          automationId: text(args.automation_id),
          limit: count(args.limit, 10, 50),
        });
      case "list_workflows":
        return await ctx.runQuery(internal.workflows.listAs, { organizationId });
      case "set_up_workflow": {
        const review = (args.review ?? {}) as Record<string, unknown>;
        const kind = text(args.kind);
        const limit = typeof review.time_limit === "number" ? review.time_limit : undefined;
        const unit = text(review.time_limit_unit);
        const timeUp = text(review.when_time_up);
        return await ctx.runMutation(internal.workflows.setUpAs, {
          organizationId,
          userId,
          automationId: automation(),
          name: text(args.name),
          // Checked by the mutation's own validator; a wrong value comes back as a tool error.
          kind: kind as never,
          ...(args.client_id === null
            ? { clientId: null }
            : text(args.client_id)
              ? { clientId: text(args.client_id) }
              : {}),
          ...(args.review
            ? {
                review: {
                  ...(typeof review.on === "boolean" ? { on: review.on } : {}),
                  ...(Array.isArray(review.reviewers)
                    ? { reviewers: review.reviewers.filter((id) => typeof id === "string") }
                    : {}),
                  ...(limit !== undefined ? { timeLimit: limit } : {}),
                  ...(unit ? { timeLimitUnit: unit as never } : {}),
                  ...(timeUp ? { whenTimeUp: timeUp as never } : {}),
                },
              }
            : {}),
        });
      }
      case "switch_workflow": {
        const workflowId = text(args.workflow_id);
        if (!workflowId) throw new ToolSaid("workflow_id is needed. list_workflows gives the ids.");
        if (typeof args.on !== "boolean") throw new ToolSaid("on is needed: true or false.");
        return await ctx.runMutation(internal.workflows.switchAs, {
          organizationId,
          workflowId,
          on: args.on,
        });
      }
      default:
        throw new ToolSaid(`There is no tool called ${name}.`);
    }
  } catch (caught) {
    if (caught instanceof ConvexError) {
      const data = caught.data as { message?: string } | string;
      throw new ToolSaid(typeof data === "string" ? data : (data.message ?? "That did not work."));
    }
    // A change of the wrong shape fails the mutation's argument check.
    if (caught instanceof Error && /ArgumentValidationError|Validator error/.test(caught.message)) {
      throw new ToolSaid(
        "One of the changes is not in a shape change_automation takes. Check each op and its fields against the operations schema.",
      );
    }
    throw caught;
  }
}

/** The step list names triggers "trigger:upload"; a change wants the kind "upload". */
function asSent(op: unknown): unknown {
  if (!op || typeof op !== "object") return op;
  const change = op as { op?: unknown; trigger?: { kind?: unknown } };
  if (change.op !== "trigger" && change.op !== "addTrigger") return op;
  if (typeof change.trigger?.kind !== "string") return op;
  const kind = change.trigger.kind.replace(/^trigger:/, "");
  return { ...change, trigger: { ...change.trigger, kind } };
}

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "www-authenticate",
};

export type { Caller };

type RunView = {
  run_id: string;
  automation: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  steps: { step: string; status: string }[];
  approval: {
    approval_id: string;
    step: string;
    asked: unknown;
    you_may_decide: boolean;
    files: string[];
  } | null;
};

/** A run as a task: the chat app follows it, and is asked about a review it reaches. */
export function taskOfRun(run: RunView, forms: boolean): McpTask {
  const base = {
    taskId: run.run_id,
    createdAt: run.started_at,
    lastUpdatedAt: run.finished_at ?? new Date().toISOString(),
  };
  switch (run.status) {
    case "done":
      return { ...base, status: "completed", result: run };
    case "failed":
      // The run went wrong, not the protocol: the task completes with an error result.
      return { ...base, status: "completed", result: run, isError: true };
    case "cancelled":
      return { ...base, status: "cancelled", statusMessage: "The run was stopped." };
  }
  const approval = run.approval;
  if (approval) {
    if (approval.you_may_decide && forms) {
      return {
        ...base,
        status: "input_required",
        statusMessage: `Waiting at ${approval.step} for your decision.`,
        forms: { [`review:${approval.approval_id}`]: reviewForm(approval, run.automation) },
      };
    }
    const asked = Array.isArray(approval.asked)
      ? approval.asked.join(" or ")
      : "someone on the team";
    return {
      ...base,
      status: "working",
      statusMessage: `Waiting at ${approval.step} for ${asked} to decide.`,
    };
  }
  const at = run.steps.findIndex((step) => step.status !== "done" && step.status !== "skipped");
  return {
    ...base,
    status: "working",
    statusMessage:
      at >= 0 ? `Step ${at + 1} of ${run.steps.length}: ${run.steps[at].step}.` : "Finishing.",
  };
}

/** The team's runs, as tasks for chat apps that follow tasks. */
function tasksFor(ctx: ActionCtx, caller: Caller): McpTasks {
  const { organizationId, userId } = caller;
  const runOf = async (taskId: string) => {
    try {
      return (await ctx.runQuery(internal.mcp.run, {
        organizationId,
        runId: taskId,
        userId,
      })) as RunView;
    } catch (caught) {
      if (caught instanceof ConvexError) return null;
      throw caught;
    }
  };
  return {
    get: async (taskId, context) => {
      const run = await runOf(taskId);
      return run ? taskOfRun(run, context.forms) : null;
    },
    update: async (taskId, answers) => {
      const run = await runOf(taskId);
      if (!run) throw new ToolSaid(`There is no task ${taskId || "(none)"}.`);
      for (const [key, answer] of Object.entries(answers)) {
        const approvalId = /^review:(.+)$/.exec(key)?.[1];
        if (!approvalId || answer.action !== "accept") continue;
        const decision = answerText(answer.content.decision);
        if (decision !== "approve" && decision !== "send_back") continue;
        const reason = answerText(answer.content.reason);
        try {
          await ctx.runMutation(internal.mcp.decide, {
            organizationId,
            userId,
            approvalId,
            approve: decision === "approve",
            ...(decision === "send_back" && reason ? { reason } : {}),
          });
        } catch (caught) {
          if (caught instanceof ConvexError) {
            const data = caught.data as { message?: string } | string;
            throw new ToolSaid(
              typeof data === "string" ? data : (data.message ?? "That did not work."),
            );
          }
          throw caught;
        }
      }
    },
    cancel: async (taskId) => {
      try {
        await ctx.runMutation(internal.mcp.cancel, { organizationId, runId: taskId });
      } catch (caught) {
        if (caught instanceof ConvexError)
          throw new ToolSaid(`There is no task ${taskId || "(none)"}.`);
        throw caught;
      }
    },
  };
}

const AUTOMATION_URI = "takewon://automations/";
const RUN_URI = "takewon://runs/";

/** The team's automations and runs as resources an app can attach to the chat. */
function dataFor(ctx: ActionCtx, caller: Caller): McpData {
  const { organizationId, userId } = caller;
  const json = (uri: string, value: unknown) => ({
    uri,
    name: uri,
    mimeType: "application/json",
    text: JSON.stringify(value, null, 2),
  });
  return {
    list: async () => {
      const automations = await ctx.runQuery(internal.mcp.automationEntries, { organizationId });
      return automations.map((automation) => ({
        uri: `${AUTOMATION_URI}${automation.automation_id}`,
        name: automation.name,
        title: automation.name,
        description: `Automation. Starts with: ${automation.starts_with.toLowerCase()}.`,
        mimeType: "application/json",
      }));
    },
    templates: [
      {
        uriTemplate: `${AUTOMATION_URI}{automation_id}`,
        name: "automation",
        title: "An automation",
        description:
          "One of the team's automations: what starts it, its steps and what stops it running.",
        mimeType: "application/json",
      },
      {
        uriTemplate: `${RUN_URI}{run_id}`,
        name: "run",
        title: "A run",
        description:
          "How one run went: each step, errors, the files it made and any approval it waits at.",
        mimeType: "application/json",
      },
    ],
    read: async (uri) => {
      try {
        if (uri.startsWith(AUTOMATION_URI)) {
          const automationId = decodeURIComponent(uri.slice(AUTOMATION_URI.length));
          const described = await ctx.runQuery(internal.automations.describeAs, {
            organizationId,
            automationId,
          });
          return json(uri, described);
        }
        if (uri.startsWith(RUN_URI)) {
          const runId = decodeURIComponent(uri.slice(RUN_URI.length));
          return json(uri, await ctx.runQuery(internal.mcp.run, { organizationId, runId, userId }));
        }
      } catch (caught) {
        // Not on this team, or no such thing: the protocol answers "not found".
        if (caught instanceof ConvexError) return null;
        throw caught;
      }
      return null;
    },
  };
}

/** Best matches first: names that start with what was typed, then names that contain it. */
export function matching(values: string[], typed: string): string[] {
  const wanted = typed.trim().toLowerCase();
  const unique = [...new Set(values)];
  if (!wanted) return unique;
  const starts = unique.filter((value) => value.toLowerCase().startsWith(wanted));
  const contains = unique.filter(
    (value) => !value.toLowerCase().startsWith(wanted) && value.toLowerCase().includes(wanted),
  );
  return [...starts, ...contains];
}

/** Suggestions as the person fills in a prompt or an address. */
function completeFor(ctx: ActionCtx, caller: Caller): McpComplete {
  const { organizationId } = caller;
  const automationNames = async () =>
    (await ctx.runQuery(internal.mcp.automationEntries, { organizationId })).map(
      (each) => each.name,
    );
  return async (ref, argument) => {
    if (ref.type === "ref/prompt") {
      if (
        argument.name === "automation" &&
        (ref.name === "run_automation" || ref.name === "how_runs_went")
      ) {
        return matching(await automationNames(), argument.value);
      }
      if (argument.name === "file" && ref.name === "run_automation") {
        return matching(
          await ctx.runQuery(internal.mcp.suggestions, { organizationId, of: "uploads" }),
          argument.value,
        );
      }
      return [];
    }
    if (ref.uri === `${AUTOMATION_URI}{automation_id}` && argument.name === "automation_id") {
      const automations = await ctx.runQuery(internal.mcp.automationEntries, { organizationId });
      const typed = argument.value.trim().toLowerCase();
      return automations
        .filter(
          (each) =>
            !typed ||
            each.automation_id.toLowerCase().startsWith(typed) ||
            each.name.toLowerCase().includes(typed),
        )
        .map((each) => each.automation_id);
    }
    if (ref.uri === `${RUN_URI}{run_id}` && argument.name === "run_id") {
      return matching(
        await ctx.runQuery(internal.mcp.suggestions, { organizationId, of: "runs" }),
        argument.value,
      );
    }
    return [];
  };
}

const RUN_PAYLOAD = {
  type: "object",
  properties: {
    run_id: { type: "string" },
    automation_id: { type: "string" },
    automation: { type: "string" },
    status: { type: "string", enum: ["done", "failed", "cancelled"] },
    finished_at: { type: "string", format: "date-time" },
    error: { type: ["string", "null"] },
    files: { type: "array", items: { type: "string" } },
    address: { type: "string" },
  },
};

const APPROVAL_PAYLOAD = {
  type: "object",
  properties: {
    approval_id: { type: "string" },
    run_id: { type: "string" },
    automation: { type: "string" },
    step: { type: "string" },
    asked: { type: ["string", "array"], items: { type: "string" } },
    you_may_decide: { type: "boolean" },
    files: { type: "array", items: { type: "string" } },
    address: { type: "string" },
  },
};

/** A poll cursor is the moment of the last event handed out. */
const cursorAt = (cursor: string | null): number | null => {
  const at = cursor ? /^t:(\d+)$/.exec(cursor) : null;
  return at ? Number(at[1]) : null;
};

/** Run and approval events, polled: nothing is held per client, the cursor is a moment. */
function eventsFor(ctx: ActionCtx, caller: Caller): McpEvents {
  const { organizationId, userId } = caller;
  return {
    types: [
      {
        name: "run.finished",
        description: "A run of one of the team's automations ended: done, failed or stopped.",
        inputSchema: {
          type: "object",
          properties: {
            automation_id: { type: "string", description: "Only this automation's runs." },
          },
        },
        payloadSchema: RUN_PAYLOAD,
      },
      {
        name: "approval.waiting",
        description:
          "A run reached an Approval step or a workflow's review and waits for someone to decide.",
        inputSchema: { type: "object", properties: {} },
        payloadSchema: APPROVAL_PAYLOAD,
      },
    ],
    poll: async ({ name, args, cursor, maxAgeMs, most }) => {
      const now = Date.now();
      const from = cursorAt(cursor);
      if (cursor !== null && from === null) {
        throw new EventRefused(
          -32602,
          "That cursor did not come from this server. Poll with null to start from now.",
        );
      }
      // A null cursor starts from now: nothing is replayed.
      if (from === null)
        return { events: [], cursor: `t:${now}`, truncated: false, hasMore: false };
      const floor = maxAgeMs !== null ? Math.max(from, now - maxAgeMs) : from;
      let found: { at: number; event: McpEventOccurrence }[];
      if (name === "run.finished") {
        const automationId =
          typeof args.automation_id === "string" ? args.automation_id : undefined;
        const ended = await ctx.runQuery(internal.mcp.finishedRuns, {
          organizationId,
          after: floor,
          automationId,
          most,
        });
        found = ended.map(({ finished, ...run }) => ({
          at: finished,
          event: {
            eventId: `${run.run_id}:${run.status}`,
            name,
            timestamp: new Date(finished).toISOString(),
            data: run,
          },
        }));
      } else {
        const { approvals } = await ctx.runQuery(internal.mcp.approvals, {
          organizationId,
          userId,
        });
        found = approvals
          .map((approval) => ({ at: Date.parse(approval.waiting_since), approval }))
          .filter((each) => each.at > floor)
          .sort((a, b) => a.at - b.at)
          .map(({ at, approval }) => ({
            at,
            event: {
              eventId: approval.approval_id,
              name,
              timestamp: approval.waiting_since,
              data: {
                approval_id: approval.approval_id,
                run_id: approval.run_id,
                automation: approval.automation,
                step: approval.step,
                asked: approval.asked,
                you_may_decide: approval.you_may_decide,
                files: approval.files,
                address: approval.address,
              },
            },
          }));
      }
      const batch = found.slice(0, most);
      const hasMore = found.length > most;
      const last = batch.at(-1)?.at;
      return {
        events: batch.map((each) => each.event),
        // With more to come, the next poll carries on from the last one handed out.
        cursor: `t:${hasMore && last !== undefined ? last : Math.max(floor, last ?? 0, hasMore ? 0 : now)}`,
        truncated: floor > from,
        hasMore,
      };
    },
  };
}

/** GET /mcp/server-card: who this server is and where to reach it, for directories. */
export const serverCard = httpAction(async () => {
  const site = (process.env.SITE_URL ?? "").replace(/\/+$/, "");
  const card = {
    $schema: "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
    name: "com.takewon/takewon",
    title: PRODUCT_NAME,
    version: SERVER_INFO.version,
    description:
      "Your content, social media ready. Build, run and follow your team's content automations (clips, captions, reframing and more) from any AI chat app, and approve what waits for review.",
    ...(site ? { websiteUrl: site } : {}),
    remotes: [
      {
        type: "streamable-http",
        url: mcpResource(),
        supportedProtocolVersions: [...MODERN_VERSIONS, ...LEGACY_VERSIONS],
      },
    ],
  };
  return new Response(JSON.stringify(card, null, 2), {
    headers: {
      "content-type": "application/mcp-server-card+json",
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "Content-Type, If-None-Match",
    },
  });
});

/**
 * GET /.well-known/openai-apps-challenge: the token ChatGPT's app directory asks for to prove the
 * MCP address is ours. Nothing is served until OPENAI_APPS_CHALLENGE is set.
 */
export const openaiAppsChallenge = httpAction(async () => {
  const token = (process.env.OPENAI_APPS_CHALLENGE ?? "").trim();
  if (!token) return new Response("Not found", { status: 404 });
  return new Response(token, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
});

/**
 * One JSON-RPC message in, one answer out, for a caller already identified by its team
 * key or OAuth token (mcpHttp.ts serves POST /mcp).
 */
export async function answerMcp(
  ctx: ActionCtx,
  caller: Caller,
  request: Request,
): Promise<Response> {
  const body = await request.text();
  if (body.length > 200_000) return new Response("Body too large", { status: 413, headers: CORS });
  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "The body is not JSON." } },
      { status: 400, headers: CORS },
    );
  }
  // Nothing new for a team whose trial is over or that is blocked, and no floods.
  const allowed = await ctx.runMutation(internal.access.mcpCall, caller);
  if (!allowed.ok) {
    const id =
      message && typeof message === "object" && "id" in message
        ? (message as { id: unknown }).id
        : null;
    return Response.json(
      { jsonrpc: "2.0", id: id ?? null, error: { code: -32000, message: allowed.message } },
      { status: allowed.reason === "rate_limited" ? 429 : 403, headers: CORS },
    );
  }
  const method =
    message && typeof message === "object" && "method" in message
      ? (message as { method: unknown }).method
      : null;
  const reply = await handleMcp(message, request.headers, {
    info: SERVER_INFO,
    instructions: INSTRUCTIONS,
    tools: TOOLS,
    apps:
      method === "resources/read" || method === "resources/list"
        ? appsFor(await ctx.runQuery(internal.mcp.fileOrigins, caller))
        : APPS,
    skills: SKILLS,
    prompts: PROMPTS,
    call: (name, args, context) => callTool(ctx, caller, name, args, context),
    links: linksOf,
    tasks: tasksFor(ctx, caller),
    data: dataFor(ctx, caller),
    complete: completeFor(ctx, caller),
    events: eventsFor(ctx, caller),
  });
  if (!reply.body) return new Response(null, { status: 202, headers: CORS });
  return Response.json(reply.body, { status: reply.status, headers: CORS });
}

/**
 * The addresses a team's finished files come from: its toolkit's storage, as the toolkit
 * reported it. The run page may load media from these, so clips play in the chat.
 */
export const fileOrigins = internalQuery({
  args: { organizationId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    const connections = await ctx.db
      .query("toolkitConnections")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .take(10);
    const origins = new Set<string>();
    for (const connection of connections) {
      for (const address of [connection.storage?.publicUrl, connection.storage?.endpoint]) {
        const origin = httpsOrigin(address);
        if (origin) origins.add(origin);
      }
    }
    return [...origins];
  },
});

/** The origin of an https address, or null for anything else. */
export function httpsOrigin(address: string | null | undefined): string | null {
  if (!address) return null;
  try {
    const url = new URL(address);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** The apps, each allowed to load media from the team's storage. */
function appsFor(origins: string[]): typeof APPS {
  if (origins.length === 0) return APPS;
  return APPS.map((app) => {
    const ui = (app._meta?.ui ?? {}) as { csp?: Record<string, unknown> };
    return {
      ...app,
      _meta: { ...app._meta, ui: { ...ui, csp: { ...ui.csp, resourceDomains: origins } } },
    };
  });
}

/** GET /mcp: this server keeps no stream open, as the MCP spec allows. */
export const noStream = httpAction(
  async () =>
    new Response("This MCP server answers POST requests only.", {
      status: 405,
      headers: { allow: "POST" },
    }),
);
