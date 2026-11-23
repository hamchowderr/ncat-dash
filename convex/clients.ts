import { nameProblem } from "@takewon/automation-core";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { deliveryFolderOf } from "./lib/clients";
import { MANAGER_ROLES, isMember, requireMember } from "./lib/authz";
import { checkedBrand, checkedMusic } from "./lib/brand";
import { brandAndMusicOf } from "./lib/queue";
import { brandValidator, musicValidator } from "./schema";
import { removePortal } from "./portal";

/** The most clients one team keeps, and the longest name one can have. */
export const MAX_CLIENTS = 200;
const NAME_LIMIT = 80;

const fail = (code: string, message: string): never => {
  throw new ConvexError({ code, message });
};

function cleanName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) fail("invalid_input", "Give the client a name.");
  if (trimmed.length > NAME_LIMIT) fail("invalid_input", `Keep the name to ${NAME_LIMIT} letters.`);
  return trimmed;
}

/** A folder inside the team's folder, such as "Clients/Acme": each part a name a file can have. */
function cleanFolder(folder: string): string | undefined {
  const parts = folder
    .trim()
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  for (const part of parts) {
    const problem = nameProblem(part);
    if (problem) fail("invalid_input", problem);
  }
  return parts.join("/");
}

async function teamClients(ctx: QueryCtx, organizationId: string) {
  return await ctx.db
    .query("clients")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(MAX_CLIENTS);
}

/** A client the caller may change, with their role on its team. */
async function loadForMember(ctx: MutationCtx, clientId: Id<"clients">) {
  const client = await ctx.db.get(clientId);
  if (!client) return fail("not_found", "That client is gone.");
  const { userId, role } = await requireMember(ctx, client.organizationId);
  return { client, userId, role };
}

async function nameTaken(
  ctx: QueryCtx,
  organizationId: string,
  name: string,
  except?: Id<"clients">,
) {
  const all = await teamClients(ctx, organizationId);
  return all.some(
    (other) => other._id !== except && other.name.toLowerCase() === name.toLowerCase(),
  );
}

/** What one row of the Clients list shows. */
async function summaryOf(ctx: QueryCtx, client: Doc<"clients">) {
  const automations = await ctx.db
    .query("automations")
    .withIndex("by_client", (q) => q.eq("clientId", client._id))
    .take(500);
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_client", (q) => q.eq("clientId", client._id))
    .take(500);
  return {
    _id: client._id,
    name: client.name,
    logo: client.brand?.logo ?? null,
    color: client.brand?.color ?? null,
    automations: automations.length,
    projects: projects.length,
    createdAt: client._creationTime,
  };
}

/** The team's clients, by name. */
export const list = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const clients = await teamClients(ctx, args.organizationId);
    const rows = await Promise.all(clients.map((client) => summaryOf(ctx, client)));
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** One client with its brand, what it falls back to, and what is for it. Null when gone. */
export const get = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client || !(await isMember(ctx, client.organizationId))) return null;
    const { role } = await requireMember(ctx, client.organizationId);
    const team = await brandAndMusicOf(ctx, client.organizationId);
    const automations = await ctx.db
      .query("automations")
      .withIndex("by_client", (q) => q.eq("clientId", client._id))
      .take(200);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_client", (q) => q.eq("clientId", client._id))
      .order("desc")
      .take(200);
    return {
      _id: client._id,
      organizationId: client.organizationId,
      name: client.name,
      brand: client.brand ?? {},
      music: client.music ?? [],
      // What steps use where the client has set nothing.
      teamBrand: team.brand,
      teamMusic: team.music,
      deliveryFolder: client.deliveryFolder ?? "",
      deliversTo: deliveryFolderOf(client),
      automations: automations.map((automation) => ({
        _id: automation._id,
        name: automation.name,
        enabled: automation.enabled,
      })),
      projects: projects.map((project) => ({ _id: project._id, name: project.name })),
      canDelete: MANAGER_ROLES.includes(role),
    };
  },
});

export const create = mutation({
  args: { organizationId: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const name = cleanName(args.name);
    if ((await teamClients(ctx, args.organizationId)).length >= MAX_CLIENTS) {
      fail("limit", `A team can have up to ${MAX_CLIENTS} clients.`);
    }
    if (await nameTaken(ctx, args.organizationId, name)) {
      fail("conflict", `There is already a client called ${name}.`);
    }
    return await ctx.db.insert("clients", {
      organizationId: args.organizationId,
      name,
      createdBy: userId,
    });
  },
});

export const rename = mutation({
  args: { clientId: v.id("clients"), name: v.string() },
  handler: async (ctx, args) => {
    const { client } = await loadForMember(ctx, args.clientId);
    const name = cleanName(args.name);
    if (await nameTaken(ctx, client.organizationId, name, client._id)) {
      fail("conflict", `There is already a client called ${name}.`);
    }
    await ctx.db.patch(client._id, { name });
  },
});

/** Sets the client's own logo, colour, font and music. Anything left empty uses the team's. */
export const setBrand = mutation({
  args: { clientId: v.id("clients"), brand: brandValidator, music: v.optional(musicValidator) },
  handler: async (ctx, args) => {
    const { client } = await loadForMember(ctx, args.clientId);
    const brand = await checkedBrand(ctx, client.organizationId, args.brand, client.brand);
    const music = args.music
      ? await checkedMusic(ctx, client.organizationId, args.music, client.music)
      : client.music;
    await ctx.db.patch(client._id, { brand, music: music && music.length > 0 ? music : undefined });
  },
});

/** Sets where the client's finished files go. Empty: Clients/<name>/. */
export const setDeliveryFolder = mutation({
  args: { clientId: v.id("clients"), folder: v.string() },
  handler: async (ctx, args) => {
    const { client } = await loadForMember(ctx, args.clientId);
    await ctx.db.patch(client._id, { deliveryFolder: cleanFolder(args.folder) });
  },
});

/**
 * Deletes a client. Its automations, projects and library files stay, for the team
 * itself; their files are not touched. Owners and admins only.
 */
export const remove = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client) return;
    await requireMember(ctx, client.organizationId, MANAGER_ROLES);
    const automations = await ctx.db
      .query("automations")
      .withIndex("by_client", (q) => q.eq("clientId", client._id))
      .take(500);
    for (const automation of automations) {
      await ctx.db.patch(automation._id, { clientId: undefined });
    }
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_client", (q) => q.eq("clientId", client._id))
      .take(500);
    for (const project of projects) await ctx.db.patch(project._id, { clientId: undefined });
    // Library files made for it stay too, as the team's own.
    const files = await ctx.db
      .query("libraryItems")
      .withIndex("by_client", (q) => q.eq("clientId", client._id))
      .take(2000);
    for (const file of files) await ctx.db.patch(file._id, { clientId: undefined });
    // Creators' deals with it stay, since the rights still run out; the note keeps its name.
    const deals = await ctx.db
      .query("creatorRights")
      .withIndex("by_client", (q) => q.eq("clientId", client._id))
      .take(2000);
    for (const deal of deals) {
      await ctx.db.patch(deal._id, {
        clientId: undefined,
        note: [`For ${client.name}.`, deal.note].filter(Boolean).join(" "),
      });
    }
    // Its calendar posts and slots stay, as the team's own.
    for (const table of ["calendarPosts", "calendarSlots"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_client", (q) => q.eq("clientId", client._id))
        .take(2000);
      for (const row of rows) await ctx.db.patch(row._id, { clientId: undefined });
    }
    // Its portal link stops working, and so do the review rooms it opened.
    const portals = await ctx.db
      .query("clientPortals")
      .withIndex("by_client", (q) => q.eq("clientId", client._id))
      .take(10);
    for (const portal of portals) await removePortal(ctx, portal);
    await ctx.db.delete(client._id);
  },
});

/** Makes an automation work for a client, or for the team itself with null. */
export const setForAutomation = mutation({
  args: { automationId: v.id("automations"), clientId: v.union(v.id("clients"), v.null()) },
  handler: async (ctx, args) => {
    const automation = await ctx.db.get(args.automationId);
    if (!automation) return fail("not_found", "That automation is gone.");
    await requireMember(ctx, automation.organizationId);
    if (args.clientId) {
      const client = await ctx.db.get(args.clientId);
      if (!client || client.organizationId !== automation.organizationId) {
        fail("not_found", "That client is gone.");
      }
    }
    await ctx.db.patch(automation._id, { clientId: args.clientId ?? undefined });
  },
});
