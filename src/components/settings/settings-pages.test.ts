import { describe, expect, test } from "vitest";

import { INTEGRATIONS, SETTINGS_PAGES } from "./settings-pages";

describe("settings page names", () => {
  test("are in Title Case, as the sidebar and the Integrations page show them", () => {
    for (const page of [...SETTINGS_PAGES, ...INTEGRATIONS]) {
      for (const word of page.title.split(" ")) {
        expect(word[0], `${page.title}: "${word}"`).toBe(word[0].toUpperCase());
      }
    }
    expect(SETTINGS_PAGES.map((page) => page.title)).toContain("Video Editors");
    expect(SETTINGS_PAGES.map((page) => page.title)).toContain("Integrations");
    expect(SETTINGS_PAGES.map((page) => page.title)).toContain("Motion");
    expect(INTEGRATIONS.map((app) => app.title)).toContain("Google Meet");
  });
});
