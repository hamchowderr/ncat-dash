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
import { bearerKey, hashMcpKey } from "./lib/mcpKeys";
import { handleMcpMessage, type McpTool, ToolSaid } from "./lib/mcpServer";
import { startRun } from "./lib/runner";
import { withTeamSteps } from "./lib/teamSteps";

/**
 * The dashboard as an MCP server, at <Convex site>/mcp. Claude, or any agent that speaks
 * MCP, connects with one of the team's keys (Settings, "AI agents") and can list the
 * team's automations and uploads, start an automation on a file, and see how its runs
 * went. It cannot change automations: that stays in the dashboard and its own agent.
 */

const INSTRUCTIONS =
  "This is a content automation dashboard. Each automation is a set of plain steps (cut clips, add captions, reframe, and so on) that runs on the team's own toolkit with no AI per video. Use list_automations to see them, list_uploads for the team's files, start_automation to run one on a file, and check_run to see how a run is going and the files it made.";

const TOOLS: McpTool[] = [
  {
    name: "list_automations",
    title: "List automations",
    description:
      "The team's automations: id, name, whether it is on, what usually starts it, and its latest run.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
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
      "Runs one of the team's automations now, on an upload (upload_id from list_uploads) or a file link (file_url). It runs the published version, whether the automation is on or off. Returns the run id for check_run.",
    inputSchema: {
      type: "object",
      properties: {
        automation_id: { type: "string", description: "From list_automations." },
        upload_id: { type: "string", description: "One of the team's uploads." },
        file_url: { type: "string", description: "Or a link to a file, starting with https://." },
      },
      required: ["automation_id"],
      additionalProperties: false,
    },
    readOnly: false,
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
];

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
      ? { keyId: key._id, organizationId: key.organizationId, createdBy: key.createdBy, lastUsedAt: key.lastUsedAt }
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
          starts_with: STARTS[automation.trigger.kind] ?? automation.trigger.kind,
          steps: automation.nodes.length,
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
  },
  handler: async (ctx, args) => {
    const automation = await ownAutomation(ctx, args.organizationId, args.automationId);
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
      automation,
      "manual",
      fileUrl ? { file_url: fileUrl } : {},
      args.startedBy,
    );
    if (!started.ok) said(started.message);
    return { run_id: started.runId, automation: automation.name, status: "running" };
  },
});

export const run = internalQuery({
  args: { organizationId: v.string(), runId: v.string() },
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
    };
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

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const count = (value: unknown, fallback: number, most: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(most, Math.max(1, Math.floor(value)))
    : fallback;

async function callTool(
  ctx: ActionCtx,
  key: { organizationId: string; createdBy: string },
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { organizationId } = key;
  try {
    switch (name) {
      case "list_automations":
        return await ctx.runQuery(internal.mcp.automations, { organizationId });
      case "list_uploads":
        return await ctx.runQuery(internal.mcp.uploads, {
          organizationId,
          limit: count(args.limit, 20, 50),
        });
      case "start_automation": {
        const automationId = text(args.automation_id);
        if (!automationId) throw new ToolSaid("automation_id is needed. list_automations gives the ids.");
        return await ctx.runMutation(internal.mcp.start, {
          organizationId,
          startedBy: key.createdBy,
          automationId,
          uploadId: text(args.upload_id),
          fileUrl: text(args.file_url),
        });
      }
      case "check_run": {
        const runId = text(args.run_id);
        if (!runId) throw new ToolSaid("run_id is needed.");
        return await ctx.runQuery(internal.mcp.run, { organizationId, runId });
      }
      case "list_runs":
        return await ctx.runQuery(internal.mcp.runs, {
          organizationId,
          automationId: text(args.automation_id),
          limit: count(args.limit, 10, 50),
        });
      default:
        throw new ToolSaid(`There is no tool called ${name}.`);
    }
  } catch (caught) {
    if (caught instanceof ConvexError) {
      const data = caught.data as { message?: string } | string;
      throw new ToolSaid(typeof data === "string" ? data : (data.message ?? "That did not work."));
    }
    throw caught;
  }
}

const unauthorized = () =>
  new Response(
    JSON.stringify({ error: "Send one of your team's keys as Authorization: Bearer <key>." }),
    {
      status: 401,
      headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="ncat-dash"' },
    },
  );

/** POST /mcp: one JSON-RPC message in, one answer out. */
export const serve = httpAction(async (ctx, request) => {
  const presented = bearerKey(request);
  if (!presented) return unauthorized();
  const key = await ctx.runQuery(internal.mcp.keyFor, { hash: await hashMcpKey(presented) });
  if (!key) return unauthorized();
  // Noted at most once a minute, so a busy agent does not write on every call.
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt > 60_000) {
    await ctx.runMutation(internal.mcp.touchKey, { keyId: key.keyId as Id<"mcpKeys"> });
  }

  const body = await request.text();
  if (body.length > 100_000) return new Response("Body too large", { status: 413 });
  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "The body is not JSON." } },
      { status: 400 },
    );
  }
  const reply = await handleMcpMessage(
    message,
    TOOLS,
    (name, args) => callTool(ctx, key, name, args),
    INSTRUCTIONS,
  );
  if (!reply) return new Response(null, { status: 202 });
  return Response.json(reply);
});

/** GET /mcp: this server keeps no stream open, as the MCP spec allows. */
export const noStream = httpAction(async () =>
  new Response("This MCP server answers POST requests only.", {
    status: 405,
    headers: { allow: "POST" },
  }),
);
