import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { requireMember } from "./lib/authz";

/** The most folders one team keeps, and the longest name one can have. */
export const MAX_FOLDERS = 200;
const NAME_LIMIT = 80;

const fail = (code: string, message: string): never => {
  throw new ConvexError({ code, message });
};

function cleanName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) fail("invalid_input", "Give the folder a name.");
  if (trimmed.length > NAME_LIMIT) fail("invalid_input", `Keep the name to ${NAME_LIMIT} letters.`);
  return trimmed;
}

async function teamFolders(ctx: QueryCtx, organizationId: string) {
  return await ctx.db
    .query("automationFolders")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(MAX_FOLDERS);
}

async function nameTaken(
  ctx: QueryCtx,
  organizationId: string,
  name: string,
  except?: Id<"automationFolders">,
) {
  return (await teamFolders(ctx, organizationId)).some(
    (other) => other._id !== except && other.name.toLowerCase() === name.toLowerCase(),
  );
}

async function loadForMember(ctx: MutationCtx, folderId: Id<"automationFolders">) {
  const folder = await ctx.db.get(folderId);
  if (!folder) return fail("not_found", "That folder is gone.");
  await requireMember(ctx, folder.organizationId);
  return folder;
}

/** The team's folders by name, each with how many automations are in it. */
export const list = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const folders = await teamFolders(ctx, args.organizationId);
    const rows = await Promise.all(
      folders.map(async (folder) => {
        const inside = await ctx.db
          .query("automations")
          .withIndex("by_folder", (q) => q.eq("folderId", folder._id))
          .take(500);
        return {
          _id: folder._id,
          name: folder.name,
          count: inside.length,
          createdAt: folder._creationTime,
          updatedAt: Math.max(
            folder._creationTime,
            ...inside.map((each) => Math.max(each.updatedAt, each.draft?.updatedAt ?? 0)),
          ),
        };
      }),
    );
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const create = mutation({
  args: { organizationId: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const name = cleanName(args.name);
    if ((await teamFolders(ctx, args.organizationId)).length >= MAX_FOLDERS) {
      fail("limit", `A team can have up to ${MAX_FOLDERS} folders.`);
    }
    if (await nameTaken(ctx, args.organizationId, name)) {
      fail("conflict", `There is already a folder called ${name}.`);
    }
    return await ctx.db.insert("automationFolders", {
      organizationId: args.organizationId,
      name,
      createdBy: userId,
    });
  },
});

export const rename = mutation({
  args: { folderId: v.id("automationFolders"), name: v.string() },
  handler: async (ctx, args) => {
    const folder = await loadForMember(ctx, args.folderId);
    const name = cleanName(args.name);
    if (await nameTaken(ctx, folder.organizationId, name, folder._id)) {
      fail("conflict", `There is already a folder called ${name}.`);
    }
    await ctx.db.patch(folder._id, { name });
  },
});

/** Deletes a folder. The automations in it stay, back on the main list. */
export const remove = mutation({
  args: { folderId: v.id("automationFolders") },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.folderId);
    if (!folder) return;
    await requireMember(ctx, folder.organizationId);
    const inside = await ctx.db
      .query("automations")
      .withIndex("by_folder", (q) => q.eq("folderId", folder._id))
      .take(500);
    for (const automation of inside) await ctx.db.patch(automation._id, { folderId: undefined });
    await ctx.db.delete(folder._id);
  },
});

/** Puts an automation in a folder, or back on the main list with null. */
export const moveAutomation = mutation({
  args: {
    automationId: v.id("automations"),
    folderId: v.union(v.id("automationFolders"), v.null()),
  },
  handler: async (ctx, args) => {
    const automation = await ctx.db.get(args.automationId);
    if (!automation) return fail("not_found", "That automation is gone.");
    await requireMember(ctx, automation.organizationId);
    if (args.folderId) {
      const folder = await ctx.db.get(args.folderId);
      if (!folder || folder.organizationId !== automation.organizationId) {
        fail("not_found", "That folder is gone.");
      }
    }
    await ctx.db.patch(automation._id, { folderId: args.folderId ?? undefined });
  },
});
