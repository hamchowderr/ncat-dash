import { screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { SETTINGS_PAGES, settingsPageFor } from "./settings-pages";
import { SettingsShell } from "./settings-shell";

const path = vi.hoisted(() => ({ current: "/settings/agent" }));
vi.mock("next/navigation", async () => ({
  ...(await import("@/test/convex")).nextNavigation,
  usePathname: () => path.current,
}));

describe("settings pages", () => {
  test("the menu links to each settings page, and marks the one open", () => {
    renderInApp(
      <SettingsShell>
        <p>Agent page</p>
      </SettingsShell>,
    );
    const menu = screen.getByRole("navigation", { name: "Settings" });
    const links = within(menu).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      SETTINGS_PAGES.map((page) => `/settings/${page.slug}`),
    );
    expect(within(menu).getByRole("link", { current: "page" })).toHaveTextContent(/^Agent/);
    expect(screen.getByText("Agent page")).toBeInTheDocument();
  });

  test("old links to a section of the long page open the page it moved to", () => {
    expect(settingsPageFor("#notifications")).toBe("notifications");
    expect(settingsPageFor("#agent")).toBe("agent");
    expect(settingsPageFor("#jobs")).toBe("runs");
    expect(settingsPageFor("#failures")).toBe("runs");
    expect(settingsPageFor("#slack")).toBe("chat");
    expect(settingsPageFor("")).toBe("brand");
    expect(settingsPageFor("#nonsense")).toBe("brand");
  });
});
