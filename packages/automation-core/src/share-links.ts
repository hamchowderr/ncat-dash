/**
 * Share links that just work. A Google Drive or Dropbox "share" link opens a web page
 * with a preview, not the file, so the toolkit downloads that page and the step fails.
 * These turn such a link into the address that downloads the file itself.
 */

export type ShareService = "Google Drive" | "Dropbox";

export type ShareLink =
  /** Not a Drive or Dropbox link, or already a download link: used as it is. */
  | { kind: "plain"; url: string }
  /** A share link, turned into the address that downloads the file. */
  | { kind: "fixed"; url: string; service: ShareService }
  /** A Drive or Dropbox link that no download address exists for, and why. */
  | { kind: "unusable"; url: string; service: ShareService; problem: string };

const DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"]);
const DROPBOX_HOSTS = new Set(["dropbox.com", "www.dropbox.com"]);
// Google's file ids are letters, digits, - and _, and long.
const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;

/** The address Google downloads a shared file from, without its "can't scan" page. */
export function driveDownloadUrl(id: string): string {
  return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
}

function parse(input: string): URL | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function driveLink(url: URL, original: string): ShareLink {
  const service = "Google Drive" as const;
  const parts = url.pathname.split("/").filter(Boolean);
  if (["document", "spreadsheets", "presentation", "forms"].includes(parts[0] ?? "")) {
    // Docs, Sheets and Slides are documents, not video, sound or pictures.
    return {
      kind: "unusable",
      url: original,
      service,
      problem:
        "This is a Google Docs, Sheets or Slides link. Share the video, sound or picture file itself.",
    };
  }
  if (parts.includes("folders") || parts[0] === "drive") {
    return {
      kind: "unusable",
      url: original,
      service,
      problem: "This is a link to a Google Drive folder. Share one file from it instead.",
    };
  }
  // drive.google.com/file/d/<id>/view, /file/u/0/d/<id>/..., /open?id=<id>, /uc?id=<id>
  const afterD = parts.indexOf("d");
  const id = (afterD >= 0 ? parts[afterD + 1] : null) ?? url.searchParams.get("id");
  if (id && DRIVE_ID.test(id)) {
    return { kind: "fixed", url: driveDownloadUrl(id), service };
  }
  return {
    kind: "unusable",
    url: original,
    service,
    problem: "This Google Drive link has no file in it. Copy the link from the file's Share menu.",
  };
}

function dropboxLink(url: URL, original: string): ShareLink {
  const service = "Dropbox" as const;
  const parts = url.pathname.split("/").filter(Boolean);
  // A shared folder: /scl/fo/<id>/..., or the older /sh/<id>/...
  if ((parts[0] === "scl" && parts[1] === "fo") || parts[0] === "sh") {
    return {
      kind: "unusable",
      url: original,
      service,
      problem: "This is a link to a Dropbox folder. Share one file from it instead.",
    };
  }
  // A shared file: /scl/fi/<id>/<name>?rlkey=..., or the older /s/<id>/<name>
  const sharedFile = (parts[0] === "scl" && parts[1] === "fi") || parts[0] === "s";
  if (!sharedFile) return { kind: "plain", url: original };
  if (url.searchParams.get("dl") === "1" || url.searchParams.has("raw")) {
    return { kind: "plain", url: original };
  }
  // dl=1 answers with the file instead of the preview page; the rest of the link,
  // rlkey included, has to stay as it was.
  const fixed = new URL(url.toString());
  fixed.searchParams.set("dl", "1");
  return { kind: "fixed", url: fixed.toString(), service };
}

/** What to do with an address someone pasted or a trigger handed over. */
export function readShareLink(input: string): ShareLink {
  const url = parse(input);
  if (!url) return { kind: "plain", url: input };
  const host = url.hostname.toLowerCase();
  if (DRIVE_HOSTS.has(host)) return driveLink(url, input);
  if (DROPBOX_HOSTS.has(host)) return dropboxLink(url, input);
  return { kind: "plain", url: input };
}

/** The address to download from: a share link turned into its download link. */
export function downloadLink(input: string): string {
  return readShareLink(input).url;
}

/**
 * Every share link inside a value (a job's settings, a webhook body) turned into its
 * download link. Anything else is handed back unchanged, the same object when nothing
 * in it changed.
 */
export function withDownloadLinks<T>(value: T): T {
  if (typeof value === "string") return downloadLink(value) as T;
  if (Array.isArray(value)) {
    const next = value.map((item) => withDownloadLinks(item));
    return (next.some((item, i) => item !== value[i]) ? next : value) as T;
  }
  if (value !== null && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      next[key] = withDownloadLinks(item);
      if (next[key] !== item) changed = true;
    }
    return (changed ? next : value) as T;
  }
  return value;
}

/** The first Drive or Dropbox link in a value that cannot be downloaded, with why. */
export function unusableShareLink(value: unknown): Extract<ShareLink, { kind: "unusable" }> | null {
  if (typeof value === "string") {
    const link = readShareLink(value);
    return link.kind === "unusable" ? link : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = unusableShareLink(item);
      if (found) return found;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) {
      const found = unusableShareLink(item);
      if (found) return found;
    }
  }
  return null;
}
