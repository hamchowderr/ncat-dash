import { keyOfUrl, readUploadRef, teamFolder } from "@takewon/automation-core";
import { internal } from "../_generated/api";
import type { ActionCtx, QueryCtx } from "../_generated/server";
import { bucketOf, presign } from "./bucket";
import { brandOf } from "./queue";

// Links for people outside the team, who are not signed in: a client in their portal or a
// review room. Each one opens a single file the client is already meant to see, and nothing
// else in the team's storage.

// Long enough for a client reading the page; it asks again when it next opens.
export const CLIENT_LINK_SECONDS = 6 * 60 * 60;

export type LogoTarget = { organizationId: string; key: string };

/** The team's logo file, when it is one of the team's own finished uploads. */
export async function teamLogoFile(
  ctx: QueryCtx,
  organizationId: string,
): Promise<LogoTarget | null> {
  const uploadId = readUploadRef((await brandOf(ctx, organizationId)).logo);
  const id = uploadId ? ctx.db.normalizeId("uploads", uploadId) : null;
  const upload = id ? await ctx.db.get(id) : null;
  if (!upload || upload.organizationId !== organizationId || upload.status !== "ready") {
    return null;
  }
  return { organizationId, key: upload.key };
}

/** The team's brand as a client sees it: its logo (an address or upload pointer) and colour. */
export async function clientBrand(ctx: QueryCtx, organizationId: string) {
  const brand = await brandOf(ctx, organizationId);
  return { logo: brand.logo ?? null, color: brand.color ?? null };
}

/** Signs a link to the team's logo. Null when it cannot, so the letter mark stands in. */
export async function signLogo(ctx: ActionCtx, target: LogoTarget | null): Promise<string | null> {
  if (!target) return null;
  const connection = await ctx.runQuery(internal.storage.load, {
    organizationId: target.organizationId,
  });
  if (!connection) return null;
  try {
    return await presign(await bucketOf(connection), "GET", target.key, CLIENT_LINK_SECONDS);
  } catch {
    // A toolkit that is down only costs the page its logo.
    return null;
  }
}

/**
 * A link that downloads a finished file under its own name, when the file is in the team's
 * own folder. Null for a file anywhere else; the page then opens the file's own address.
 */
export async function signDownload(
  ctx: ActionCtx,
  organizationId: string,
  url: string,
  name: string,
): Promise<string | null> {
  const connection = await ctx.runQuery(internal.storage.load, { organizationId });
  if (!connection?.storage?.endpoint) return null;
  const key = keyOfUrl(
    {
      endpoint: connection.storage.endpoint,
      bucket: connection.storage.bucket,
      ...(connection.storage.publicUrl ? { publicUrl: connection.storage.publicUrl } : {}),
      root: teamFolder(organizationId),
    },
    url,
  );
  if (key === null) return null;
  try {
    return await presign(await bucketOf(connection), "GET", key, CLIENT_LINK_SECONDS, {
      downloadName: name,
    });
  } catch {
    return null;
  }
}
