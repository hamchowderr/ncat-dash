import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, type QueryCtx, query } from "./_generated/server";
import { getCaller } from "./lib/caller";

/**
 * Your profile beyond what Better Auth keeps: the time zone the app shows and runs
 * things in, what you do on a team, and the stored file behind your photo.
 *
 * The photo is uploaded straight to Convex file storage (`avatarUploadUrl`), then
 * `setAvatar` keeps it and hands back its address, which Better Auth saves as the
 * person's `image`. A new photo or `removeAvatar` deletes the old file, and so does
 * deleting the account (accountDeletion.prepare).
 */

/** Longest "what you do", so it fits beside a name. */
export const TITLE_LONGEST = 60;

/** Photos bigger than this are refused. The page shrinks them to 256 pixels first. */
export const AVATAR_LARGEST = 2 * 1024 * 1024;

const profileValidator = v.object({
  timeZone: v.union(v.string(), v.null()),
  title: v.union(v.string(), v.null()),
});

/** True for an IANA zone the runtime knows, such as "Europe/Berlin". */
export function isTimeZone(zone: string): boolean {
  if (!zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

async function profileOf(ctx: QueryCtx | MutationCtx, userId: string) {
  return await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

async function requireCaller(ctx: QueryCtx | MutationCtx) {
  const user = await getCaller(ctx);
  if (!user) throw new ConvexError("Sign in first.");
  return user;
}

/** Your time zone and what you do. Null when nobody is signed in. */
export const mine = query({
  args: {},
  returns: v.union(v.null(), profileValidator),
  handler: async (ctx) => {
    const user = await getCaller(ctx);
    if (!user) return null;
    const profile = await profileOf(ctx, user._id);
    return { timeZone: profile?.timeZone ?? null, title: profile?.title ?? null };
  },
});

/** Changes your time zone or what you do. An empty title clears it. */
export const update = mutation({
  args: { timeZone: v.optional(v.string()), title: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireCaller(ctx);
    const changes: { timeZone?: string; title?: string } = {};
    if (args.timeZone !== undefined) {
      if (!isTimeZone(args.timeZone)) throw new ConvexError("Pick a time zone from the list.");
      changes.timeZone = args.timeZone;
    }
    let clearTitle = false;
    if (args.title !== undefined) {
      const title = args.title.trim().replace(/\s+/g, " ");
      if (title.length > TITLE_LONGEST) {
        throw new ConvexError(`Keep it to ${TITLE_LONGEST} characters.`);
      }
      if (title) changes.title = title;
      else clearTitle = true;
    }
    const profile = await profileOf(ctx, user._id);
    if (!profile) {
      await ctx.db.insert("profiles", { userId: user._id, ...changes });
      return null;
    }
    await ctx.db.patch(profile._id, { ...changes, ...(clearTitle && { title: undefined }) });
    return null;
  },
});

/**
 * Sets your time zone from the browser, only when you have none yet. A zone you picked
 * yourself is never overwritten by the browser of a trip.
 */
export const fillTimeZone = mutation({
  args: { timeZone: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getCaller(ctx);
    if (!user || !isTimeZone(args.timeZone)) return null;
    const profile = await profileOf(ctx, user._id);
    if (!profile) await ctx.db.insert("profiles", { userId: user._id, timeZone: args.timeZone });
    else if (!profile.timeZone) await ctx.db.patch(profile._id, { timeZone: args.timeZone });
    return null;
  },
});

/** Where the page sends a new photo. Only for someone signed in. */
export const avatarUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireCaller(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

async function deleteFile(ctx: MutationCtx, file: Id<"_storage"> | undefined) {
  if (!file) return;
  if (await ctx.db.system.get(file)) await ctx.storage.delete(file);
}

/**
 * Keeps the photo just uploaded as yours and returns its address, which goes on your
 * account as its image. The photo it replaces is deleted. A file that is not a picture,
 * or is too big, is deleted and `problem` says why (returned, not thrown, so the delete
 * holds).
 */
export const setAvatar = mutation({
  args: { file: v.id("_storage") },
  returns: v.union(v.object({ url: v.string() }), v.object({ problem: v.string() })),
  handler: async (ctx, args) => {
    const user = await requireCaller(ctx);
    const meta = await ctx.db.system.get(args.file);
    if (!meta) throw new ConvexError("That photo did not upload. Try again.");
    if (!meta.contentType?.startsWith("image/") || meta.size > AVATAR_LARGEST) {
      await ctx.storage.delete(args.file);
      return { problem: "Use a picture file under 2 MB." };
    }
    const url = await ctx.storage.getUrl(args.file);
    if (!url) throw new ConvexError("That photo did not upload. Try again.");
    const profile = await profileOf(ctx, user._id);
    if (!profile) {
      await ctx.db.insert("profiles", { userId: user._id, avatar: args.file });
    } else {
      if (profile.avatar !== args.file) await deleteFile(ctx, profile.avatar);
      await ctx.db.patch(profile._id, { avatar: args.file });
    }
    return { url };
  },
});

/** Deletes your stored photo. Your account's image is cleared by the page. */
export const removeAvatar = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireCaller(ctx);
    const profile = await profileOf(ctx, user._id);
    if (!profile?.avatar) return null;
    await deleteFile(ctx, profile.avatar);
    await ctx.db.patch(profile._id, { avatar: undefined });
    return null;
  },
});

/** For deleting an account: the profile row and the photo file both go. */
export async function forgetProfile(ctx: MutationCtx, userId: string) {
  const profile = await profileOf(ctx, userId);
  if (!profile) return;
  await deleteFile(ctx, profile.avatar);
  await ctx.db.delete(profile._id);
}

/** What each of these people does, by user id, for lists of teammates. */
export async function titlesOf(ctx: QueryCtx, userIds: string[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  for (const userId of userIds) {
    const profile = await profileOf(ctx, userId);
    if (profile?.title) titles.set(userId, profile.title);
  }
  return titles;
}
