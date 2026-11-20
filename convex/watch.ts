import { fileFamily } from "@ncat-dash/automation-core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { startRun } from "./lib/runner";
import { enabledWithTrigger, triggersOfKind } from "./lib/triggers";
import { bucketOf, listObjects, presign, storageConnection } from "./lib/bucket";

const READ_LINK_SECONDS = 7 * 24 * 60 * 60;
// One check starts at most this many runs per automation; the rest follow a minute later.
const MAX_NEW_FILES_PER_CHECK = 20;

/** Every switched-on automation that watches a folder, with its team's bucket. */
export const watchers = internalQuery({
  args: {},
  handler: async (ctx) => {
    const automations = await enabledWithTrigger(ctx, "folder", 200);
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
          watchFrom: automation.watchFrom ?? automation.updatedAt,
          storage,
        });
      }
    }
    return found;
  },
});

/** Runs every minute: looks in each watched folder and starts a run for every new file. */
export const poll = internalAction({
  args: {},
  handler: async (ctx) => {
    const watching = await ctx.runQuery(internal.watch.watchers, {});
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

      const candidates = listings
        .get(listingKey)!
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
    await startRun(ctx, automation, "folder", args.trigger, null, { triggerId: folder.id });
  },
});
