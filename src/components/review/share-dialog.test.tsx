import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { answerQuery, mutationOf } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { ShareDialog } from "./share-dialog";

const REVIEW = "rev_1" as Id<"reviews">;
const TOKEN = "b".repeat(64);

function open(share: unknown) {
  answerQuery(api.reviewShares.forReview, share);
  renderInApp(<ShareDialog reviewId={REVIEW} />);
  return userEvent.setup();
}

describe("sharing a review with a client", () => {
  test("makes a link with the chosen settings", async () => {
    const user = open(null);
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(screen.getByRole("dialog", { name: "Share with a client" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Share link" })).toBeNull();
    expect(screen.getByRole("switch", { name: "Let them approve" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Show the team's comments" })).not.toBeChecked();
    await user.click(screen.getByRole("switch", { name: "Show the team's comments" }));
    expect(mutationOf(api.reviewShares.set)).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Create link" }));
    expect(mutationOf(api.reviewShares.set)).toHaveBeenCalledWith({
      reviewId: REVIEW,
      allowVerdict: true,
      showTeamComments: true,
    });
  });

  test("shows the link to copy, saves a changed setting at once, and can stop sharing", async () => {
    const user = open({ token: TOKEN, allowVerdict: true, showTeamComments: false });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await user.click(screen.getByRole("button", { name: "Share" }));
    const link = `${window.location.origin}/share/${TOKEN}`;
    expect(screen.getByRole("textbox", { name: "Share link" })).toHaveValue(link);
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(link);
    expect(screen.getByRole("button", { name: "Copied" })).toBeVisible();

    await user.click(screen.getByRole("switch", { name: "Let them approve" }));
    expect(mutationOf(api.reviewShares.set)).toHaveBeenCalledWith({
      reviewId: REVIEW,
      allowVerdict: false,
      showTeamComments: false,
    });
    await user.click(screen.getByRole("button", { name: "Stop sharing" }));
    expect(mutationOf(api.reviewShares.stop)).toHaveBeenCalledWith({ reviewId: REVIEW });
  });
});
