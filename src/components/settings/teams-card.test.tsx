import { api } from "@convex/_generated/api";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery, mutationOf, toastError, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { TEAMS_RESULTS, TeamsCard } from "./teams-card";

const notLinked = {
  ready: true,
  canEdit: true,
  appPackageUrl: "https://site.test/teams/app.zip",
  organization: null,
  teamsSeen: [],
  me: null,
  linkedCount: 0,
};
const linked = {
  ...notLinked,
  organization: {
    name: "Salt House Media",
    addedAt: Date.UTC(2026, 10, 20, 8),
    addedBy: "Jordan Lee",
    alertChannel: null,
  },
  teamsSeen: ["Video team"],
  me: { name: "Jordan Lee", linkedAt: Date.UTC(2026, 10, 20, 8), via: "teams" },
  linkedCount: 2,
};
const channels = [
  { id: "19:general", name: "General", teamName: "Video team" },
  { id: "19:edits", name: "Edits", teamName: "Video team" },
];

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("the Microsoft Teams card", () => {
  test("says when this dashboard has no Teams bot yet, with nothing to press", () => {
    answerQuery(api.microsoftTeams.forTeam, { ...notLinked, ready: false });
    renderInApp(<TeamsCard />);
    expect(screen.getByText(/not set up on this dashboard yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("an owner links the Microsoft organization by signing in with Microsoft", async () => {
    answerQuery(api.microsoftTeams.forTeam, notLinked);
    const start = mutationOf(api.microsoftTeams.startLink);
    start.mockResolvedValue("https://login.test/authorize?state=teams.abc");
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      href: "http://localhost/settings/teams",
      assign,
    } as Location);
    renderInApp(<TeamsCard />);
    // Nothing to download until the organization is linked.
    expect(screen.queryByRole("link", { name: /Download the Teams app/ })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Link Microsoft organization" }));
    expect(start).toHaveBeenCalledWith({ organizationId: TEAM.id, kind: "organization" });
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://login.test/authorize?state=teams.abc"),
    );
  });

  test("a member sees who can link it, and can link their own account", async () => {
    answerQuery(api.microsoftTeams.forTeam, { ...notLinked, canEdit: false });
    const start = mutationOf(api.microsoftTeams.startLink);
    start.mockResolvedValue("https://login.test/authorize");
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      assign: vi.fn(),
    } as Location);
    renderInApp(<TeamsCard />);
    expect(screen.getByText(/A team owner or admin can link/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link Microsoft organization" })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Link my Microsoft account" }));
    expect(start).toHaveBeenCalledWith({ organizationId: TEAM.id, kind: "person" });
  });

  test("once linked, it offers the Teams app to download and how to add it", () => {
    answerQuery(api.microsoftTeams.forTeam, linked);
    actionOf(api.microsoftTeams.channels).mockResolvedValue(channels);
    renderInApp(<TeamsCard />);
    expect(screen.getByText("Salt House Media")).toBeInTheDocument();
    expect(screen.getByText(/by Jordan Lee/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download the Teams app/ })).toHaveAttribute(
      "href",
      "https://site.test/teams/app.zip",
    );
    expect(screen.getByText(/Upload an app/)).toBeInTheDocument();
    expect(screen.getByText("2 people on the team are known in Teams.")).toBeInTheDocument();
  });

  test("an owner picks the channel alerts go to", async () => {
    answerQuery(api.microsoftTeams.forTeam, linked);
    actionOf(api.microsoftTeams.channels).mockResolvedValue(channels);
    const pick = actionOf(api.microsoftTeams.setAlertChannel);
    pick.mockResolvedValue({ ok: true });
    renderInApp(<TeamsCard />);
    const select = screen.getByRole("combobox", { name: "Alerts" });
    await waitFor(() => expect(select).toBeEnabled());
    expect(select).toHaveTextContent("Not posted");
    expect(screen.getByText(/approvals can be decided right in Teams/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(select);
    await user.click(screen.getByRole("option", { name: "Video team › Edits" }));
    expect(pick).toHaveBeenCalledWith({ organizationId: TEAM.id, channelId: "19:edits" });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Alerts go to Teams"));
  });

  test("before the bot has been in a team, it says how to make channels show", async () => {
    answerQuery(api.microsoftTeams.forTeam, { ...linked, teamsSeen: [] });
    actionOf(api.microsoftTeams.channels).mockResolvedValue([]);
    renderInApp(<TeamsCard />);
    expect(await screen.findByText(/mention the agent once/)).toBeInTheDocument();
  });

  test("someone known from Microsoft 365 needs no separate link", () => {
    answerQuery(api.microsoftTeams.forTeam, {
      ...linked,
      canEdit: false,
      me: { name: "Maya Ortiz", linkedAt: Date.UTC(2026, 10, 19), via: "microsoft" },
    });
    renderInApp(<TeamsCard />);
    expect(screen.getByText(/Known from Microsoft 365 as/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unlink" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Alerts" })).toBeNull();
    expect(screen.getByText("Alerts are not posted to Teams.")).toBeInTheDocument();
  });

  test("says how the Microsoft sign-in went, once", () => {
    window.history.replaceState(null, "", "/settings/teams?teams=personal_account");
    answerQuery(api.microsoftTeams.forTeam, notLinked);
    renderInApp(<TeamsCard />);
    expect(toastError).toHaveBeenCalledWith(TEAMS_RESULTS.personal_account.text);
    expect(window.location.search).toBe("");
  });
});
