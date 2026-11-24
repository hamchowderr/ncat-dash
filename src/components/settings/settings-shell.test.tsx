import { api } from "@convex/_generated/api";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TeamContext } from "@/lib/team-context";
import { answerQuery } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import {
  INTEGRATION_GROUPS,
  INTEGRATIONS,
  SETTINGS_GROUPS,
  SETTINGS_PAGES,
  settingsLocation,
  settingsPathFor,
} from "./settings-pages";
import { SettingRow, SettingsShell } from "./settings-shell";

const path = vi.hoisted(() => ({ current: "/settings/agent" }));
vi.mock("next/navigation", async () => ({
  ...(await import("@/test/convex")).nextNavigation,
  usePathname: () => path.current,
}));

function sidebar() {
  return render(
    <TeamContext.Provider value={TEAM}>
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar
            teamName={TEAM.name}
            edition="Self-hosted"
            user={{ name: "Ana Reyes", email: "ana@example.test", image: null }}
          />
        </SidebarProvider>
      </TooltipProvider>
    </TeamContext.Provider>,
  );
}

describe("a settings page", () => {
  test("is titled by what it holds, with one short line, and never says Settings again", () => {
    path.current = "/settings/agent";
    renderInApp(
      <SettingsShell>
        <p>Agent settings</p>
      </SettingsShell>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Agent");
    expect(screen.getByText(/How the agent builds automations/)).toBeInTheDocument();
    expect(screen.queryByText(/^Settings/)).toBeNull();
    // The list of pages is the sidebar's job, not the page's.
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByText("Agent settings")).toBeInTheDocument();
  });

  test("a page about other apps leads with their logos; other pages have none", () => {
    for (const [slug, name] of [
      ["slack", "Slack"],
      ["discord", "Discord"],
      ["telegram", "Telegram"],
      ["zoom", "Zoom"],
      ["google-meet", "Google Meet"],
      ["teams", "Microsoft Teams"],
      ["microsoft", "Microsoft 365"],
      ["dropbox", "Dropbox"],
    ]) {
      path.current = `/settings/integrations/${slug}`;
      const { unmount } = renderInApp(
        <SettingsShell>
          <p>Page</p>
        </SettingsShell>,
      );
      const header = screen.getByRole("heading", { level: 1 }).closest("header")!;
      expect(within(header).getByRole("img", { name: `${name} logo` })).toBeInTheDocument();
      // An app's page says it sits under Integrations, and leads back there.
      expect(screen.getByRole("link", { name: "Integrations" })).toHaveAttribute(
        "href",
        "/settings/integrations",
      );
      unmount();
    }
    path.current = "/settings/agent";
    const { unmount } = renderInApp(
      <SettingsShell>
        <p>Page</p>
      </SettingsShell>,
    );
    expect(screen.queryByRole("img", { name: /logo$/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Integrations" })).toBeNull();
    unmount();

    // Video Editors shows every editor the team can export to.
    path.current = "/settings/editors";
    renderInApp(
      <SettingsShell>
        <p>Page</p>
      </SettingsShell>,
    );
    const header = screen.getByRole("heading", { level: 1 }).closest("header")!;
    for (const name of ["Premiere Pro", "DaVinci Resolve", "Final Cut Pro", "CapCut"]) {
      expect(within(header).getByRole("img", { name: `${name} logo` })).toBeInTheDocument();
    }
  });

  test("shows a setting as a row: its name and a short line, then its control", () => {
    renderInApp(
      <SettingRow label="Jobs at once" htmlFor="jobs" description="How many at the same time.">
        <input id="jobs" />
      </SettingRow>,
    );
    expect(screen.getByLabelText("Jobs at once")).toHaveAttribute("id", "jobs");
    expect(screen.getByText("How many at the same time.")).toBeInTheDocument();
  });
});

describe("the settings pages", () => {
  test("every page belongs to one group and has a short line, kept to one sentence-ish", () => {
    const slugs = SETTINGS_GROUPS.flatMap((group) => group.pages.map((page) => page.slug));
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(SETTINGS_PAGES.map((page) => page.slug)).toEqual(slugs);
    for (const page of SETTINGS_PAGES) expect(page.description.length).toBeLessThanOrEqual(90);
  });

  test("the menu stays short: every app is under Integrations, never in the menu", () => {
    expect(SETTINGS_PAGES.length).toBeLessThanOrEqual(12);
    const apps = INTEGRATION_GROUPS.flatMap((group) => group.apps.map((app) => app.slug));
    expect(new Set(apps).size).toBe(apps.length);
    for (const app of INTEGRATIONS) {
      expect(SETTINGS_PAGES.map((page) => page.slug as string)).not.toContain(app.slug);
      expect(app.description.length).toBeLessThanOrEqual(90);
    }
    expect(INTEGRATION_GROUPS.map((group) => group.label)).toEqual([
      "Chat",
      "Meeting Recordings",
      "Files",
      "AI Apps",
      "Sending Email",
    ]);
  });

  test("an app's page lights Integrations in the menu", () => {
    expect(settingsLocation("/settings/integrations/zoom")).toMatchObject({
      menu: "integrations",
      app: "zoom",
      page: { title: "Zoom" },
    });
    expect(settingsLocation("/settings/integrations")).toMatchObject({
      menu: "integrations",
      app: null,
    });
    expect(settingsLocation("/settings/captions")).toMatchObject({ menu: "captions", app: null });
    expect(settingsLocation("/settings/integrations/nonsense")).toBeNull();
    expect(settingsLocation("/settings/nonsense")).toBeNull();
  });

  test("old addresses and old section links open the page they moved to", () => {
    expect(settingsPathFor("#notifications")).toBe("/settings/notifications");
    expect(settingsPathFor("#agent")).toBe("/settings/agent");
    expect(settingsPathFor("#jobs")).toBe("/settings/runs");
    expect(settingsPathFor("#failures")).toBe("/settings/runs");
    expect(settingsPathFor("#slack")).toBe("/settings/integrations/slack");
    expect(settingsPathFor("discord")).toBe("/settings/integrations/discord");
    expect(settingsPathFor("google-meet")).toBe("/settings/integrations/google-meet");
    expect(settingsPathFor("chat")).toBe("/settings/integrations/slack");
    expect(settingsPathFor("ai-agents")).toBe("/settings/integrations/mcp");
    expect(settingsPathFor("members")).toBe("/settings/team");
    expect(settingsPathFor("")).toBe("/settings/brand");
    expect(settingsPathFor("#nonsense")).toBe("/settings/brand");
  });
});

describe("settings in the sidebar", () => {
  beforeEach(() => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    answerQuery(api.alerts.list, { unseen: 0, alerts: [] });
    answerQuery(api.teamSettings.get, { brand: {} });
    sessionStorage.clear();
  });

  test("are not in the everyday menu; the team's menu opens them", async () => {
    path.current = "/library";
    sidebar();
    expect(screen.getByRole("link", { name: "Library" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Settings" })).toBeNull();

    const teamMenu = screen.getByRole("button", { name: `${TEAM.name} menu` });
    fireEvent.pointerDown(teamMenu, { button: 0, ctrlKey: false });
    const settings = await screen.findByRole("menuitem", { name: "Settings" });
    expect(settings).toHaveAttribute("href", "/settings/brand");
    expect(screen.getByRole("menuitem", { name: "Invite people" })).toHaveAttribute(
      "href",
      "/settings/team",
    );
  });

  test("while settings are open, the sidebar becomes their menu, grouped, with Back to app", () => {
    // Remembered from the last page outside settings.
    path.current = "/automations";
    const first = sidebar();
    first.unmount();

    path.current = "/settings/agent";
    sidebar();
    const menu = screen.getByRole("navigation", { name: "Settings" });
    const links = within(menu).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      SETTINGS_PAGES.map((page) => `/settings/${page.slug}`),
    );
    // Plain names, no subtitles under them.
    expect(links.map((link) => link.textContent)).toEqual(SETTINGS_PAGES.map((page) => page.title));
    expect(within(menu).getByRole("link", { current: "page" })).toHaveTextContent("Agent");
    for (const group of SETTINGS_GROUPS) expect(within(menu).getByText(group.label)).toBeVisible();
    // No app is listed in the menu itself.
    expect(within(menu).queryByRole("link", { name: "Slack" })).toBeNull();

    // The everyday pages are out of the way, and Back to app returns where you were.
    expect(screen.queryByRole("link", { name: "Library" })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to app" })).toHaveAttribute(
      "href",
      "/automations",
    );
  });

  test("on an app's page, Integrations stays lit", () => {
    path.current = "/settings/integrations/dropbox";
    sidebar();
    const menu = screen.getByRole("navigation", { name: "Settings" });
    expect(within(menu).getByRole("link", { current: "page" })).toHaveTextContent("Integrations");
  });

  test("Back to app goes Home when there is nowhere remembered", () => {
    path.current = "/settings/brand";
    sidebar();
    expect(screen.getByRole("link", { name: "Back to app" })).toHaveAttribute("href", "/");
  });
});
