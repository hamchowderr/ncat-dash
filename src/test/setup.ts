import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { resetConvex } from "./convex";

afterEach(() => {
  cleanup();
  resetConvex();
});

// Tests that ask for the node environment have no page to prepare.
if (typeof Element !== "undefined") {
  // What jsdom leaves out and the screens use.
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = Observer as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};

  // A video that "plays": jsdom has the element but none of its behaviour.
  Object.defineProperty(HTMLMediaElement.prototype, "paused", {
    configurable: true,
    get() {
      return (this as { playing?: boolean }).playing !== true;
    },
  });
  HTMLMediaElement.prototype.play = function play() {
    (this as { playing?: boolean }).playing = true;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function pause() {
    (this as { playing?: boolean }).playing = false;
    this.dispatchEvent(new Event("pause"));
  };
}

vi.mock("convex/react", async () => (await import("./convex")).convexReact);
vi.mock("@convex-dev/presence/react", async () => (await import("./convex")).presenceReact);
vi.mock("next/navigation", async () => (await import("./convex")).nextNavigation);
vi.mock("sonner", async () => (await import("./convex")).sonner);
