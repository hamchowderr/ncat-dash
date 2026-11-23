import { api } from "@convex/_generated/api";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { actionOf, answerQuery, mutationOf, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { SlackCard } from "./slack-card";

const connected = {
  connected: true,
  canEdit: true,
  slackTeamName: "Salt House",
  connectedAt: Date.UTC(2026, 10, 17, 18),
  connectedBy: "Jordan Lee",
  alertChannel: null,
};

const channels = [
  { id: "G0CLIENT", name: "client-x", private: true },
  { id: "C0VIDEO", name: "video-team", private: false },
];

describe("the Slack card", () => {
  test("walks an owner through making the app, with the manifest filled in", () => {
    answerQuery(api.slack.forTeam, { connected: false, canEdit: true });
    renderInApp(<SlackCard />);
    const create = screen.getByRole("link", { name: "Create the Slack app" });
    const manifest = JSON.parse(
      new URL(create.getAttribute("href") ?? "").searchParams.get("manifest_json") ?? "",
    );
    expect(manifest.display_information.name).toBe("Takewon");
    expect(manifest.settings.event_subscriptions.request_url).toMatch(/\/api\/slack\/events$/);
    expect(screen.getByLabelText("Bot User OAuth Token")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Signing Secret")).toHaveAttribute("type", "password");
    // Tests run at localhost, which Slack cannot reach.
    expect(screen.getByText("Slack can't reach this address")).toBeInTheDocument();
  });

  test("connects with the two pasted values, and shows what Slack said when it is refused", async () => {
    answerQuery(api.slack.forTeam, { connected: false, canEdit: true });
    const connect = actionOf(api.slack.connect);
    connect.mockResolvedValueOnce({ ok: false, detail: "That is not a bot token." });
    connect.mockResolvedValueOnce({ ok: true });
    renderInApp(<SlackCard />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Bot User OAuth Token"), "xoxp-user");
    await user.type(screen.getByLabelText("Signing Secret"), "secret");
    await user.click(screen.getByRole("button", { name: "Connect Slack" }));
    expect(await screen.findByText("That is not a bot token.")).toBeInTheDocument();
    expect(connect).toHaveBeenLastCalledWith({
      organizationId: TEAM.id,
      botToken: "xoxp-user",
      signingSecret: "secret",
    });

    await user.clear(screen.getByLabelText("Bot User OAuth Token"));
    await user.type(screen.getByLabelText("Bot User OAuth Token"), "xoxb-good");
    await user.click(screen.getByRole("button", { name: "Connect Slack" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Slack is connected"));
  });

  test("an owner picks the Slack channel review activity goes to", async () => {
    answerQuery(api.slack.forTeam, connected);
    actionOf(api.slackReview.channels).mockResolvedValue(channels);
    const pick = actionOf(api.slackReview.setAlertChannel);
    pick.mockResolvedValue({ ok: true });
    renderInApp(<SlackCard />);
    const select = screen.getByRole("combobox", { name: "Review activity" });
    await waitFor(() => expect(select).toBeEnabled());
    expect(select).toHaveTextContent("Not posted");
    const user = userEvent.setup();
    await user.click(select);
    expect(screen.getByRole("option", { name: /Private\s*client-x/ })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "#video-team" }));
    expect(pick).toHaveBeenCalledWith({ organizationId: TEAM.id, channelId: "C0VIDEO" });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Review activity goes to Slack"));
  });

  test("says why a channel was not picked", async () => {
    answerQuery(api.slack.forTeam, {
      ...connected,
      alertChannel: { id: "C0VIDEO", name: "video-team" },
    });
    actionOf(api.slackReview.channels).mockResolvedValue(channels);
    actionOf(api.slackReview.setAlertChannel).mockResolvedValue({
      ok: false,
      detail: "The app could not join #general.",
    });
    renderInApp(<SlackCard />);
    const select = screen.getByRole("combobox", { name: "Review activity" });
    await waitFor(() => expect(select).toBeEnabled());
    expect(select).toHaveTextContent("video-team");
    const user = userEvent.setup();
    await user.click(select);
    await user.click(screen.getByRole("option", { name: "Not posted" }));
    expect(await screen.findByText("The app could not join #general.")).toBeInTheDocument();
  });

  test("shows the connected workspace, and an owner can disconnect it", async () => {
    answerQuery(api.slack.forTeam, connected);
    actionOf(api.slackReview.channels).mockResolvedValue(channels);
    const disconnect = mutationOf(api.slack.disconnect);
    renderInApp(<SlackCard />);
    expect(screen.getByText("Salt House")).toBeInTheDocument();
    expect(screen.getByText(/by Jordan Lee/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Bot User OAuth Token")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Disconnect" }));
    expect(disconnect).toHaveBeenCalledWith({ organizationId: TEAM.id });
  });

  test("a member sees whether it is connected, and nothing to change", () => {
    answerQuery(api.slack.forTeam, { connected: false, canEdit: false });
    const { unmount } = renderInApp(<SlackCard />);
    expect(screen.getByText(/A team owner or admin can connect it here/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create the Slack app" })).not.toBeInTheDocument();
    unmount();

    answerQuery(api.slack.forTeam, {
      ...connected,
      canEdit: false,
      alertChannel: { id: "C0VIDEO", name: "video-team" },
    });
    renderInApp(<SlackCard />);
    expect(screen.getByText("Salt House")).toBeInTheDocument();
    expect(screen.getByText(/posted to #video-team/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
  });
});
