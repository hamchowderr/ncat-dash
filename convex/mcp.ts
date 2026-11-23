import { PRODUCT_NAME } from "@ncat-dash/automation-core";
import { getStep } from "@ncat-dash/step-catalog";
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
import { bearerKey, hashMcpKey } from "./lib/mcpKeys";
import { handleMcp, type McpTool, ToolSaid } from "./lib/mcpServer";
import { ACCESS_TOKEN_PREFIX } from "./lib/oauth";
import { signInChallenge } from "./oauth";
import { approvalView, membersOf, type TeamMembers } from "./lib/approvals";
import { decideApproval, incomingFiles, startRun } from "./lib/runner";
import { publishDraft, switchAutomation } from "./automations";
import { withTeamSteps } from "./lib/teamSteps";

/**
 * The dashboard as an MCP server, at <Convex site>/mcp. An agent signs in with OAuth as a
 * person on one team (claude.ai connectors, Claude Code, Cursor), or sends one of the
 * team's keys (Settings, MCP). It can do what that person can in the dashboard for
 * automations: list them, build and change them (changes wait as a draft until published),
 * publish, switch them on or off, run one on a file, follow the run, and decide approvals.
 */

const INSTRUCTIONS =
  "This is Takewon, a content automation dashboard. Each automation is a set of plain steps (cut clips, add captions, reframe, and so on) that runs by itself on the team's own toolkit, with no AI per video. Read the content-automations skill before building. list_automations and describe_automation show what the team has; create_automation and change_automation build (changes are kept as a draft until publish_automation makes them live); switch_automation switches one on or off; start_automation runs one on an upload or a file link; check_run shows how a run is going and the files it made. list_approvals shows what waits for someone to approve, and decide_approval approves it or sends it back when the person asks you to. A chain of linked automations can be one workflow (set_up_workflow) with a single review before its files go out.";

const SERVER_INFO = { name: "takewon", title: PRODUCT_NAME, version: "2.0.0" };

const automationId = { type: "string", description: "From list_automations or create_automation." };

const TOOLS: McpTool[] = [
  {
    name: "list_automations",
    title: "List automations",
    description:
      "The team's automations: id, name, whether it is on, what usually starts it, whether it has an unpublished draft, and its latest run.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
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
  },
  {
    name: "start_automation",
    title: "Start an automation",
    description:
      'Runs one of the team\'s automations now, on an upload (upload_id from list_uploads) or a file link (file_url), whether it is on or off. It runs the published version; pass version "draft" to try unpublished changes. Returns the run, for check_run.',
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
  },
  {
    name: "list_approvals",
    title: "List approvals",
    description:
      "Runs waiting at an Approval step or a workflow's review: which automation, since when, who is asked, whether the person you act for may decide, and the files to look at.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    appUri: RUN_APP_URI,
  },
  {
    name: "decide_approval",
    title: "Approve or send back",
    description:
      "Approves a waiting approval, so the run carries on with those files, or sends it back, which stops it there. Only when the person has said which: an approval is their check, so never decide one by yourself. The same people may decide as in the dashboard.",
    inputSchema: {
      type: "object",
      properties: {
        approval_id: { type: "string", description: "From list_approvals or check_run." },
        decision: { type: "string", enum: ["approve", "send_back"] },
      },
      required: ["approval_id", "decision"],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: "list_workflows",
    title: "List workflows",
    description:
      "The team's workflows: chains of linked automations with one review before their files go out. For each: its kind of work, client, whether it is on, who reviews and any time limit, and its automations, with where the review happens.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
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
  },
];

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

/** The team a key belongs to, by the key's hash. */
export const keyFor = internalQuery({
  args: { hash: v.string() },
  handler: async (ctx, args) => {
    const key = await ctx.db
      .query("mcpKeys")
      .withIndex("by_hash", (q) => q.eq("hash", args.hash))
      .unique();
    return key
      ? {
          keyId: key._id,
          organizationId: key.organizationId,
          createdBy: key.createdBy,
          lastUsedAt: key.lastUsedAt,
        }
      : null;
  },
});

export const touchKey = internalMutation({
  args: { keyId: v.id("mcpKeys") },
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.keyId)) await ctx.db.patch(args.keyId, { lastUsedAt: Date.now() });
  },
});

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
  },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("runSteps", args.approvalId);
    const step = id ? await ctx.db.get(id) : null;
    if (!step || step.organizationId !== args.organizationId) {
      said("There is no approval with that id on this team. list_approvals gives the ids.");
    }
    if (step.status !== "waiting_approval") said("Someone has already decided this.");
    await decideApproval(ctx, step, args.approve, args.userId);
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

async function callTool(
  ctx: ActionCtx,
  caller: Caller,
  name: string,
  args: Record<string, unknown>,
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
      case "switch_automation":
        if (typeof args.on !== "boolean") throw new ToolSaid("on is needed: true or false.");
        return await ctx.runMutation(internal.mcp.setOn, {
          organizationId,
          automationId: automation(),
          on: args.on,
        });
      case "list_approvals":
        return await ctx.runQuery(internal.mcp.approvals, { organizationId, userId });
      case "decide_approval": {
        const approvalId = text(args.approval_id);
        if (!approvalId) throw new ToolSaid("approval_id is needed. list_approvals gives the ids.");
        if (args.decision !== "approve" && args.decision !== "send_back") {
          throw new ToolSaid('decision is needed: "approve" or "send_back".');
        }
        return await ctx.runMutation(internal.mcp.decide, {
          organizationId,
          userId,
          approvalId,
          approve: args.decision === "approve",
        });
      }
      case "list_uploads":
        return await ctx.runQuery(internal.mcp.uploads, {
          organizationId,
          limit: count(args.limit, 20, 50),
        });
      case "start_automation":
        return await ctx.runMutation(internal.mcp.start, {
          organizationId,
          startedBy: userId,
          automationId: automation(),
          uploadId: text(args.upload_id),
          fileUrl: text(args.file_url),
          draft: args.version === "draft",
        });
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

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "www-authenticate",
};

const unauthorized = (invalid: boolean) =>
  new Response(
    JSON.stringify({
      error:
        "Sign in to use this server, or send one of your team's keys as Authorization: Bearer <key>.",
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": signInChallenge(invalid ? "invalid_token" : undefined),
        ...CORS,
      },
    },
  );

/** The person and team a request acts for, from its OAuth token or team key. */
async function callerOf(ctx: ActionCtx, request: Request): Promise<Caller | "none" | "invalid"> {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (!token) return "none";
  if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
    const grant = await ctx.runQuery(internal.oauth.grantFor, { accessToken: token });
    if (!grant) return "invalid";
    if (!grant.lastUsedAt || Date.now() - grant.lastUsedAt > 60_000) {
      await ctx.runMutation(internal.oauth.touchGrant, { grantId: grant.grantId });
    }
    return { organizationId: grant.organizationId, userId: grant.userId };
  }
  const presented = bearerKey(request);
  if (!presented) return "invalid";
  const key = await ctx.runQuery(internal.mcp.keyFor, { hash: await hashMcpKey(presented) });
  if (!key) return "invalid";
  // Noted at most once a minute, so a busy agent does not write on every call.
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt > 60_000) {
    await ctx.runMutation(internal.mcp.touchKey, { keyId: key.keyId as Id<"mcpKeys"> });
  }
  return { organizationId: key.organizationId, userId: key.createdBy };
}

/** POST /mcp: one JSON-RPC message in, one answer out. */
export const serve = httpAction(async (ctx, request) => {
  const caller = await callerOf(ctx, request);
  if (caller === "none" || caller === "invalid") return unauthorized(caller === "invalid");

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
  const reply = await handleMcp(message, request.headers, {
    info: SERVER_INFO,
    instructions: INSTRUCTIONS,
    tools: TOOLS,
    apps: APPS,
    skills: SKILLS,
    call: (name, args) => callTool(ctx, caller, name, args),
  });
  if (!reply.body) return new Response(null, { status: 202, headers: CORS });
  return Response.json(reply.body, { status: reply.status, headers: CORS });
});

/** GET /mcp: this server keeps no stream open, as the MCP spec allows. */
export const noStream = httpAction(
  async () =>
    new Response("This MCP server answers POST requests only.", {
      status: 405,
      headers: { allow: "POST" },
    }),
);
