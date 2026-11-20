import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { getCaller } from "./lib/caller";
import { isMember, MANAGER_ROLES, requireMember } from "./lib/authz";
import {
  type DeliverableStatus,
  KINDS,
  MAX_SLOTS,
  packageOf,
  slotsFor,
  STATUSES,
} from "./lib/packages";
import { projectOf, putInSlot, slotMoved } from "./lib/projects";
import { startRun } from "./lib/runner";
import { deliverableKindValidator, deliverableStatusValidator } from "./schema";

/** The most projects a team's list shows, and the longest name one can have. */
const LISTED = 200;
const NAME_LIMIT = 120;
const LABEL_LIMIT = 80;

const fail = (code: string, message: string): never => {
  throw new ConvexError({ code, message });
};

function cleanText(text: string, limit: number, what: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) fail("invalid_input", `Give the ${what} a name.`);
  if (trimmed.length > limit) fail("invalid_input", `Keep the name to ${limit} letters.`);
  return trimmed;
}

async function slotsOf(ctx: QueryCtx, projectId: Id<"projects">) {
  const slots = await ctx.db
    .query("deliverables")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .take(MAX_SLOTS + 20);
  return slots.sort((a, b) => a.order - b.order);
}

async function clientFor(ctx: QueryCtx, organizationId: string, clientId?: Id<"clients">) {
  if (!clientId) return null;
  const client = await ctx.db.get(clientId);
  return client && client.organizationId === organizationId ? client : null;
}

async function loadProject(ctx: MutationCtx, projectId: Id<"projects">) {
  const project = await ctx.db.get(projectId);
  if (!project) return fail("not_found", "That project is gone.");
  const { userId, role } = await requireMember(ctx, project.organizationId);
  return { project, userId, role };
}

async function loadSlot(ctx: MutationCtx, deliverableId: Id<"deliverables">) {
  const slot = await ctx.db.get(deliverableId);
  if (!slot) return fail("not_found", "That slot is gone.");
  const { userId } = await requireMember(ctx, slot.organizationId);
  return { slot, userId };
}

/** How many slots are in each column, and how many hold a file. */
function progressOf(slots: Doc<"deliverables">[]) {
  const counts = Object.fromEntries(STATUSES.map(({ status }) => [status, 0])) as Record<
    DeliverableStatus,
    number
  >;
  for (const slot of slots) counts[slot.status] += 1;
  return {
    total: slots.length,
    filled: slots.filter((slot) => slot.versions.length > 0).length,
    counts,
  };
}

const newest = (slot: Doc<"deliverables">) => slot.versions[slot.versions.length - 1]?.url ?? null;

/** The team's projects, the most recently changed first; only one client's when asked. */
export const list = query({
  args: { organizationId: v.string(), clientId: v.optional(v.id("clients")) },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const projects = args.clientId
      ? await ctx.db
          .query("projects")
          .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
          .take(LISTED)
      : await ctx.db
          .query("projects")
          .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
          .take(LISTED);
    const rows = await Promise.all(
      projects
        .filter((project) => project.organizationId === args.organizationId)
        .map(async (project) => {
          const slots = await slotsOf(ctx, project._id);
          const client = await clientFor(ctx, project.organizationId, project.clientId);
          const cover = slots.find((slot) => slot.kind === "video" && newest(slot)) ?? null;
          return {
            _id: project._id,
            name: project.name,
            package: packageOf(project.package)?.name ?? "Project",
            client: client ? { _id: client._id, name: client.name } : null,
            cover: cover ? newest(cover) : null,
            updatedAt: project.updatedAt,
            ...progressOf(slots),
          };
        }),
    );
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/** One project with every slot in order. Null when it is gone or another team's. */
export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || !(await isMember(ctx, project.organizationId))) return null;
    const { role } = await requireMember(ctx, project.organizationId);
    const slots = await slotsOf(ctx, project._id);
    const client = await clientFor(ctx, project.organizationId, project.clientId);
    const review = project.reviewId ? await ctx.db.get(project.reviewId) : null;
    return {
      _id: project._id,
      organizationId: project.organizationId,
      name: project.name,
      package: packageOf(project.package)?.name ?? "Project",
      client: client ? { _id: client._id, name: client.name } : null,
      review: review ? { _id: review._id, status: review.status } : null,
      createdAt: project._creationTime,
      updatedAt: project.updatedAt,
      canDelete: MANAGER_ROLES.includes(role),
      ...progressOf(slots),
      slots: slots.map((slot) => ({
        _id: slot._id,
        kind: slot.kind,
        label: slot.label,
        status: slot.status,
        url: newest(slot),
        versions: slot.versions.length,
        clipId: slot.clipId ?? null,
        updatedAt: slot.updatedAt,
      })),
    };
  },
});

/** Makes a project from a package, with one empty slot for each thing it delivers. */
export const create = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    package: v.string(),
    // How many shorts, for a package that has them.
    shorts: v.optional(v.number()),
    clientId: v.optional(v.id("clients")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const name = cleanText(args.name, NAME_LIMIT, "project");
    if (!packageOf(args.package)) fail("invalid_input", "Pick a package.");
    if (args.clientId && !(await clientFor(ctx, args.organizationId, args.clientId))) {
      fail("not_found", "That client is gone.");
    }
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      organizationId: args.organizationId,
      clientId: args.clientId,
      name,
      package: args.package,
      createdBy: userId,
      updatedAt: now,
    });
    for (const [order, slot] of slotsFor(args.package, args.shorts).entries()) {
      await ctx.db.insert("deliverables", {
        projectId,
        organizationId: args.organizationId,
        kind: slot.kind,
        label: slot.label,
        order,
        status: "todo",
        versions: [],
        updatedAt: now,
      });
    }
    return projectId;
  },
});

export const rename = mutation({
  args: { projectId: v.id("projects"), name: v.string() },
  handler: async (ctx, args) => {
    const { project } = await loadProject(ctx, args.projectId);
    const name = cleanText(args.name, NAME_LIMIT, "project");
    await ctx.db.patch(project._id, { name, updatedAt: Date.now() });
    // The project's review room keeps the project's name.
    if (project.reviewId) await ctx.db.patch(project.reviewId, { title: name });
  },
});

export const setClient = mutation({
  args: { projectId: v.id("projects"), clientId: v.union(v.id("clients"), v.null()) },
  handler: async (ctx, args) => {
    const { project } = await loadProject(ctx, args.projectId);
    if (args.clientId && !(await clientFor(ctx, project.organizationId, args.clientId))) {
      fail("not_found", "That client is gone.");
    }
    await ctx.db.patch(project._id, { clientId: args.clientId ?? undefined });
  },
});

/** Deletes a project and its slots. Its review room and the files themselves stay. */
export const remove = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return;
    await requireMember(ctx, project.organizationId, MANAGER_ROLES);
    for (const slot of await slotsOf(ctx, project._id)) await ctx.db.delete(slot._id);
    await ctx.db.delete(project._id);
  },
});

/** Adds an empty slot at the end. Without a name it is named like "Short 6". */
export const addSlot = mutation({
  args: {
    projectId: v.id("projects"),
    kind: deliverableKindValidator,
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { project } = await loadProject(ctx, args.projectId);
    const slots = await slotsOf(ctx, project._id);
    if (slots.length >= MAX_SLOTS) fail("limit", `A project can have up to ${MAX_SLOTS} slots.`);
    const base = KINDS.find((entry) => entry.kind === args.kind)?.label ?? "Slot";
    let label = args.label?.trim() ? cleanText(args.label, LABEL_LIMIT, "slot") : "";
    if (!label) {
      const same = slots.filter((slot) => slot.kind === args.kind).length;
      label = same === 0 ? base : `${base} ${same + 1}`;
    }
    const now = Date.now();
    await ctx.db.patch(project._id, { updatedAt: now });
    return await ctx.db.insert("deliverables", {
      projectId: project._id,
      organizationId: project.organizationId,
      kind: args.kind,
      label,
      order: (slots[slots.length - 1]?.order ?? -1) + 1,
      status: "todo",
      versions: [],
      updatedAt: now,
    });
  },
});

export const renameSlot = mutation({
  args: { deliverableId: v.id("deliverables"), label: v.string() },
  handler: async (ctx, args) => {
    const { slot } = await loadSlot(ctx, args.deliverableId);
    const label = cleanText(args.label, LABEL_LIMIT, "slot");
    await ctx.db.patch(slot._id, { label, updatedAt: Date.now() });
    if (slot.clipId) {
      const clip = await ctx.db.get(slot.clipId);
      if (clip) await ctx.db.patch(clip._id, { title: label });
    }
  },
});

/** Removes a slot. Its clip stays in the review room, with its comments. */
export const removeSlot = mutation({
  args: { deliverableId: v.id("deliverables") },
  handler: async (ctx, args) => {
    const slot = await ctx.db.get(args.deliverableId);
    if (!slot) return;
    await requireMember(ctx, slot.organizationId);
    await ctx.db.delete(slot._id);
  },
});

/** Moves a slot to another column of the board. */
export const setStatus = mutation({
  args: { deliverableId: v.id("deliverables"), status: deliverableStatusValidator },
  handler: async (ctx, args) => {
    const { slot } = await loadSlot(ctx, args.deliverableId);
    if (slot.status === args.status) return;
    if (args.status !== "todo" && args.status !== "in_progress" && slot.versions.length === 0) {
      fail("invalid_input", "Put a file in this slot first.");
    }
    const now = Date.now();
    await ctx.db.patch(slot._id, { status: args.status, updatedAt: now });
    await ctx.db.patch(slot.projectId, { updatedAt: now });
    await slotMoved(ctx, { ...slot, status: args.status }, args.status);
  },
});

/**
 * Runs one of the team's automations on a slot's newest file, for the slot's project: the
 * run uses the project's client, and its finished files go back into the project.
 */
export const runOnSlot = mutation({
  args: { deliverableId: v.id("deliverables"), automationId: v.id("automations") },
  handler: async (ctx, args) => {
    const { slot, userId } = await loadSlot(ctx, args.deliverableId);
    const automation = await ctx.db.get(args.automationId);
    if (!automation || automation.organizationId !== slot.organizationId) {
      return fail("not_found", "That automation is gone.");
    }
    const project = await ctx.db.get(slot.projectId);
    if (!project) return fail("not_found", "That project is gone.");
    const newest = slot.versions[slot.versions.length - 1]?.url;
    if (!newest) return fail("invalid_input", "Put a file in this slot first.");
    const started = await startRun(
      ctx,
      automation,
      "manual",
      { file_url: newest, project: project.name, slot: slot.label },
      userId,
      { project: projectOf(project, slot._id) },
    );
    if (!started.ok) return fail("invalid_input", started.message);
    return started.runId;
  },
});

/** Puts a file in a slot as its next version, which sends it to review. */
export const addVersion = mutation({
  args: { deliverableId: v.id("deliverables"), url: v.string() },
  handler: async (ctx, args) => {
    const { slot, userId } = await loadSlot(ctx, args.deliverableId);
    const user = await getCaller(ctx);
    await putInSlot(ctx, slot, args.url.trim(), {
      userId,
      name: user?.name?.trim() || "Someone",
    });
  },
});

/** A slot's versions, newest last, for its history. */
export const versions = query({
  args: { deliverableId: v.id("deliverables") },
  handler: async (ctx, args) => {
    const slot = await ctx.db.get(args.deliverableId);
    if (!slot || !(await isMember(ctx, slot.organizationId))) return [];
    return slot.versions.map((version) => ({ url: version.url, addedAt: version.addedAt }));
  },
});
