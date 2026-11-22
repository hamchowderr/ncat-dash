import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { requireMember } from "./lib/authz";
import { startingFileName } from "./lib/outputs";

/**
 * What the person has open in the dashboard, in a few plain lines for the agent: which
 * automation, run, file, project, client, review or creator it is, who it is for, and for
 * a video its length, shape, frame rate and sound.
 *
 * The agent keeps this as a state signal (packages/agent ncat/screen.ts) and is told
 * again only when the screen changes, so "this video" or "this run" always means the one
 * being looked at. Read as the person: they see only their own team's things.
 */

export const SCREEN_KINDS = [
  "automation",
  "run",
  "library",
  "project",
  "client",
  "review",
  "creator",
] as const;
export type ScreenKind = (typeof SCREEN_KINDS)[number];

const screenKind = v.union(...SCREEN_KINDS.map((kind) => v.literal(kind)));

type Details = Doc<"libraryItems">["details"];

function seconds(total: number): string {
  const rounded = Math.round(total);
  if (rounded < 60) return `${rounded} s`;
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const rest = rounded % 60;
  const parts = [
    hours ? `${hours} h` : "",
    minutes ? `${minutes} min` : "",
    rest ? `${rest} s` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** "1 min 21 s, 1080x1920 (9:16, vertical), 30 fps, with sound" from a file's details. */
export function detailsText(details: Details): string | null {
  if (!details) return null;
  const parts: string[] = [];
  if (typeof details.duration === "number" && details.duration > 0) {
    parts.push(seconds(details.duration));
  }
  if (details.width && details.height) {
    const d = gcd(details.width, details.height);
    const shape =
      details.width === details.height
        ? "square"
        : details.width > details.height
          ? "wide"
          : "vertical";
    parts.push(
      `${details.width}x${details.height} (${details.width / d}:${details.height / d}, ${shape})`,
    );
  }
  if (typeof details.fps === "number" && details.fps > 0) {
    parts.push(`${Math.round(details.fps * 100) / 100} fps`);
  }
  if (details.hasVideo === false) parts.push("audio only");
  if (details.hasAudio === true) parts.push("with sound");
  if (details.hasAudio === false) parts.push("no sound");
  return parts.length > 0 ? parts.join(", ") : null;
}

async function clientName(ctx: QueryCtx, organizationId: string, id: Id<"clients"> | undefined) {
  if (!id) return null;
  const client = await ctx.db.get(id);
  return client && client.organizationId === organizationId ? client.name : null;
}

/** What starts an automation, in plain words. */
const STARTS: Record<Doc<"automations">["trigger"]["kind"], string> = {
  manual: "only when someone presses Run now",
  webhook: "when its web address is called",
  schedule: "on a schedule",
  upload: "when a file is uploaded",
  folder: "when a file lands in a watched folder",
  finished: "when another automation finishes",
  slot: "when a project slot changes status",
};

/** Who it is for: a client, and so their brand and folder, or the team itself. */
function forLine(client: string | null): string {
  return client
    ? `It is for the client ${client}: its steps use ${client}'s brand and music where ${client} has its own, and finished files go to ${client}'s folder.`
    : "It is the team's own, not for a client.";
}

/** The id as one of the team's own documents, or null for anything else. */
async function own<
  T extends
    "automations" | "runs" | "libraryItems" | "projects" | "clients" | "reviews" | "creators",
>(ctx: QueryCtx, table: T, organizationId: string, id: string): Promise<Doc<T> | null> {
  const docId = ctx.db.normalizeId(table, id);
  if (!docId) return null;
  const doc = (await ctx.db.get(docId)) as Doc<T> | null;
  return doc && (doc as unknown as { organizationId: string }).organizationId === organizationId
    ? doc
    : null;
}

async function describeScreen(
  ctx: QueryCtx,
  organizationId: string,
  kind: ScreenKind,
  id: string,
): Promise<string | null> {
  switch (kind) {
    case "automation": {
      const automation = await own(ctx, "automations", organizationId, id);
      if (!automation) return null;
      const steps = automation.nodes.length;
      return [
        `The automation "${automation.name}" (id ${automation._id}). It is ${automation.enabled ? "on" : "off"}, starts ${STARTS[automation.trigger.kind]}, and has ${steps} step${steps === 1 ? "" : "s"}.`,
        forLine(await clientName(ctx, organizationId, automation.clientId)),
      ].join("\n");
    }
    case "run": {
      const run = await own(ctx, "runs", organizationId, id);
      if (!run) return null;
      const file = startingFileName(run.trigger);
      const facts = detailsText(((run.trigger ?? {}) as { details?: Details }).details);
      return [
        `A run of the automation "${run.automationName}" (run id ${run._id}, automation id ${run.automationId}). Status: ${run.status}.${run.error ? ` Error: ${run.error}` : ""}`,
        file ? `It ran on the file "${file}"${facts ? `: ${facts}` : ""}.` : "",
        forLine(await clientName(ctx, organizationId, run.clientId)),
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "library": {
      const item = await own(ctx, "libraryItems", organizationId, id);
      if (!item) return null;
      const facts = detailsText(item.details);
      const made = item.automationName ? `, made by the automation "${item.automationName}"` : "";
      const transcript =
        item.transcript?.status === "ready"
          ? "What is said in it has been transcribed."
          : item.transcript?.status === "working"
            ? "It is being transcribed."
            : "";
      return [
        `The ${item.kind} "${item.title}" in the Library (${item.shortId}${made}).${facts ? ` ${facts}.` : ""}`,
        transcript,
        item.clientId ? forLine(await clientName(ctx, organizationId, item.clientId)) : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "project": {
      const project = await own(ctx, "projects", organizationId, id);
      if (!project) return null;
      const slots = await ctx.db
        .query("deliverables")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect();
      const counts = new Map<string, number>();
      for (const slot of slots) counts.set(slot.status, (counts.get(slot.status) ?? 0) + 1);
      const summary = [...counts].map(([status, n]) => `${n} ${status}`).join(", ");
      return [
        `The project "${project.name}" (id ${project._id}), with ${slots.length} deliverable${slots.length === 1 ? "" : "s"}${summary ? `: ${summary}` : ""}.`,
        forLine(await clientName(ctx, organizationId, project.clientId)),
      ].join("\n");
    }
    case "client": {
      const client = await own(ctx, "clients", organizationId, id);
      if (!client) return null;
      return `The client ${client.name}'s page (id ${client._id}). ${client.brand ? `${client.name} has its own brand settings.` : `${client.name} uses the team's brand.`}`;
    }
    case "review": {
      const review = await own(ctx, "reviews", organizationId, id);
      if (!review) return null;
      return `The review room "${review.title}" (id ${review._id}). It is ${review.status}.`;
    }
    case "creator": {
      const creator = await own(ctx, "creators", organizationId, id);
      if (!creator) return null;
      return `The creator ${creator.name}'s page (id ${creator._id}).`;
    }
  }
}

export const describe = query({
  args: { organizationId: v.string(), kind: screenKind, id: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const text = await describeScreen(ctx, args.organizationId, args.kind, args.id);
    return text ? `What the person has open in the dashboard right now:\n${text}` : null;
  },
});

/**
 * The client the thing on screen is for, when it is one of the team's own: the client
 * page itself, or an automation, run, Library file or project made for a client. The
 * agent holds that client's Knowledge pages (brief, notes) only while this says so.
 */
async function clientOnScreen(
  ctx: QueryCtx,
  organizationId: string,
  kind: ScreenKind,
  id: string,
): Promise<Id<"clients"> | null> {
  const forClient = async (clientId: Id<"clients"> | undefined) =>
    clientId && (await clientName(ctx, organizationId, clientId)) !== null ? clientId : null;
  switch (kind) {
    case "client":
      return (await own(ctx, "clients", organizationId, id))?._id ?? null;
    case "automation":
      return forClient((await own(ctx, "automations", organizationId, id))?.clientId);
    case "run":
      return forClient((await own(ctx, "runs", organizationId, id))?.clientId);
    case "library":
      return forClient((await own(ctx, "libraryItems", organizationId, id))?.clientId);
    case "project":
      return forClient((await own(ctx, "projects", organizationId, id))?.clientId);
    case "review":
    case "creator":
      return null;
  }
}

export const clientOf = query({
  args: { organizationId: v.string(), kind: screenKind, id: v.string() },
  returns: v.union(v.object({ id: v.id("clients"), name: v.string() }), v.null()),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const clientId = await clientOnScreen(ctx, args.organizationId, args.kind, args.id);
    if (!clientId) return null;
    const client = await ctx.db.get(clientId);
    return client ? { id: client._id, name: client.name } : null;
  },
});
