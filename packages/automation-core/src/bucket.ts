// How the Files page reads a bucket. A bucket has no real folders and no rename: a folder
// is every key that starts with "name/", and a rename or move is a copy to the new key
// followed by deleting the old one. These helpers work out the new keys and keep the
// links that point at a moved file in step.

/**
 * Where one team's files live in the bucket. Many teams can share one toolkit (and so one
 * bucket), so each team only ever sees inside its own folder: to the team, this folder is
 * the top of its storage, and every key the app keeps is written from here.
 */
export function teamFolder(organizationId: string): string {
  return `teams/${organizationId}/`;
}

/** A folder is written as its prefix, ending in a slash: "clips/tuesday/". */
export function isFolderKey(key: string): boolean {
  return key.endsWith("/");
}

/** The last part of a key: "a/b/clip.mp4" gives "clip.mp4", "a/b/" gives "b". */
export function baseName(key: string): string {
  const trimmed = isFolderKey(key) ? key.slice(0, -1) : key;
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** The folder a key sits in: "a/b/clip.mp4" and "a/b/" give "a/b/" and "a/". Top level is "". */
export function parentOf(key: string): string {
  const trimmed = isFolderKey(key) ? key.slice(0, -1) : key;
  return trimmed.slice(0, trimmed.lastIndexOf("/") + 1);
}

/** The folders from the top of the bucket down to this one, for the path shown above a list. */
export function folderTrail(prefix: string): { name: string; prefix: string }[] {
  const trail: { name: string; prefix: string }[] = [];
  let at = "";
  for (const part of prefix.split("/").slice(0, -1)) {
    at += `${part}/`;
    trail.push({ name: part, prefix: at });
  }
  return trail;
}

export const MAX_NAME_LENGTH = 200;

/** Why a name cannot be used for a file or folder, or null when it can. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Type a name.";
  if (trimmed.length > MAX_NAME_LENGTH) return `Keep the name under ${MAX_NAME_LENGTH} letters.`;
  if (/[/\\]/.test(trimmed)) return "A name cannot contain a slash.";
  if (trimmed === "." || trimmed === "..") return "Choose a different name.";
  // Control characters break links and listings on some storage services.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return "Remove the unusual characters from the name.";
  return null;
}

/** The key a file or folder has after it is given a new name in the same place. */
export function renamedKey(key: string, name: string): string {
  return `${parentOf(key)}${name.trim()}${isFolderKey(key) ? "/" : ""}`;
}

/** The key a file or folder has after it is moved into another folder. */
export function movedKey(key: string, toFolder: string): string {
  return `${toFolder}${baseName(key)}${isFolderKey(key) ? "/" : ""}`;
}

/** Why something cannot be moved to a new key, or null when it can. */
export function moveProblem(from: string, to: string): string | null {
  if (from === to) return "It is already there.";
  if (isFolderKey(from) && to.startsWith(from)) return "A folder cannot be moved into itself.";
  return null;
}

/** Where one object inside a moved folder ends up: the folder part is swapped, the rest kept. */
export function keyInsideMovedFolder(objectKey: string, from: string, to: string): string {
  return `${to}${objectKey.slice(from.length)}`;
}

/** A name that is free: "clip.mp4", then "clip (2).mp4", "clip (3).mp4" and so on. */
export function freeName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ending = dot > 0 ? name.slice(dot) : "";
  for (let count = 2; count < 1000; count++) {
    const candidate = `${stem} (${count})${ending}`;
    if (!taken(candidate)) return candidate;
  }
  return `${stem} (${Date.now()})${ending}`;
}

export interface BucketAddress {
  endpoint: string;
  bucket: string;
  /**
   * The public address files are handed out under, when there is one: the toolkit's
   * S3_PUBLIC_URL, such as "https://files.example.com". A file's link is this, a slash
   * and its key.
   */
  publicUrl?: string;
  /**
   * The team's folder ("teams/<id>/"). Keys are then written from inside it, and a link
   * to anything outside it has no key.
   */
  root?: string;
}

function publicBase(address: BucketAddress): string | null {
  const base = address.publicUrl?.trim().replace(/\/+$/, "");
  return base ? base : null;
}

function decoded(path: string): string | null {
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

/**
 * The key a plain link points at, when the link is to this bucket: either
 * "<endpoint>/<bucket>/<key>" (how the toolkit writes its results) or
 * "<bucket>.<endpoint host>/<key>", or "<public address>/<key>" when the bucket has a
 * public address. A signed link, or one to anywhere else, gives null.
 */
export function keyOfUrl(address: BucketAddress, link: string): string | null {
  const key = bucketKeyOfUrl(address, link);
  if (key === null || !address.root) return key;
  return key.startsWith(address.root) && key.length > address.root.length
    ? key.slice(address.root.length)
    : null;
}

function bucketKeyOfUrl(address: BucketAddress, link: string): string | null {
  let url: URL;
  let endpoint: URL;
  try {
    url = new URL(link);
    endpoint = new URL(address.endpoint);
  } catch {
    return null;
  }
  if (url.search || url.hash) return null;
  const path = decoded(url.pathname);
  if (path === null) return null;
  const shared = publicBase(address);
  if (shared) {
    try {
      const open = new URL(shared);
      const under = decoded(open.pathname.replace(/\/+$/, ""));
      if (url.origin === open.origin && under !== null && path.startsWith(`${under}/`)) {
        return path.slice(under.length + 1) || null;
      }
    } catch {
      // Not an address: fall through to the bucket's own.
    }
  }
  const base = endpoint.pathname.replace(/\/+$/, "");
  if (url.host === endpoint.host && path.startsWith(`${base}/${address.bucket}/`)) {
    return path.slice(base.length + address.bucket.length + 2) || null;
  }
  if (url.host === `${address.bucket}.${endpoint.host}` && path.startsWith(`${base}/`)) {
    return path.slice(base.length + 1) || null;
  }
  return null;
}

/** The same link, pointing at another key in the same bucket. */
export function urlWithKey(address: BucketAddress, link: string, key: string): string {
  const url = new URL(link);
  const endpoint = new URL(address.endpoint);
  const base = endpoint.pathname.replace(/\/+$/, "");
  const path = `${address.root ?? ""}${key}`.split("/").map(encodeURIComponent).join("/");
  const shared = publicBase(address);
  if (shared && url.origin === new URL(shared).origin && url.host !== endpoint.host) {
    return `${shared}/${path}`;
  }
  url.pathname =
    url.host === endpoint.host ? `${base}/${address.bucket}/${path}` : `${base}/${path}`;
  return url.toString();
}

/**
 * Follows moved and deleted files through anything that holds links: a list of outputs, a
 * job result, a brand setting. `moved` maps an old key to its new one, or to null when
 * the file was deleted. A link to a deleted file is dropped from a list and left alone
 * anywhere else. Returns the same value when nothing in it changed.
 */
export function followMoves<T>(
  address: BucketAddress,
  value: T,
  moved: ReadonlyMap<string, string | null>,
  depth = 0,
): T {
  if (depth > 8) return value;
  if (typeof value === "string") {
    if (!/^https?:\/\//.test(value)) return value;
    const key = keyOfUrl(address, value);
    const to = key === null ? undefined : moved.get(key);
    return (to ? urlWithKey(address, value, to) : value) as T;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next: unknown[] = [];
    for (const item of value) {
      if (typeof item === "string") {
        const key = keyOfUrl(address, item);
        if (key !== null && moved.get(key) === null) {
          changed = true;
          continue;
        }
      }
      const followed = followMoves(address, item, moved, depth + 1);
      if (followed !== item) changed = true;
      next.push(followed);
    }
    return (changed ? next : value) as T;
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [name, item] of Object.entries(value)) {
      const followed = followMoves(address, item, moved, depth + 1);
      if (followed !== item) changed = true;
      next[name] = followed;
    }
    return (changed ? next : value) as T;
  }
  return value;
}

/** Where a watched folder points after a folder above it (or the folder itself) moved. */
export function followFolder(prefix: string, folders: { from: string; to: string }[]): string {
  for (const { from, to } of folders) {
    if (prefix.startsWith(from)) return keyInsideMovedFolder(prefix, from, to);
  }
  return prefix;
}
