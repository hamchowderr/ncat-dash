/**
 * The bridge to the desktop app (apps/desktop). In a browser none of this exists and
 * every call does nothing. Inside the app, the dashboard may ask for two things only:
 * show an alert as a system notification, and show how many alerts are unseen on the
 * tray and the Dock or taskbar. The app refuses everything else from these pages.
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
