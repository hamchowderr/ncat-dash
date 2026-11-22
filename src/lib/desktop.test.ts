import { afterEach, describe, expect, test, vi } from "vitest";

import {
  inDesktopApp,
  notifyDesktop,
  openOnDesktop,
  saveToDesktop,
  setDesktopUnseen,
  showOnDesktop,
} from "./desktop";

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

describe("saving for an editor through the desktop app", () => {
  test("is not offered in a browser", async () => {
    await expect(saveToDesktop("Run", [], [])).resolves.toBeNull();
    await expect(openOnDesktop("/x")).resolves.toBe(false);
    await expect(showOnDesktop("/x")).resolves.toBe(false);
  });

  test("asks the app to save, open and show, and passes on what it saved", async () => {
    const saved = {
      folder: "/v/Run",
      files: [{ name: "a.xml", path: "/v/Run/a.xml" }],
      failed: [],
    };
    const invoke = vi.fn(async (command: unknown) => (command === "save_export" ? saved : null));
    (window as unknown as Win).__TAURI_INTERNALS__ = { invoke };
    const files = [{ name: "a.xml", text: "<xmeml/>" }];
    const downloads = [{ name: "talk.mp4", url: "https://files.example/talk.mp4" }];
    await expect(saveToDesktop("Run", files, downloads)).resolves.toEqual(saved);
    await expect(openOnDesktop("/v/Run/a.xml")).resolves.toBe(true);
    await expect(showOnDesktop("/v/Run/a.xml")).resolves.toBe(true);
    expect(invoke.mock.calls).toEqual([
      ["save_export", { folder: "Run", files, downloads }],
      ["open_export", { path: "/v/Run/a.xml" }],
      ["show_export", { path: "/v/Run/a.xml" }],
    ]);
  });

  test("an app that refuses or is too old gives the page its fallback", async () => {
    (window as unknown as Win).__TAURI_INTERNALS__ = {
      invoke: async () => {
        throw "Command save_export not found";
      },
    };
    await expect(saveToDesktop("Run", [], [])).resolves.toBeNull();
    await expect(openOnDesktop("/etc/hosts")).resolves.toBe(false);
    await expect(showOnDesktop("/etc/hosts")).resolves.toBe(false);
  });
});
