import { api } from "@convex/_generated/api";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { answerQuery, resetConvex } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { IntegrationsList } from "./integrations-list";
import { INTEGRATION_GROUPS, integrationsTabHref } from "./settings-pages";

vi.mock("convex/react", async () => (await import("@/test/convex")).convexReact);

/** Every app answered as "nothing connected yet" on a dashboard that has them all. */
function nothingConnected() {
  answerQuery(api.slack.forTeam, { connected: false, canEdit: true });
  answerQuery(api.discord.forTeam, { ready: true, servers: [], me: null });
  answerQuery(api.telegram.forTeam, { ready: true, groups: [], me: null });
  answerQuery(api.microsoftTeams.forTeam, { ready: true, organization: null, me: null });
  answerQuery(api.zoom.forTeam, { ready: true, wholeAccount: null, me: null });
  answerQuery(api.googleMeet.forTeam, { ready: true, me: null });
  answerQuery(api.microsoft.forTeam, { ready: true, me: null });
  answerQuery(api.dropbox.forTeam, { ready: true, me: null });
  answerQuery(api.email.get, { configured: false, canEdit: true });
  answerQuery(api.oauth.connections, []);
}

const row = (name: string) => screen.getByRole("link", { name: new RegExp(`^${name}`) });

/** Opens a group's tab, the way a person clicks it. */
async function openTab(label: string) {
  await userEvent.click(screen.getByRole("tab", { name: new RegExp(`^${label}`) }));
}

describe("the Integrations page", () => {
  beforeEach(() => {
    resetConvex();
    nothingConnected();
    window.history.replaceState(null, "", "/settings/integrations");
  });

  test("puts each group in a tab, so only a few apps show at once", async () => {
    renderInApp(<IntegrationsList />);
    const tabs = screen.getByRole("tablist", { name: "Integrations" });
    expect(
      within(tabs)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(INTEGRATION_GROUPS.map((group) => group.label));
    // Chat opens first, and only its apps show.
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(
      INTEGRATION_GROUPS[0].apps.map((app) => `/settings/integrations/${app.slug}`),
    );
    for (const group of INTEGRATION_GROUPS) {
      await openTab(group.label);
      const list = screen.getByRole("list", { name: group.label });
      expect(
        within(list)
          .getAllByRole("link")
          .map((link) => link.getAttribute("href")),
      ).toEqual(group.apps.map((app) => `/settings/integrations/${app.slug}`));
    }
    // The open tab is kept in the address, so a reload or the back link lands on it.
    expect(window.location.search).toBe("?tab=email");
  });

  test("shows real logos for the apps that have them", async () => {
    renderInApp(<IntegrationsList />);
    for (const name of ["Slack", "Discord", "Telegram"]) {
      expect(screen.getByRole("img", { name: `${name} logo` })).toBeInTheDocument();
    }
    await openTab("Meeting Recordings");
    for (const name of ["Zoom", "Google Meet"]) {
      expect(screen.getByRole("img", { name: `${name} logo` })).toBeInTheDocument();
    }
    await openTab("Files");
    expect(screen.getByRole("img", { name: "Dropbox logo" })).toBeInTheDocument();
    expect(screen.queryByText("Connected")).toBeNull();
  });

  test("says which apps are connected, and marks their tabs", async () => {
    answerQuery(api.slack.forTeam, { connected: true, canEdit: true });
    answerQuery(api.zoom.forTeam, { ready: true, wholeAccount: { zoomName: "Salt" }, me: null });
    answerQuery(api.oauth.connections, [{ grantId: "g1" }]);
    renderInApp(<IntegrationsList />);
    const tab = (label: string) => screen.getByRole("tab", { name: new RegExp(`^${label}`) });
    for (const label of ["Chat", "Meeting Recordings", "AI Apps"]) {
      expect(within(tab(label)).getByRole("img", { name: "Something connected" })).toBeVisible();
    }
    for (const label of ["Files", "Sending Email"]) {
      expect(within(tab(label)).queryByRole("img")).toBeNull();
    }
    expect(row("Slack")).toHaveTextContent("Connected");
    expect(row("Discord")).not.toHaveTextContent("Connected");
    await openTab("Meeting Recordings");
    expect(row("Zoom")).toHaveTextContent("Connected");
    expect(row("Google Meet")).not.toHaveTextContent("Connected");
    await openTab("AI Apps");
    expect(row("MCP")).toHaveTextContent("Connected");
  });

  test("an app this dashboard has not set up says so", () => {
    answerQuery(api.telegram.forTeam, { ready: false, groups: [], me: null });
    renderInApp(<IntegrationsList />);
    expect(row("Telegram")).toHaveTextContent("Not set up on this dashboard yet");
    expect(row("Discord")).not.toHaveTextContent("Not set up");
  });

  test("still lists the open tab's apps while their states load", () => {
    resetConvex();
    renderInApp(<IntegrationsList />);
    expect(screen.getAllByRole("link")).toHaveLength(INTEGRATION_GROUPS[0].apps.length);
  });

  test("an app's back link opens the tab it sits in", () => {
    expect(integrationsTabHref("slack")).toBe("/settings/integrations");
    expect(integrationsTabHref("zoom")).toBe("/settings/integrations?tab=meetings");
    expect(integrationsTabHref("dropbox")).toBe("/settings/integrations?tab=files");
    expect(integrationsTabHref("mcp")).toBe("/settings/integrations?tab=ai-apps");
    expect(integrationsTabHref("email")).toBe("/settings/integrations?tab=email");
  });
});
