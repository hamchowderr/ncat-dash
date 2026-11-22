import { api } from "@convex/_generated/api";
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { answerQuery, resetConvex } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { IntegrationsList } from "./integrations-list";
import { INTEGRATION_GROUPS } from "./settings-pages";

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
  answerQuery(api.mcpKeys.list, { canEdit: true, keys: [] });
}

const row = (name: string) => screen.getByRole("link", { name: new RegExp(`^${name}`) });

describe("the Integrations page", () => {
  beforeEach(() => {
    resetConvex();
    nothingConnected();
  });

  test("lists every app in its group, each opening its own page", () => {
    renderInApp(<IntegrationsList />);
    for (const group of INTEGRATION_GROUPS) {
      const section = screen.getByRole("region", { name: group.label });
      expect(within(section).getByRole("heading", { name: group.label })).toBeInTheDocument();
      const links = within(section).getAllByRole("link");
      expect(links.map((link) => link.getAttribute("href"))).toEqual(
        group.apps.map((app) => `/settings/integrations/${app.slug}`),
      );
    }
    // Real logos for the apps that have them.
    for (const name of ["Slack", "Discord", "Telegram", "Zoom", "Google Meet", "Dropbox"]) {
      expect(screen.getByRole("img", { name: `${name} logo` })).toBeInTheDocument();
    }
    expect(screen.queryByText("Connected")).toBeNull();
  });

  test("says which apps are connected", () => {
    answerQuery(api.slack.forTeam, { connected: true, canEdit: true });
    answerQuery(api.zoom.forTeam, { ready: true, wholeAccount: { zoomName: "Salt" }, me: null });
    answerQuery(api.dropbox.forTeam, { ready: true, me: { name: "Jordan" } });
    answerQuery(api.mcpKeys.list, { canEdit: true, keys: [{ keyId: "k1" }] });
    renderInApp(<IntegrationsList />);
    for (const name of ["Slack", "Zoom", "Dropbox", "MCP"]) {
      expect(row(name)).toHaveTextContent("Connected");
    }
    for (const name of ["Discord", "Google Meet", "Email"]) {
      expect(row(name)).not.toHaveTextContent("Connected");
    }
  });

  test("an app this dashboard has not set up says so", () => {
    answerQuery(api.telegram.forTeam, { ready: false, groups: [], me: null });
    renderInApp(<IntegrationsList />);
    expect(row("Telegram")).toHaveTextContent("Not set up on this dashboard yet");
    expect(row("Discord")).not.toHaveTextContent("Not set up");
  });

  test("still lists every app while their states load", () => {
    resetConvex();
    renderInApp(<IntegrationsList />);
    expect(screen.getAllByRole("link")).toHaveLength(
      INTEGRATION_GROUPS.reduce((sum, group) => sum + group.apps.length, 0),
    );
  });
});
