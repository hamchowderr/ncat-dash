import { existsSync, statSync } from "node:fs";
import path from "node:path";

import {
  BUILT_IN_BY_SHAPE,
  BUILT_IN_STYLES,
  type CaptionLook,
  type CaptionSetup,
  ENDINGS,
  MOTION_LOOKS,
  MOTION_PIECES,
  MOTION_PRESETS,
  NO_CAPTION_SETUP,
  NO_MOTION_SETUP,
  OPENINGS,
} from "@takewon/automation-core";
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { resetConvex } from "@/test/convex";
import { openTab, renderInApp } from "@/test/render";

import { CAPTION_EXAMPLE_WORDS } from "./caption-example-words";
import { captionAt } from "./caption-preview";
import { CaptionsCard } from "./captions-card";
import { MotionCard } from "./motion-card";

vi.mock("convex/react", async () => (await import("@/test/convex")).convexReact);
vi.mock("sonner", async () => (await import("@/test/convex")).sonner);

const PUBLIC = path.join(__dirname, "../../../public");
/** A clip the page points at is really there, and is small enough to load on a hover. */
function shipped(url: string) {
  const file = path.join(PUBLIC, url);
  for (const each of [file, file.replace(/\.mp4$/, ".webm")]) {
    expect(existsSync(each), each).toBe(true);
    expect(statSync(each).size).toBeLessThan(600_000);
  }
}

const example = () => document.querySelector("figure[data-example]")!;
const playing = () => example().getAttribute("data-example");
const caption = () => example().querySelector("figcaption")!.textContent;

describe("the Motion examples", () => {
  const motion = () =>
    renderInApp(<MotionCard motion={NO_MOTION_SETUP} presets={MOTION_PRESETS} canEdit />);

  beforeEach(() => window.history.replaceState(null, "", "/"));

  test("every preset, piece, look, opening and ending has its example clip", () => {
    for (const preset of MOTION_PRESETS) shipped(`/examples/motion/preset-${preset.id}.mp4`);
    for (const piece of MOTION_PIECES) shipped(`/examples/motion/piece-${piece.type}.mp4`);
    for (const look of MOTION_LOOKS) shipped(`/examples/motion/look-${look}.mp4`);
    for (const end of [...OPENINGS, ...ENDINGS].filter((one) => one !== "none")) {
      shipped(`/examples/motion/piece-${end}.mp4`);
    }
  });

  test("plays the picked style, and any style the pointer is on", () => {
    motion();
    expect(playing()).toBe("/examples/motion/preset-clean-talking-head.mp4");
    expect(caption()).toBe("Example: Clean Talking Head");
    const tile = screen.getByRole("radio", { name: /Bold Hook/ });
    fireEvent.pointerEnter(tile);
    expect(playing()).toBe("/examples/motion/preset-bold-hook.mp4");
    expect(caption()).toBe("Example: Bold Hook");
    // Moving off goes back to the picked one; keyboard focus plays it too.
    fireEvent.pointerLeave(tile);
    expect(playing()).toBe("/examples/motion/preset-clean-talking-head.mp4");
    fireEvent.focus(screen.getByRole("radio", { name: /Neon/ }));
    expect(playing()).toBe("/examples/motion/preset-neon.mp4");
    // The clip plays muted, on a loop, without anyone pressing play.
    const video = example().querySelector("video")!;
    expect(video.muted).toBe(true);
    expect(video).toHaveAttribute("loop");
    expect(video).toHaveAttribute("playsinline");
  });

  test("each piece plays on its own", async () => {
    motion();
    await openTab("Pieces");
    expect(playing()).toBe("/examples/motion/piece-lower_third.mp4");
    fireEvent.pointerEnter(screen.getByRole("checkbox", { name: /Stat card/ }));
    expect(playing()).toBe("/examples/motion/piece-stat.mp4");
    expect(caption()).toBe("Example: Stat card");
  });
});

describe("the Captions examples", () => {
  const OURS: CaptionSetup = {
    ...NO_CAPTION_SETUP,
    styles: [{ name: "Night Shift", look: { style: "karaoke", word_color: "#FF4FA3" } }],
  };
  const captions = (font?: string, setup = OURS) =>
    renderInApp(
      <CaptionsCard
        captions={setup}
        builtIn={BUILT_IN_STYLES}
        builtInByShape={BUILT_IN_BY_SHAPE}
        font={font}
        canEdit
      />,
    );

  beforeEach(() => {
    resetConvex();
    window.history.replaceState(null, "", "/");
  });

  test("every built-in style has the clip the toolkit rendered with it", () => {
    for (const style of BUILT_IN_STYLES) {
      shipped(`/examples/captions/${style.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.mp4`);
    }
    shipped("/examples/captions/plain.mp4");
  });

  test("a built-in style plays its rendered clip; one of your own is drawn live", () => {
    captions();
    // Your own style opens first, drawn over the same clip.
    expect(playing()).toBe("live");
    expect(caption()).toBe("Example: Night Shift");
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Karaoke, built in" }));
    expect(playing()).toBe("/examples/captions/karaoke.mp4");
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Bold highlight, built in" }));
    expect(playing()).toBe("/examples/captions/bold-highlight.mp4");
    expect(caption()).toBe("Example: Bold highlight");
  });

  test("with a brand font, built-in styles are drawn live in it", () => {
    captions("Inter");
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Karaoke, built in" }));
    expect(playing()).toBe("live");
  });

  test("a position the pointer is on is tried on the open style", () => {
    captions();
    const live = () => example().querySelector("[data-caption-live]")!;
    expect(live().className).toContain("justify-end");
    const top = screen.getByRole("radio", { name: "Top" });
    fireEvent.pointerEnter(top);
    expect(live().className).toContain("justify-start");
    fireEvent.pointerLeave(top);
    expect(live().className).toContain("justify-end");
  });

  test("is not on the other tabs", async () => {
    captions();
    await openTab("Word Fixes");
    expect(document.querySelector("figure[data-example]")).toBeNull();
  });
});

describe("a caption drawn live", () => {
  const segments = [
    [
      { w: "One", s: 0, e: 0.5 },
      { w: "two", s: 0.5, e: 1 },
      { w: "three", s: 1, e: 1.5 },
    ],
    [{ w: "four", s: 3, e: 3.5 }],
  ];
  const at = (look: CaptionLook, time: number) => captionAt(look, segments, time);

  test("plain lines show the whole stretch, split by words per line", () => {
    expect(at({ style: "classic", max_words_per_line: 2 }, 0.2)).toEqual({
      lines: [["One", "two"], ["three"]],
      said: [-1, -1],
    });
  });

  test("karaoke fills every word said so far, across lines", () => {
    expect(at({ style: "karaoke", max_words_per_line: 2 }, 1.2)?.said).toEqual([2, 0]);
  });

  test("highlight shows one line at a time with the word being said", () => {
    expect(at({ style: "highlight", max_words_per_line: 2 }, 0.7)).toEqual({
      lines: [["One", "two"]],
      said: [1],
    });
    expect(at({ style: "highlight", max_words_per_line: 2 }, 1.2)).toEqual({
      lines: [["three"]],
      said: [0],
    });
  });

  test("one word at a time shows only the word being said", () => {
    expect(at({ style: "word_by_word" }, 3.2)).toEqual({ lines: [["four"]], said: [0] });
  });

  test("shows nothing between stretches of speech", () => {
    expect(at({ style: "classic" }, 2)).toBeNull();
  });

  test("the example clip's words are in order and inside the clip", () => {
    const words = CAPTION_EXAMPLE_WORDS.flat();
    expect(words.length).toBeGreaterThan(20);
    for (let i = 1; i < words.length; i += 1)
      expect(words[i].s).toBeGreaterThanOrEqual(words[i - 1].s);
    // The clip is 9.9 seconds long.
    expect(words.at(-1)!.s).toBeLessThan(9.9);
  });
});
