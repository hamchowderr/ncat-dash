import { useEffect } from "react";

/**
 * Keeps the screen on while `active` is true, where the browser allows it. A phone that
 * dims and locks part-way through stops the page, and with it a file still being sent.
 * The lock is let go when the page is hidden, so it is asked for again on return.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;

    async function hold() {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        lock = await navigator.wakeLock.request("screen");
        if (stopped) void lock.release();
      } catch {
        // Refused (low battery, a setting): the upload goes on, the screen may dim.
      }
    }

    const onVisible = () => void hold();
    document.addEventListener("visibilitychange", onVisible);
    void hold();
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
