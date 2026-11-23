import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalQuery,
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server";
import { isMember, requireMember } from "./lib/authz";
import { clientBrand, signDownload, signLogo, teamLogoFile } from "./lib/clientLinks";
import { packageOf } from "./lib/packages";
import { sharesOf } from "./lib/reviews";

// A client's portal: one link (/portal/<token>) where someone outside the team sees only
// their own projects, in the team's logo and colours, and opens each project's review
// room. Nobody signs in; the secret in the link is the only key, and every function on
// the client's side checks it first. The team switches it on and off on the client's page.

const PROJECTS_SHOWN = 100;
const SLOTS_SHOWN = 200;

const closed = () =>
  new ConvexError({ code: "not_found", message: "This portal is no longer shared." });

/** A long random secret for the link: 64 hex characters. */
function newToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
}

async function portalOf(ctx: QueryCtx, clientId: Id<"clients">) {
  return await ctx.db
    .query("clientPortals")
    .withIndex("by_client", (q) => q.eq("clientId", clientId))
    .first();
}

async function portalFor(ctx: QueryCtx | MutationCtx, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const portal = await ctx.db
    .query("clientPortals")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();
  if (!portal) return null;
  const client = await ctx.db.get(portal.clientId);
  return client && client.organizationId === portal.organizationId ? { portal, client } : null;
}

/** One of the client's projects through its portal, or null when it is not theirs. */
async function projectIn(
  ctx: QueryCtx,
  client: Doc<"clients">,
  projectId: string,
): Promise<Doc<"projects"> | null> {
  const id = ctx.db.normalizeId("projects", projectId);
  const project = id ? await ctx.db.get(id) : null;
  return project && project.clientId === client._id ? project : null;
}

async function slotsOf(ctx: QueryCtx, projectId: Id<"projects">) {
  const slots = await ctx.db
    .query("deliverables")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .take(SLOTS_SHOWN);
  return slots.sort((a, b) => a.order - b.order);
}

const newest = (slot: Doc<"deliverables">) => slot.versions[slot.versions.length - 1]?.url ?? null;

// ---- The team's side ----

/** The client's portal link and its settings, or null when it is switched off. */
export const forClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client || !(await isMember(ctx, client.organizationId))) return null;
    const portal = await portalOf(ctx, client._id);
    if (!portal) return null;
    return {
      token: portal.token,
      allowVerdict: portal.allowVerdict,
      showTeamComments: portal.showTeamComments,
    };
  },
});

/**
 * Switches the portal on, or changes what the client may do in the review rooms it opens.
 * Turning it on makes a new secret, so a link switched off earlier never works again.
 */
export const set = mutation({
  args: { clientId: v.id("clients"), allowVerdict: v.boolean(), showTeamComments: v.boolean() },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client) throw new ConvexError({ code: "not_found", message: "That client is gone." });
    const { userId } = await requireMember(ctx, client.organizationId);
    const settings = { allowVerdict: args.allowVerdict, showTeamComments: args.showTeamComments };
    const existing = await portalOf(ctx, client._id);
    if (existing) {
      await ctx.db.patch(existing._id, settings);
      return existing.token;
    }
    const token = newToken();
    await ctx.db.insert("clientPortals", {
      clientId: client._id,
      organizationId: client.organizationId,
      token,
      createdBy: userId,
      ...settings,
    });
    return token;
  },
});

/** Switches the portal off. Anyone who has the link sees that it is no longer shared. */
export const stop = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client) return;
    await requireMember(ctx, client.organizationId);
    const portal = await portalOf(ctx, client._id);
    if (portal) await removePortal(ctx, portal);
  },
});

/**
 * Gives the portal a new address and turns the old one off straight away, for when the
 * link was passed around. The review rooms the old link opened close too; the client
 * opens them again from the new link.
 */
export const newLink = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client) throw new ConvexError({ code: "not_found", message: "That client is gone." });
    await requireMember(ctx, client.organizationId);
    const portal = await portalOf(ctx, client._id);
    if (!portal) {
      throw new ConvexError({ code: "not_found", message: "This client has no portal." });
    }
    await removeOpenedRooms(ctx, portal);
    const token = newToken();
    await ctx.db.patch(portal._id, { token });
    return token;
  },
});

async function removeOpenedRooms(ctx: MutationCtx, portal: Doc<"clientPortals">) {
  const shares = await ctx.db
    .query("reviewShares")
    .withIndex("by_portal", (q) => q.eq("portalId", portal._id))
    .take(500);
  for (const share of shares) await ctx.db.delete(share._id);
}

/**
 * Deletes a portal and the review links it opened, so the review rooms a client reached
 * through it close too.
 */
export async function removePortal(ctx: MutationCtx, portal: Doc<"clientPortals">) {
  await removeOpenedRooms(ctx, portal);
  await ctx.db.delete(portal._id);
}

// ---- The client's side ----

/**
 * The portal's front page: who it is from, in their logo and colour, and the client's
 * projects with how far each is. Null when the link does not work.
 */
export const view = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const found = await portalFor(ctx, args.token);
    if (!found) return null;
    const { client } = found;
    const { teamName } = await ctx.runQuery(components.betterAuth.members.contactsFor, {
      organizationId: client.organizationId,
    });
    // The team's own brand: the portal is the agency's, showing the client's work.
    const brand = await clientBrand(ctx, client.organizationId);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_client", (q) => q.eq("clientId", client._id))
      .take(PROJECTS_SHOWN);
    const rows = await Promise.all(
      projects.map(async (project) => {
        const slots = await slotsOf(ctx, project._id);
        const cover = slots.find((slot) => slot.kind === "video" && newest(slot));
        return {
          _id: project._id,
          name: project.name,
          package: packageOf(project.package)?.name ?? "Project",
          cover: cover ? newest(cover) : null,
          total: slots.length,
          ready: slots.filter((slot) => slot.status === "review").length,
          approved: slots.filter(
            (slot) => slot.status === "approved" || slot.status === "published",
          ).length,
          updatedAt: project.updatedAt,
        };
      }),
    );
    return {
      agency: {
        name: teamName ?? "Your team",
        logo: brand.logo,
        color: brand.color,
      },
      client: { name: client.name },
      projects: rows.sort((a, b) => b.updatedAt - a.updatedAt),
    };
  },
});

/** One of the client's projects with its deliverables. Null when it is not theirs. */
export const project = query({
  args: { token: v.string(), projectId: v.string() },
  handler: async (ctx, args) => {
    const found = await portalFor(ctx, args.token);
    if (!found) return null;
    const project = await projectIn(ctx, found.client, args.projectId);
    if (!project) return null;
    const slots = await slotsOf(ctx, project._id);
    return {
      _id: project._id,
      name: project.name,
      package: packageOf(project.package)?.name ?? "Project",
      hasReview: project.reviewId !== undefined,
      slots: slots.map((slot) => ({
        _id: slot._id,
        kind: slot.kind,
        label: slot.label,
        status: slot.status,
        url: newest(slot),
        versions: slot.versions.length,
      })),
    };
  },
});

/**
 * Opens a project's review room for the client: its share link, made with the portal's
 * settings when the room has none yet. Returns the share link's secret.
 */
export const openReview = mutation({
  args: { token: v.string(), projectId: v.string() },
  handler: async (ctx, args) => {
    const found = await portalFor(ctx, args.token);
    if (!found) throw closed();
    const { portal, client } = found;
    const project = await projectIn(ctx, client, args.projectId);
    const review = project?.reviewId ? await ctx.db.get(project.reviewId) : null;
    if (!review) {
      throw new ConvexError({ code: "not_found", message: "Nothing is ready to review yet." });
    }
    // The portal's own link to the room, never the one the team shares by hand: that one
    // has its own settings and stays open when the portal is switched off.
    const existing = (await sharesOf(ctx, review._id)).find(
      (share) => share.portalId === portal._id,
    );
    if (existing) return existing.token;
    const token = newToken();
    await ctx.db.insert("reviewShares", {
      reviewId: review._id,
      organizationId: review.organizationId,
      token,
      createdBy: portal.createdBy,
      allowVerdict: portal.allowVerdict,
      showTeamComments: portal.showTeamComments,
      portalId: portal._id,
    });
    return token;
  },
});

/** The team's logo file, when the portal behind this link is live. */
export const logoTarget = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const found = await portalFor(ctx, args.token);
    return found ? await teamLogoFile(ctx, found.client.organizationId) : null;
  },
});

/**
 * A link the portal shows the team's uploaded logo from. Visitors are not signed in, so the
 * portal's secret is what lets them see it. Null when there is no uploaded logo to show.
 */
export const logoLink = action({
  args: { token: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    return await signLogo(ctx, await ctx.runQuery(internal.portal.logoTarget, args));
  },
});

/** A finished piece the client may download: approved or published, in one of their projects. */
export const finishedPiece = internalQuery({
  args: { token: v.string(), projectId: v.string(), slotId: v.string() },
  handler: async (ctx, args) => {
    const found = await portalFor(ctx, args.token);
    if (!found) return null;
    const project = await projectIn(ctx, found.client, args.projectId);
    const id = ctx.db.normalizeId("deliverables", args.slotId);
    const slot = project && id ? await ctx.db.get(id) : null;
    if (!project || !slot || slot.projectId !== project._id) return null;
    if (slot.status !== "approved" && slot.status !== "published") return null;
    const url = newest(slot);
    return url ? { organizationId: project.organizationId, url, label: slot.label } : null;
  },
});

/**
 * A link that downloads one finished piece. Only approved and published pieces of the
 * client's own projects; null for anything else. A piece kept outside the team's folder
 * comes back as its own address, which the page opens.
 */
export const downloadLink = action({
  args: { token: v.string(), projectId: v.string(), slotId: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    const piece = await ctx.runQuery(internal.portal.finishedPiece, args);
    if (!piece) return null;
    const ending = /\.[A-Za-z0-9]{1,5}$/.exec(new URL(piece.url).pathname)?.[0] ?? "";
    const name = `${piece.label.replace(/[\\/:*?"<>|]/g, "-").trim() || "Download"}${ending}`;
    return (await signDownload(ctx, piece.organizationId, piece.url, name)) ?? piece.url;
  },
});
