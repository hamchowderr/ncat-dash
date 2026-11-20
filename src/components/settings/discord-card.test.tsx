import { api } from "@convex/_generated/api";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery, mutationOf, toastError, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { DiscordCard } from "./discord-card";

const empty = {
  ready: true,
  canEdit: true,
  servers: [],
  reviewChannel: null,
  me: null,
  linkedCount: 0,
};
const added = {
  ready: true,
  canEdit: true,
  servers: [
    {
      guildId: "300",
      guildName: "Salt House Crew",
      addedAt: Date.UTC(2026, 10, 17, 18),
      addedBy: "Jordan Lee",
    },
  ],
  reviewChannel: null,
  me: { discordName: "Jordan", linkedAt: Date.UTC(2026, 10, 17, 18) },
  linkedCount: 1,
};

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("the Discord card", () => {
  test("says when this dashboard has no Discord bot yet, with nothing to press", () => {
    answerQuery(api.discord.forTeam, { ...empty, ready: false });
    renderInApp(<DiscordCard />);
    expect(screen.getByText(/not set up on this dashboard yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("an owner adds the agent to a server, and Discord opens", async () => {
    answerQuery(api.discord.forTeam, empty);
    const start = mutationOf(api.discord.startLink);
    start.mockResolvedValue("https://discord.test/oauth2/authorize?state=abc");
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      href: "http://localhost/settings",
      assign,
    } as Location);
    renderInApp(<DiscordCard />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add to Discord" }));
    expect(start).toHaveBeenCalledWith({ organizationId: TEAM.id, kind: "server" });
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://discord.test/oauth2/authorize?state=abc"),
    );
    vi.restoreAllMocks();
  });

  test("a member sees no add button but can link their own Discord", async () => {
    answerQuery(api.discord.forTeam, { ...empty, canEdit: false });
    const start = mutationOf(api.discord.startLink);
    start.mockRejectedValue(new Error("stop here"));
    renderInApp(<DiscordCard />);
    expect(screen.queryByRole("button", { name: "Add to Discord" })).not.toBeInTheDocument();
    expect(screen.getByText(/A team owner or admin can add it here/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Link my Discord" }));
    expect(start).toHaveBeenCalledWith({ organizationId: TEAM.id, kind: "person" });
  });

  test("shows the server and the linked account, and removes and unlinks them", async () => {
    answerQuery(api.discord.forTeam, added);
    const remove = mutationOf(api.discord.removeServer);
    const unlink = mutationOf(api.discord.unlinkMe);
    renderInApp(<DiscordCard />);
    expect(screen.getByText("Salt House Crew")).toBeInTheDocument();
    expect(screen.getByText(/by Jordan Lee/)).toBeInTheDocument();
    expect(screen.getByText("Jordan")).toBeInTheDocument();
    expect(screen.getByText("1 person on the team has linked their Discord.")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(remove).toHaveBeenCalledWith({ organizationId: TEAM.id, guildId: "300" });
    await user.click(screen.getByRole("button", { name: "Unlink" }));
    expect(unlink).toHaveBeenCalledWith({ organizationId: TEAM.id });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Your Discord is unlinked"));
  });

  test("coming back from Discord says how it went, then tidies the address", async () => {
    window.history.replaceState(null, "", "/settings/discord?discord=taken");
    answerQuery(api.discord.forTeam, empty);
    renderInApp(<DiscordCard />);
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "That Discord server is already linked to another team.",
      ),
    );
    expect(window.location.search).toBe("");
  });

  test("an owner picks the Discord channel review activity goes to", async () => {
    answerQuery(api.discord.forTeam, added);
    actionOf(api.discordReview.channels).mockResolvedValue([
      { id: "c1", name: "general", guildId: "300", guildName: "Salt House Crew" },
      { id: "c2", name: "reviews", guildId: "300", guildName: "Salt House Crew" },
    ]);
    const pick = actionOf(api.discordReview.setAlertChannel);
    pick.mockResolvedValue({ ok: true });
    renderInApp(<DiscordCard />);
    const select = screen.getByRole("combobox", { name: "Review activity" });
    await waitFor(() => expect(select).toBeEnabled());
    expect(select).toHaveTextContent("Not posted");
    const user = userEvent.setup();
    await user.click(select);
    await user.click(screen.getByRole("option", { name: "#reviews" }));
    expect(pick).toHaveBeenCalledWith({ organizationId: TEAM.id, channelId: "c2" });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Review activity goes to Discord"),
    );
  });

  test("a member sees where review activity goes, without a picker", () => {
    answerQuery(api.discord.forTeam, {
      ...added,
      canEdit: false,
      reviewChannel: { id: "c2", name: "reviews", guildName: "Salt House Crew" },
    });
    renderInApp(<DiscordCard />);
    expect(screen.queryByRole("combobox", { name: "Review activity" })).not.toBeInTheDocument();
    expect(screen.getByText(/posted to #reviews in Salt House Crew/)).toBeInTheDocument();
  });

  test("no picker before the agent is in a server", () => {
    answerQuery(api.discord.forTeam, empty);
    renderInApp(<DiscordCard />);
    expect(screen.queryByRole("combobox", { name: "Review activity" })).not.toBeInTheDocument();
  });
});
