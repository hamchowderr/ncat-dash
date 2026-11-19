import { describe, expect, test } from "vitest";

import { SETTINGS_PAGES } from "./settings-pages";

describe("settings page names", () => {
  test("are in Title Case, as the sidebar shows them", () => {
    for (const page of SETTINGS_PAGES) {
      for (const word of page.title.split(" ")) {
        expect(word[0], `${page.title}: "${word}"`).toBe(word[0].toUpperCase());
      }
    }
    expect(SETTINGS_PAGES.map((page) => page.title)).toContain("Video Editors");
  });
});
