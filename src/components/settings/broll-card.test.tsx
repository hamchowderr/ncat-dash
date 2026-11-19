import { api } from "@convex/_generated/api";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { actionOf, answerQuery, toastError, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { BrollCard } from "./broll-card";
import { SETTINGS_PAGES } from "./settings-pages";

const status = {
  keys: { pixabay: "none", pexels: "none" },
  manager: true,
  videos: 12,
  looked: 9,
  looking: 1,
  broll: 4,
};

describe("Settings, B-Roll", () => {
  test("is a settings page with a Title Case name", () => {
    expect(SETTINGS_PAGES.find((page) => page.slug === "broll")?.title).toBe("B-Roll");
  });

  test("says how much of the library is ready, and looks at the rest", async () => {
    answerQuery(api.broll.status, status);
    const look = actionOf(api.broll.lookThroughLibrary);
    look.mockResolvedValue(2);
    renderInApp(<BrollCard />);
    expect(screen.getByText("4 videos ready as B-Roll")).toBeInTheDocument();
    expect(screen.getByText(/9 of 12 videos looked at, 1 being looked at now/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Look at 2 videos" }));
    expect(look).toHaveBeenCalledWith({ organizationId: TEAM.id });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Looking at 2 videos"));
  });

  test("built-in stock needs nothing", () => {
    answerQuery(api.broll.status, { ...status, keys: { pixabay: "built-in", pexels: "built-in" } });
    renderInApp(<BrollCard />);
    expect(screen.getAllByText("Built in. Nothing to set up.")).toHaveLength(2);
    expect(screen.queryByPlaceholderText("Paste the key")).not.toBeInTheDocument();
  });

  test("a team key is checked when it is saved, and a refused one says why", async () => {
    answerQuery(api.broll.status, status);
    const save = actionOf(api.broll.saveKey);
    save.mockResolvedValueOnce({
      ok: false,
      detail: "Pixabay did not accept this key. Copy it again from your account.",
    });
    save.mockResolvedValueOnce({ ok: true });
    renderInApp(<BrollCard />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Pixabay"), "abc123");
    await user.click(screen.getAllByRole("button", { name: "Save" })[0]);
    expect(save).toHaveBeenCalledWith({ organizationId: TEAM.id, site: "pixabay", key: "abc123" });
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Pixabay did not accept this key. Copy it again from your account.",
      ),
    );
    await user.click(screen.getAllByRole("button", { name: "Save" })[0]);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Pixabay is set up"));
  });

  test("members see where things stand but cannot add a key", () => {
    answerQuery(api.broll.status, { ...status, manager: false });
    renderInApp(<BrollCard />);
    expect(screen.queryByRole("button", { name: /Look at/ })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Paste the key")).not.toBeInTheDocument();
    expect(screen.getByText("Only an owner or admin can add a key.")).toBeInTheDocument();
  });
});
