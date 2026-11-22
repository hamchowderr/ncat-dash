/**
 * The bridge to the desktop app (apps/desktop). In a browser none of this exists and
 * every call does nothing. Inside the app, the dashboard may ask for a few things only:
 * show an alert as a system notification, show how many alerts are unseen on the tray
 * and the Dock or taskbar, save a run's files for an editor into a folder of the app's,
 * then open or show what it saved, and send files chosen in the app's own file picker
 * straight from disk. The app refuses everything else from these pages.
 */

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

function bridge(): Invoke | null {
  if (typeof window === "undefined") return null;
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: Invoke } })
    .__TAURI_INTERNALS__;
  return typeof internals?.invoke === "function" ? internals.invoke.bind(internals) : null;
}

/** Whether these pages are open in the desktop app. */
export function inDesktopApp(): boolean {
  return bridge() !== null;
}

/**
 * A system notification for an alert. The app skips it while its window is in front,
 * since the page shows its own notice then. Never throws: a notification is a courtesy.
 */
export async function notifyDesktop(title: string, body: string): Promise<void> {
  const invoke = bridge();
  if (!invoke) return;
  try {
    await invoke("notify", { title, body });
  } catch {
    // An older app, or notifications turned off: the page's own notice still shows.
  }
}

/** The unseen alerts count for the tray and the Dock or taskbar badge. */
export async function setDesktopUnseen(count: number): Promise<void> {
  const invoke = bridge();
  if (!invoke) return;
  try {
    await invoke("set_unseen", { count: Math.max(0, Math.floor(count)) });
  } catch {
    // As above.
  }
}

/** What the app saved for an editor. */
export type DesktopSaved = {
  folder: string;
  files: { name: string; path: string }[];
  failed: string[];
};

/**
 * Saves a run's files into one folder on this computer, named `folder`, inside the app's
 * own exports folder: `files` are written as they are, `downloads` are fetched. Null when
 * not in the app, or in an app too old to do it, so the page falls back to downloads.
 */
export async function saveToDesktop(
  folder: string,
  files: { name: string; text: string }[],
  downloads: { name: string; url: string }[],
): Promise<DesktopSaved | null> {
  const invoke = bridge();
  if (!invoke) return null;
  try {
    return (await invoke("save_export", { folder, files, downloads })) as DesktopSaved;
  } catch {
    return null;
  }
}

/** Opens a file the app saved in the app the computer opens it with. False if it could not. */
export async function openOnDesktop(path: string): Promise<boolean> {
  const invoke = bridge();
  if (!invoke) return false;
  try {
    await invoke("open_export", { path });
    return true;
  } catch {
    return false;
  }
}

/** Shows a file the app saved in its folder. False if it could not. */
export async function showOnDesktop(path: string): Promise<boolean> {
  const invoke = bridge();
  if (!invoke) return false;
  try {
    await invoke("show_export", { path });
    return true;
  } catch {
    return false;
  }
}

/** A file chosen in the app's file picker. The page never holds its bytes. */
export type DiskFile = { path: string; name: string; size: number; contentType: string };

/** An upload going up in parts from this computer, as the app wrote it down. */
export type DiskUpload = {
  uploadId: string;
  path: string;
  name: string;
  size: number;
  contentType: string;
  plan: { partSize: number; partCount: number };
  /** The parts the bucket already took. */
  parts: { partNumber: number; etag: string }[];
};

/**
 * Opens the computer's own file picker. Null outside the app, or in an app too old to
 * have it, so the page uses its own file input; an empty list when nothing was chosen.
 */
export async function chooseFilesOnDesktop(): Promise<DiskFile[] | null> {
  const invoke = bridge();
  if (!invoke) return null;
  try {
    return (await invoke("choose_files")) as DiskFile[];
  } catch {
    return null;
  }
}

function need(): Invoke {
  const invoke = bridge();
  if (!invoke) throw new Error("This only works in the desktop app.");
  return invoke;
}

/** The app's refusals come back as plain text. */
function asError(caught: unknown): Error {
  return caught instanceof Error ? caught : new Error(String(caught));
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return (await need()(command, args)) as T;
  } catch (caught) {
    throw asError(caught);
  }
}

/** Sends a chosen file whole to one signed link. */
export function sendFileFromDisk(file: DiskFile, url: string): Promise<void> {
  return call("send_file", { path: file.path, url, contentType: file.contentType });
}

/** Writes down an upload in parts, or finds it again to carry on; says what was sent. */
export function beginDiskUpload(
  uploadId: string,
  path: string,
  plan: DiskUpload["plan"],
): Promise<DiskUpload> {
  return call("begin_upload", { uploadId, path, plan });
}

/** Sends one part, read from the file by the app. Resolves with the bucket's ETag. */
export function sendPartFromDisk(
  uploadId: string,
  partNumber: number,
  url: string,
): Promise<string | null> {
  return call("send_part", { uploadId, partNumber, url });
}

/** This dashboard's uploads that stopped part way, to carry on from. Empty outside the app. */
export async function stoppedDiskUploads(): Promise<DiskUpload[]> {
  if (!bridge()) return [];
  try {
    return await call<DiskUpload[]>("stopped_uploads");
  } catch {
    return [];
  }
}

/** Forgets an upload that finished or was dropped. */
export async function forgetDiskUpload(uploadId: string): Promise<void> {
  if (!bridge()) return;
  try {
    await call("forget_upload", { uploadId });
  } catch {
    // Nothing to forget.
  }
}
