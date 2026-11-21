import { afterEach, describe, expect, test, vi } from "vitest";

import { inDesktopApp, notifyDesktop, setDesktopUnseen } from "./desktop";

type Win = { __TAURI_INTERNALS__?: { invoke: (...args: unknown[]) => Promise<unknown> } };

afterEach(() => {
  delete (window as unknown as Win).__TAURI_INTERNALS__;
});

describe("the bridge to the desktop app", () => {
  test("does nothing in a browser", async () => {
    expect(inDesktopApp()).toBe(false);
    await expect(notifyDesktop("Run failed", "Weekly clips")).resolves.toBeUndefined();
    await expect(setDesktopUnseen(3)).resolves.toBeUndefined();
  });

  test("asks the app for a notification and the unseen count", async () => {
    const invoke = vi.fn(async () => true);
    (window as unknown as Win).__TAURI_INTERNALS__ = { invoke };
    expect(inDesktopApp()).toBe(true);
    await notifyDesktop("Run failed", "Weekly clips stopped at Captions");
    await setDesktopUnseen(2.7);
    await setDesktopUnseen(-1);
    expect(invoke.mock.calls).toEqual([
      ["notify", { title: "Run failed", body: "Weekly clips stopped at Captions" }],
      ["set_unseen", { count: 2 }],
      ["set_unseen", { count: 0 }],
    ]);
  });

  test("never throws when the app refuses", async () => {
    (window as unknown as Win).__TAURI_INTERNALS__ = {
      invoke: async () => {
        throw "Only the open dashboard can do that.";
      },
    };
    await expect(notifyDesktop("a", "b")).resolves.toBeUndefined();
    await expect(setDesktopUnseen(1)).resolves.toBeUndefined();
  });
});
