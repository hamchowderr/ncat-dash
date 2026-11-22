import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useWakeLock } from "./use-wake-lock";

const release = vi.fn(() => Promise.resolve());
const request = vi.fn(() => Promise.resolve({ release }));
let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
});
afterEach(() => {
  request.mockClear();
  release.mockClear();
});

describe("keeping the screen on", () => {
  test("asks while active and lets go when no longer needed", async () => {
    const { rerender } = renderHook(({ on }) => useWakeLock(on), { initialProps: { on: false } });
    expect(request).not.toHaveBeenCalled();
    rerender({ on: true });
    expect(request).toHaveBeenCalledWith("screen");
    await Promise.resolve();
    rerender({ on: false });
    await waitFor(() => expect(release).toHaveBeenCalled());
  });

  test("asks again on coming back to the page, since a hidden page loses the lock", () => {
    renderHook(() => useWakeLock(true));
    expect(request).toHaveBeenCalledTimes(1);
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(request).toHaveBeenCalledTimes(1);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(request).toHaveBeenCalledTimes(2);
  });

  test("does nothing where the browser has no such thing, or refuses", async () => {
    request.mockRejectedValueOnce(new Error("low battery"));
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
    // @ts-expect-error: a browser without the feature
    delete navigator.wakeLock;
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
  });
});
