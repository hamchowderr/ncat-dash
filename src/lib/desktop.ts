/**
 * The bridge to the desktop app (apps/desktop). In a browser none of this exists and
 * every call does nothing. Inside the app, the dashboard may ask for a few things only:
 * show an alert as a system notification, show how many alerts are unseen on the tray
 * and the Dock or taskbar, and save a run's files for an editor into a folder of the
 * app's, then open or show what it saved. The app refuses everything else from these pages.
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
