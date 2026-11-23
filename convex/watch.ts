import { creatorSets, fileFamily, withCreatorTakes } from "@takewon/automation-core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { FunctionReturnType } from "convex/server";
import type { CreatorTakes } from "@takewon/automation-core";
import { startRun } from "./lib/runner";
import { enabledWithTriggerPage, triggersOfKind } from "./lib/triggers";
import { bucketOf, listObjects, presign, storageConnection } from "./lib/bucket";

const READ_LINK_SECONDS = 7 * 24 * 60 * 60;
// One check starts at most this many runs per automation; the rest follow a minute later.
const MAX_NEW_FILES_PER_CHECK = 20;

// How many automations one read of the watchers looks at.
const WATCHERS_PAGE = 100;

/**
 * One page of the switched-on automations that watch a folder, with their team's bucket.
 * The check reads page after page, first those whose first trigger watches a folder, then
 * those with several triggers, so every team's folders are looked in however many there are.
 */
export const watchers = internalQuery({
  args: {
    source: v.optional(v.union(v.literal("first"), v.literal("several"))),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const source = args.source ?? "first";
    const { page, continueCursor, isDone } = await enabledWithTriggerPage(
      ctx,
      "folder",
      source,
      args.cursor ?? null,
      WATCHERS_PAGE,
    );
    const automations = page;
    const found = [];
    for (const automation of automations) {
      const folders = triggersOfKind(automation, "folder");
      if (folders.length === 0) continue;
      const storage = await storageConnection(ctx, automation.organizationId);
      if (!storage) continue;
      // An automation with two watched folders is one watcher for each.
      for (const { id, trigger } of folders) {
        found.push({
          automationId: automation._id,
          triggerId: id,
          prefix: trigger.prefix,
          fileType: trigger.fileType,
          ...(trigger.layout ? { layout: trigger.layout } : {}),
          watchFrom: automation.watchFrom ?? automation.updatedAt,
          storage,
        });
      }
    }
    // Where the next read starts, or null when every watcher has been read.
    const next: { source: "first" | "several"; cursor: string | null } | null = !isDone
      ? { source, cursor: continueCursor }
      : source === "first"
        ? { source: "several", cursor: null }
        : null;
    return { found, next };
  },
});

/** Runs every minute: looks in each watched folder and starts a run for every new file. */
export const poll = internalAction({
  args: {},
  handler: async (ctx) => {
    const watching: Watcher[] = [];
    let at: { source: "first" | "several"; cursor: string | null } | null = {
      source: "first",
      cursor: null,
    };
    while (at) {
      const read: FunctionReturnType<typeof internal.watch.watchers> = await ctx.runQuery(
        internal.watch.watchers,
        at,
      );
      watching.push(...read.found);
      at = read.next;
    }
    // Automations that watch the same folder share one listing.
    const listings = new Map<string, Awaited<ReturnType<typeof listObjects>>>();

    for (const watcher of watching) {
      const { storage } = watcher;
      const config = await bucketOf(storage);
      const listingKey = `${storage._id}:${watcher.prefix}`;
      try {
        if (!listings.has(listingKey)) {
          listings.set(listingKey, await listObjects(config, watcher.prefix));
        }
      } catch (error) {
        console.warn(`Could not list the watched folder for ${watcher.automationId}:`, error);
        continue;
      }

      const listing = listings.get(listingKey)!;
      if (watcher.layout === "creators") {
        await startCreatorSets(ctx, watcher, config, listing);
        continue;
      }

      const candidates = listing
        .filter(
          (object) =>
            object.size > 0 &&
            !object.key.endsWith("/") &&
            object.lastModified > watcher.watchFrom &&
            (watcher.fileType === "any" || fileFamily(object.key) === watcher.fileType),
        )
        .sort((a, b) => a.lastModified - b.lastModified);
      if (candidates.length === 0) continue;

      const fresh: { key: string; etag: string; size: number }[] = await ctx.runMutation(
        internal.watch.claim,
        {
          automationId: watcher.automationId,
          objects: candidates.map(({ key, etag, size }) => ({ key, etag, size })),
        },
      );
      for (const object of fresh) {
        await ctx.runMutation(internal.watch.start, {
          automationId: watcher.automationId,
          triggerId: watcher.triggerId,
          trigger: {
            file_url: await presign(config, "GET", object.key, READ_LINK_SECONDS),
            file_name: object.key.split("/").pop() ?? object.key,
            key: object.key,
            size: object.size,
          },
        });
      }
    }
  },
});

type Watcher = FunctionReturnType<typeof internal.watch.watchers>["found"][number];

/**
 * A folder laid out one folder per creator: each creator whose takes have settled and
 * have something new since the last run starts one run, on their body, with every take.
 * Takes that were already there count too, so a new hook take re-makes the whole set.
 */
async function startCreatorSets(
  ctx: ActionCtx,
  watcher: Watcher,
  config: Awaited<ReturnType<typeof bucketOf>>,
  listing: Awaited<ReturnType<typeof listObjects>>,
) {
  const isVideo = (key: string) => {
    const family = fileFamily(key);
    return watcher.fileType === "any" ? family === "video" : family === watcher.fileType;
  };
  let started = 0;
  for (const set of creatorSets(listing, watcher.prefix, Date.now(), isVideo)) {
    if (started >= MAX_NEW_FILES_PER_CHECK) break;
    // Only a set with a file that landed after the folder was switched on.
    if (!set.files.some((object) => object.lastModified > watcher.watchFrom)) continue;
    const fresh: boolean = await ctx.runMutation(internal.watch.claimSet, {
      automationId: watcher.automationId,
      objects: set.files
        .filter((object) => object.lastModified > watcher.watchFrom)
        .map(({ key, etag }) => ({ key, etag })),
    });
    if (!fresh) continue;
    const link = async (object: { key: string }) => ({
      file_url: await presign(config, "GET", object.key, READ_LINK_SECONDS),
      file_name: object.key.split("/").pop() ?? object.key,
    });
    await ctx.runMutation(internal.watch.start, {
      automationId: watcher.automationId,
      triggerId: watcher.triggerId,
      trigger: {
        ...(await link(set.body)),
        key: set.body.key,
        size: set.body.size,
        creator: set.creator,
        hooks: await Promise.all(set.hooks.map(link)),
        endings: await Promise.all(set.endings.map(link)),
      },
    });
    started += 1;
  }
}

/**
 * Marks a creator's files as taken. True when one of them is new, or has new contents,
 * since the last time: then the set starts a run.
 */
export const claimSet = internalMutation({
  args: {
    automationId: v.id("automations"),
    objects: v.array(v.object({ key: v.string(), etag: v.string() })),
  },
  handler: async (ctx, args) => {
    let fresh = false;
    for (const object of args.objects) {
      const seen = await ctx.db
        .query("watchedFiles")
        .withIndex("by_automation_and_key", (q) =>
          q.eq("automationId", args.automationId).eq("key", object.key),
        )
        .first();
      if (seen?.etag === object.etag) continue;
      fresh = true;
      if (seen) await ctx.db.patch(seen._id, { etag: object.etag });
      else await ctx.db.insert("watchedFiles", { automationId: args.automationId, ...object });
    }
    return fresh;
  },
});

/** Marks files as taken and returns the ones nobody had taken before. */
export const claim = internalMutation({
  args: {
    automationId: v.id("automations"),
    objects: v.array(v.object({ key: v.string(), etag: v.string(), size: v.number() })),
  },
  handler: async (ctx, args) => {
    const fresh = [];
    for (const object of args.objects) {
      if (fresh.length >= MAX_NEW_FILES_PER_CHECK) break;
      const seen = await ctx.db
        .query("watchedFiles")
        .withIndex("by_automation_and_key", (q) =>
          q.eq("automationId", args.automationId).eq("key", object.key),
        )
        .first();
      // The same name with new contents counts as a new file.
      if (seen?.etag === object.etag) continue;
      if (seen) await ctx.db.patch(seen._id, { etag: object.etag });
      else {
        await ctx.db.insert("watchedFiles", {
          automationId: args.automationId,
          key: object.key,
          etag: object.etag,
        });
      }
      fresh.push(object);
    }
    return fresh;
  },
});

export const start = internalMutation({
  args: {
    automationId: v.id("automations"),
    // Which folder trigger saw the file. Older calls left it out: the first one.
    triggerId: v.optional(v.string()),
    trigger: v.any(),
  },
  handler: async (ctx, args) => {
    const automation = await ctx.db.get(args.automationId as Id<"automations">);
    if (!automation || !automation.enabled) return;
    const folders = triggersOfKind(automation, "folder");
    const folder = args.triggerId ? folders.find((each) => each.id === args.triggerId) : folders[0];
    if (!folder) return;
    // A creator's takes go into the steps that pair them up, on this run only.
    const takes = creatorTakesOf(args.trigger);
    const running = takes
      ? { ...automation, nodes: withCreatorTakes(automation.nodes, takes) }
      : automation;
    await startRun(ctx, running, "folder", args.trigger, null, { triggerId: folder.id });
  },
});

/** The takes a creator folder's run was started with, or null for a single file. */
function creatorTakesOf(trigger: unknown): CreatorTakes | null {
  if (!trigger || typeof trigger !== "object") return null;
  const { creator, hooks, endings } = trigger as Record<string, unknown>;
  if (typeof creator !== "string" || !Array.isArray(hooks)) return null;
  const links = (list: unknown) =>
    (Array.isArray(list) ? list : []).filter(
      (each): each is { file_url: string; file_name: string } =>
        !!each && typeof each === "object" && typeof each.file_url === "string",
    );
  return { creator, hooks: links(hooks), endings: links(endings) };
}
