import {
  fileFamily,
  librarySearchText,
  shortIdLetter,
  titleFromFileName,
  uploadKind,
  type LibraryKind,
  type LibrarySource,
} from "@ncat-dash/automation-core";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** The team's library settings, or the defaults. */
export async function librarySettingsOf(ctx: QueryCtx, organizationId: string) {
  const row = await ctx.db
    .query("librarySettings")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .first();
  return { row, searchNewFiles: row?.searchNewFiles ?? false, filledAt: row?.filledAt ?? null };
}

/** Hands out the team's next short ID for a letter: "V1", then "V2", and so on. */
export async function nextShortId(
  ctx: MutationCtx,
  organizationId: string,
  letter: string,
): Promise<string> {
  const counter = await ctx.db
    .query("libraryCounters")
    .withIndex("by_organization_and_letter", (q) =>
      q.eq("organizationId", organizationId).eq("letter", letter),
    )
    .first();
  const number = counter?.next ?? 1;
  if (counter) await ctx.db.patch(counter._id, { next: number + 1 });
  else await ctx.db.insert("libraryCounters", { organizationId, letter, next: number + 1 });
  return `${letter}${number}`;
}

type NewItem = {
  organizationId: string;
  kind: LibraryKind;
  source: LibrarySource;
  title: string;
  key?: string;
  url?: string;
  uploadId?: Id<"uploads">;
  runId?: Id<"runs">;
  automationName?: string;
  parentId?: Id<"libraryItems">;
  details?: Doc<"libraryItems">["details"];
  createdBy: string | null;
};

/**
 * Adds a file to the library with its short ID. When the team has asked for every new file
 * to be searchable, a video or sound is sent to be transcribed straight away.
 */
export async function addLibraryItem(ctx: MutationCtx, item: NewItem): Promise<Id<"libraryItems">> {
  const shortId = await nextShortId(
    ctx,
    item.organizationId,
    shortIdLetter(item.kind, item.source),
  );
  const title = item.title.trim().slice(0, 200) || shortId;
  const itemId = await ctx.db.insert("libraryItems", {
    ...item,
    shortId,
    title,
    tags: [],
    searchText: librarySearchText({
      shortId,
      title,
      tags: [],
      automationName: item.automationName,
    }),
  });
  const { searchNewFiles } = await librarySettingsOf(ctx, item.organizationId);
  if (searchNewFiles && (item.kind === "video" || item.kind === "audio")) {
    await ctx.scheduler.runAfter(0, internal.library.transcribe, { itemId });
  }
  return itemId;
}

/** Adds an upload to the library, once. Brand files (a logo, music) are left out. */
export async function addUploadToLibrary(
  ctx: MutationCtx,
  upload: Doc<"uploads">,
): Promise<Id<"libraryItems"> | null> {
  if (upload.purpose === "brand" || upload.status !== "ready") return null;
  const already = await ctx.db
    .query("libraryItems")
    .withIndex("by_upload", (q) => q.eq("uploadId", upload._id))
    .first();
  if (already) return already._id;
  return await addLibraryItem(ctx, {
    organizationId: upload.organizationId,
    kind: uploadKind(upload.contentType, upload.details),
    source: "upload",
    title: titleFromFileName(upload.fileName),
    key: upload.key,
    uploadId: upload._id,
    ...(upload.details ? { details: upload.details } : {}),
    createdBy: upload.createdBy,
  });
}

/**
 * The library file a run started from: the one named in its trigger, else the upload that
 * started it. A run another run started goes back to the first run of the chain.
 */
export async function startingItemOf(
  ctx: QueryCtx,
  run: Doc<"runs">,
): Promise<Id<"libraryItems"> | null> {
  let current: Doc<"runs"> | null = run;
  for (let depth = 0; current && depth < 10; depth++) {
    const trigger = (current.trigger ?? {}) as Record<string, unknown>;
    if (typeof trigger.library_item === "string") {
      const id = ctx.db.normalizeId("libraryItems", trigger.library_item);
      const item = id ? await ctx.db.get(id) : null;
      if (item && item.organizationId === run.organizationId) return item._id;
    }
    if (typeof trigger.upload_id === "string") {
      const uploadId = ctx.db.normalizeId("uploads", trigger.upload_id);
      if (uploadId) {
        const item = await ctx.db
          .query("libraryItems")
          .withIndex("by_upload", (q) => q.eq("uploadId", uploadId))
          .first();
        if (item && item.organizationId === run.organizationId) return item._id;
      }
    }
    current = current.parentRunId ? await ctx.db.get(current.parentRunId) : null;
  }
  return null;
}

/** What kind of file a run made, going by its name or else its address. */
export function kindOfMadeFile(name: string, link: string): LibraryKind {
  const byName = fileFamily(name);
  if (byName !== "other") return byName;
  try {
    return fileFamily(new URL(link).pathname);
  } catch {
    return "other";
  }
}

/** Removes a library file and what was said in it. Files made from it stay. */
export async function deleteLibraryItem(ctx: MutationCtx, itemId: Id<"libraryItems">) {
  await deletePieces(ctx, itemId);
  const children = await ctx.db
    .query("libraryItems")
    .withIndex("by_parent", (q) => q.eq("parentId", itemId))
    .take(500);
  for (const child of children) await ctx.db.patch(child._id, { parentId: undefined });
  await ctx.db.delete(itemId);
}

export async function deletePieces(ctx: MutationCtx, itemId: Id<"libraryItems">) {
  const pieces = await ctx.db
    .query("transcriptPieces")
    .withIndex("by_item_and_start", (q) => q.eq("itemId", itemId))
    .take(4000);
  for (const piece of pieces) await ctx.db.delete(piece._id);
}

/** Follows a file renamed or moved on the Files page; a deleted file leaves the library. */
export async function followLibraryKey(
  ctx: MutationCtx,
  organizationId: string,
  from: string,
  to: string | null,
) {
  const items = await ctx.db
    .query("libraryItems")
    .withIndex("by_organization_and_key", (q) =>
      q.eq("organizationId", organizationId).eq("key", from),
    )
    .take(10);
  for (const item of items) {
    if (to === null) await deleteLibraryItem(ctx, item._id);
    else await ctx.db.patch(item._id, { key: to });
  }
}
