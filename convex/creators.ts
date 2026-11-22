import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server";
import { notify } from "./lib/alerts";
import { isMember, requireMember } from "./lib/authz";
import { WARN_DAYS, addDays, cleanCreator, dayOf, isDay, rightsMessage } from "./lib/creatorRights";

/**
 * The creators who film for a team, and their usage rights. Rights are kept per deal, as
 * UGC contracts are: a creator filming for a brand licenses the footage for a set time
 * (often 30, 60 or 90 days, or 6 to 12 months), organic, paid or both. One creator can
 * have several deals with different end dates. A week before a deal's last day, a daily
 * check tells everyone on the team, in Inbox, by email and in the chat apps they linked.
 */

export const MAX_CREATORS = 500;
const NAME_LIMIT = 80;
const usage = v.union(v.literal("organic"), v.literal("paid"), v.literal("both"));

function refuse(message: string): never {
  throw new ConvexError({ code: "invalid", message });
}

function cleanName(name: string): string {
  const clean = cleanCreator(name);
  if (!clean) refuse("Add the creator's name.");
  if (clean.length > NAME_LIMIT) refuse(`Keep the name to ${NAME_LIMIT} letters.`);
  return clean;
}

async function teamCreators(ctx: QueryCtx, organizationId: string) {
  return await ctx.db
    .query("creators")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(MAX_CREATORS);
}

async function dealsOf(ctx: QueryCtx, creatorId: Id<"creators">) {
  const deals = await ctx.db
    .query("creatorRights")
    .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
    .take(200);
  return deals.sort((a, b) => a.endsOn.localeCompare(b.endsOn));
}

/** The creator folder names that started the team's recent runs. */
async function folderNames(ctx: QueryCtx, organizationId: string) {
  const runs = await ctx.db
    .query("runs")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .order("desc")
    .take(300);
  const names = new Map<string, string>();
  for (const run of runs) {
    const creator = (run.trigger as { creator?: unknown } | null)?.creator;
    if (typeof creator !== "string") continue;
    const name = cleanCreator(creator);
    if (name) names.set(name.toLowerCase(), name);
  }
  return { runs, names };
}

async function loadForMember(ctx: MutationCtx, creatorId: Id<"creators">) {
  const creator = await ctx.db.get(creatorId);
  if (!creator) refuse("That creator is gone.");
  const { userId } = await requireMember(ctx, creator.organizationId);
  return { creator, userId };
}

async function nameTaken(
  ctx: QueryCtx,
  organizationId: string,
  name: string,
  except?: Id<"creators">,
) {
  const all = await teamCreators(ctx, organizationId);
  return all.some(
    (other) => other._id !== except && other.name.toLowerCase() === name.toLowerCase(),
  );
}

async function clientName(ctx: QueryCtx, clientId: Id<"clients"> | undefined) {
  if (!clientId) return null;
  return (await ctx.db.get(clientId))?.name ?? null;
}

/** The Creators page: every creator with their next deal to end, and folders not added yet. */
export const list = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const creators = await teamCreators(ctx, args.organizationId);
    creators.sort((a, b) => a.name.localeCompare(b.name));
    const rows = [];
    for (const creator of creators) {
      const deals = await dealsOf(ctx, creator._id);
      const next = deals[0];
      rows.push({
        _id: creator._id,
        name: creator.name,
        deals: deals.length,
        // The deal that ends first, ended ones included, so a lapsed deal stays in sight.
        next: next ? { endsOn: next.endsOn, client: await clientName(ctx, next.clientId) } : null,
      });
    }
    const kept = new Set(creators.map((creator) => creator.name.toLowerCase()));
    const { names } = await folderNames(ctx, args.organizationId);
    const seen = [...names.entries()]
      .filter(([key]) => !kept.has(key))
      .map(([, name]) => name)
      .sort((a, b) => a.localeCompare(b));
    return { creators: rows, seen };
  },
});

/** One creator's page: their deals, the team's clients to pick from, and runs from their folder. */
export const get = query({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, args) => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator || !(await isMember(ctx, creator.organizationId))) return null;
    const deals = [];
    for (const deal of await dealsOf(ctx, creator._id)) {
      deals.push({
        _id: deal._id,
        clientId: deal.clientId ?? null,
        client: await clientName(ctx, deal.clientId),
        endsOn: deal.endsOn,
        usage: deal.usage,
        note: deal.note ?? "",
        alerted: deal.alertedFor === deal.endsOn,
      });
    }
    const clients = await ctx.db
      .query("clients")
      .withIndex("by_organization", (q) => q.eq("organizationId", creator.organizationId))
      .take(200);
    const { runs } = await folderNames(ctx, creator.organizationId);
    const mine = runs
      .filter((run) => {
        const name = (run.trigger as { creator?: unknown } | null)?.creator;
        return (
          typeof name === "string" &&
          cleanCreator(name).toLowerCase() === creator.name.toLowerCase()
        );
      })
      .slice(0, 20)
      .map((run: Doc<"runs">) => ({
        _id: run._id,
        automationId: run.automationId,
        automationName: run.automationName,
        status: run.status,
        startedAt: run._creationTime,
      }));
    return {
      _id: creator._id,
      organizationId: creator.organizationId,
      name: creator.name,
      deals,
      clients: clients
        .map((client) => ({ _id: client._id, name: client.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      runs: mine,
    };
  },
});

export const create = mutation({
  args: { organizationId: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.organizationId);
    const name = cleanName(args.name);
    if (await nameTaken(ctx, args.organizationId, name)) refuse(`${name} is already here.`);
    if ((await teamCreators(ctx, args.organizationId)).length >= MAX_CREATORS)
      refuse(`A team keeps up to ${MAX_CREATORS} creators.`);
    return await ctx.db.insert("creators", {
      organizationId: args.organizationId,
      name,
      createdBy: userId,
    });
  },
});

export const rename = mutation({
  args: { creatorId: v.id("creators"), name: v.string() },
  handler: async (ctx, args) => {
    const { creator } = await loadForMember(ctx, args.creatorId);
    const name = cleanName(args.name);
    if (await nameTaken(ctx, creator.organizationId, name, creator._id))
      refuse(`${name} is already here.`);
    await ctx.db.patch(creator._id, { name });
  },
});

/** Removes a creator and their deals. Their footage and runs stay. */
export const remove = mutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, args) => {
    const { creator } = await loadForMember(ctx, args.creatorId);
    for (const deal of await dealsOf(ctx, creator._id)) await ctx.db.delete(deal._id);
    await ctx.db.delete(creator._id);
  },
});

/** Adds a deal, or changes one. A changed end date can be warned about again. */
export const saveDeal = mutation({
  args: {
    creatorId: v.id("creators"),
    dealId: v.optional(v.id("creatorRights")),
    clientId: v.optional(v.id("clients")),
    endsOn: v.string(),
    usage,
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { creator, userId } = await loadForMember(ctx, args.creatorId);
    if (!isDay(args.endsOn)) refuse("Pick the last day the footage may be used.");
    if (args.clientId) {
      const client = await ctx.db.get(args.clientId);
      if (!client || client.organizationId !== creator.organizationId)
        refuse("That client is not on this team.");
    }
    const fields = {
      clientId: args.clientId,
      endsOn: args.endsOn,
      usage: args.usage,
      note: args.note?.trim().slice(0, 300) || undefined,
      updatedBy: userId,
      updatedAt: Date.now(),
    };
    if (args.dealId) {
      const deal = await ctx.db.get(args.dealId);
      if (!deal || deal.creatorId !== creator._id) refuse("That deal is gone.");
      await ctx.db.patch(deal._id, {
        ...fields,
        alertedFor: deal.alertedFor === args.endsOn ? deal.alertedFor : undefined,
      });
      return deal._id;
    }
    return await ctx.db.insert("creatorRights", {
      organizationId: creator.organizationId,
      creatorId: creator._id,
      ...fields,
    });
  },
});

export const removeDeal = mutation({
  args: { dealId: v.id("creatorRights") },
  handler: async (ctx, args) => {
    const deal = await ctx.db.get(args.dealId);
    if (!deal) return;
    await requireMember(ctx, deal.organizationId);
    await ctx.db.delete(deal._id);
  },
});

/**
 * Once a day: every deal whose last day is within a week, and that has not been warned
 * about for that date, raises one alert for the whole team.
 */
export const checkEnding = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const today = dayOf(args.now ?? Date.now());
    const due = await ctx.db
      .query("creatorRights")
      .withIndex("by_ends", (q) => q.gte("endsOn", today).lte("endsOn", addDays(today, WARN_DAYS)))
      .take(1000);
    let sent = 0;
    for (const deal of due) {
      if (deal.alertedFor === deal.endsOn) continue;
      const creator = await ctx.db.get(deal.creatorId);
      if (!creator) continue;
      await notify(ctx, {
        organizationId: deal.organizationId,
        kind: "rights_ending",
        creatorId: creator._id,
        automationName: creator.name,
        stepName: (await clientName(ctx, deal.clientId)) ?? undefined,
        message: rightsMessage(deal.endsOn, today, deal.usage),
        retries: 0,
      });
      await ctx.db.patch(deal._id, { alertedFor: deal.endsOn });
      sent += 1;
    }
    return sent;
  },
});
