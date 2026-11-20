import { api } from "@convex/_generated/api";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery, mutationOf, toastError, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { TelegramCard } from "./telegram-card";

const empty = {
  ready: true,
  botUsername: "SaltHouseBot",
  canEdit: true,
  groups: [],
  me: null,
  linkedCount: 0,
};
const linked = {
  ...empty,
  groups: [
    {
      chatId: "-100777",
      title: "Edit team",
      addedAt: Date.UTC(2026, 10, 20, 18),
      addedBy: "Jordan Lee",
      reviews: false,
    },
  ],
  me: { telegramName: "Jordan", username: "jordan", linkedAt: Date.UTC(2026, 10, 20, 18) },
  linkedCount: 1,
};

afterEach(() => {
  vi.restoreAllMocks();
});

/** window.open returns a stand-in tab, whose address the card sets once the code is made. */
function stubTab() {
  const tab = { location: { href: "" }, close: vi.fn() };
  const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  return { tab, open };
}

describe("the Telegram card", () => {
  test("a group where tagging the agent can't reach it says how to fix it", async () => {
    answerQuery(api.telegram.forTeam, linked);
    actionOf(api.telegram.groupHearing).mockResolvedValue([
      { chatId: "-100777", hears: false, privacyOff: false },
    ]);
    renderInApp(<TelegramCard />);
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent(/Tagging the agent here doesn.t reach it yet/);
    expect(note).toHaveTextContent(/send \/setprivacy to @BotFather/);
    expect(note).toHaveTextContent(/choose Disable/);
    expect(actionOf(api.telegram.groupHearing)).toHaveBeenCalledWith({ organizationId: TEAM.id });
  });

  test("a group that hears the agent being tagged shows no warning", async () => {
    answerQuery(api.telegram.forTeam, linked);
    const check = actionOf(api.telegram.groupHearing);
    check.mockResolvedValue([{ chatId: "-100777", hears: true, privacyOff: true }]);
    renderInApp(<TelegramCard />);
    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  test("with no groups, Telegram is not asked about them", () => {
    answerQuery(api.telegram.forTeam, empty);
    renderInApp(<TelegramCard />);
    expect(actionOf(api.telegram.groupHearing)).not.toHaveBeenCalled();
  });

  test("the group that hears about reviews says so, and an owner can stop it", async () => {
    answerQuery(api.telegram.forTeam, {
      ...linked,
      groups: [{ ...linked.groups[0], reviews: true }],
    });
    const pick = mutationOf(api.telegram.setReviewGroup);
    renderInApp(<TelegramCard />);
    expect(screen.getByText(/review activity posts here/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Stop review posts" }));
    expect(pick).toHaveBeenCalledWith({ organizationId: TEAM.id, chatId: null });
  });

  test("says when this dashboard has no Telegram bot yet, with nothing to press", () => {
    answerQuery(api.telegram.forTeam, { ...empty, ready: false });
    renderInApp(<TelegramCard />);
    expect(screen.getByText(/not set up on this dashboard yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("Link my Telegram opens the bot with a code, then waits for Start", async () => {
    answerQuery(api.telegram.forTeam, empty);
    const start = mutationOf(api.telegram.startLink);
    start.mockResolvedValue("https://t.me/SaltHouseBot?start=abc");
    const { tab, open } = stubTab();
    renderInApp(<TelegramCard />);
    expect(screen.getByText(/@SaltHouseBot/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Link my Telegram" }));
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(start).toHaveBeenCalledWith({ organizationId: TEAM.id, kind: "person" });
    await waitFor(() => expect(tab.location.href).toBe("https://t.me/SaltHouseBot?start=abc"));
    expect(screen.getByRole("status")).toHaveTextContent(/press Start in Telegram/);
  });

  test("when the code cannot be made, the empty tab closes and the card says so", async () => {
    answerQuery(api.telegram.forTeam, empty);
    mutationOf(api.telegram.startLink).mockRejectedValue(new Error("nope"));
    const { tab } = stubTab();
    renderInApp(<TelegramCard />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Link my Telegram" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(tab.close).toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  test("a member sees no group button; an owner adds the agent to a group", async () => {
    answerQuery(api.telegram.forTeam, { ...empty, canEdit: false });
    const { unmount } = renderInApp(<TelegramCard />);
    expect(screen.queryByRole("button", { name: "Add to a group" })).not.toBeInTheDocument();
    expect(screen.getByText(/A team owner or admin can add it here/)).toBeInTheDocument();
    unmount();

    answerQuery(api.telegram.forTeam, empty);
    const start = mutationOf(api.telegram.startLink);
    start.mockResolvedValue("https://t.me/SaltHouseBot?startgroup=abc");
    const { tab } = stubTab();
    renderInApp(<TelegramCard />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add to a group" }));
    expect(start).toHaveBeenCalledWith({ organizationId: TEAM.id, kind: "group" });
    await waitFor(() => expect(tab.location.href).toBe("https://t.me/SaltHouseBot?startgroup=abc"));
    expect(screen.getByRole("status")).toHaveTextContent(/Pick the group in Telegram/);
  });

  test("shows the linked account and the group, and removes and unlinks them", async () => {
    answerQuery(api.telegram.forTeam, linked);
    const remove = mutationOf(api.telegram.removeGroup);
    const unlink = mutationOf(api.telegram.unlinkMe);
    renderInApp(<TelegramCard />);
    expect(screen.getByText("Jordan")).toBeInTheDocument();
    expect(screen.getByText(/@jordan/)).toBeInTheDocument();
    expect(screen.getByText("Edit team")).toBeInTheDocument();
    expect(screen.getByText(/by Jordan Lee/)).toBeInTheDocument();
    expect(screen.getByText("1 person on the team has linked their Telegram.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to another group" })).toBeInTheDocument();
    const user = userEvent.setup();
    const pick = mutationOf(api.telegram.setReviewGroup);
    await user.click(screen.getByRole("button", { name: "Post reviews here" }));
    expect(pick).toHaveBeenCalledWith({ organizationId: TEAM.id, chatId: "-100777" });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Review activity now posts in Edit team"),
    );
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(remove).toHaveBeenCalledWith({ organizationId: TEAM.id, chatId: "-100777" });
    await user.click(screen.getByRole("button", { name: "Unlink" }));
    expect(unlink).toHaveBeenCalledWith({ organizationId: TEAM.id });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Your Telegram is unlinked"));
  });
});
