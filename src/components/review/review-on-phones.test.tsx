import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { answerQuery, mutationOf, present } from "@/test/convex";
import { windowWidth } from "@/test/media";
import { renderInApp, TEAM } from "@/test/render";
import { missingTourTargets } from "@/test/tours";

import { ReviewRoom } from "./review-room";
import { REVIEW_TOUR } from "./review-tour";
import { SharedReview } from "./shared-review";

// The review room and the client's share link on a phone: one column that scrolls inside
// the room, the decision as two big buttons along the bottom, and the box to write a note
// straight under the clip.

const REVIEW = "rev_1" as Id<"reviews">;

const room = (over: Record<string, unknown> = {}) => ({
  _id: REVIEW,
  organizationId: TEAM.id,
  title: "Weekly clips",
  status: "open",
  createdAt: 1_700_000_000_000,
  decidedBy: null,
  decidedAt: null,
  holdsRun: true,
  fromRun: true,
  clips: [
    {
      _id: "clip_a",
      title: "Opening hello",
      versions: [{ url: "https://files.example/a.mp4", addedAt: 1 }],
      comments: 0,
      open: 0,
    },
  ],
  ...over,
});

function openRoom(review: unknown = room()) {
  answerQuery(api.reviews.get, review);
  answerQuery(api.reviews.people, {
    me: "u1",
    people: [{ id: "u1", name: "Jordan Lee", image: null }],
  });
  answerQuery(api.reviews.comments, []);
  const view = renderInApp(<ReviewRoom reviewId={REVIEW} />);
  return { ...view, user: userEvent.setup() };
}

const bar = () => document.querySelector<HTMLElement>("[data-decision-bar]");

beforeEach(() => {
  present.push({ userId: "u1", online: true, lastDisconnected: 0 });
  window.localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("the review room on a phone", () => {
  test("puts Approve and Ask for changes along the bottom, outside the part that scrolls", async () => {
    windowWidth(390);
    const { user } = openRoom();
    const decision = bar()!;
    expect(decision).not.toBeNull();
    expect(decision.closest("[data-room-scroll]")).toBeNull();
    // What approving does is said right beside the buttons.
    expect(within(decision).getByText(/An automation is paused on this review/)).toBeVisible();
    await user.click(within(decision).getByRole("button", { name: "Approve" }));
    expect(mutationOf(api.reviews.decide)).toHaveBeenLastCalledWith({
      reviewId: REVIEW,
      approved: true,
    });
    await user.click(within(decision).getByRole("button", { name: "Ask for changes" }));
    expect(mutationOf(api.reviews.decide)).toHaveBeenLastCalledWith({
      reviewId: REVIEW,
      approved: false,
    });
    // Drawn once: the top row has no second pair.
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
  });

  test("keeps the top row to the title and three icon buttons, each still named", () => {
    windowWidth(390);
    openRoom();
    const share = screen.getByRole("button", { name: "Share" });
    expect(share).not.toHaveTextContent("Share");
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
    expect(screen.getByText("Only you here")).toBeInTheDocument();
  });

  test("a decided review has no bar; its badge stays at the top", () => {
    windowWidth(390);
    openRoom(room({ status: "approved", decidedBy: "u1" }));
    expect(bar()).toBeNull();
    expect(screen.getByText(/Approved by Jordan Lee/)).toBeInTheDocument();
  });

  test("the box to write in comes before the conversation", () => {
    windowWidth(390);
    openRoom();
    const panel = screen.getByRole("region", { name: "Comments" });
    const box = within(panel).getByRole("textbox", { name: /^Comment at this moment/ });
    // Stacked, the box is shown first (CSS order) and the thread list after it.
    expect(box.closest(".max-lg\\:order-1")).not.toBeNull();
    expect(panel.querySelector(".max-lg\\:order-2")).not.toBeNull();
  });

  test("the tour still finds every part it points at", () => {
    windowWidth(390);
    openRoom();
    expect(missingTourTargets(REVIEW_TOUR)).toEqual([]);
  });
});

describe("the review room on a wide screen", () => {
  test("keeps the decision in the top row and has no bottom bar", () => {
    windowWidth(1440);
    openRoom();
    expect(bar()).toBeNull();
    expect(screen.getByRole("button", { name: "Share" })).toHaveTextContent("Share");
    expect(
      screen.getByRole("button", { name: "Approve" }).closest("[data-room-scroll]"),
    ).not.toBeNull();
  });
});

describe("a shared review on a client's phone", () => {
  const TOKEN = "a".repeat(64);
  const shared = (over: Record<string, unknown> = {}) => ({
    title: "Weekly clips",
    teamName: "Salt House",
    brand: { logo: null, color: null },
    status: "open",
    allowVerdict: true,
    verdict: null,
    clips: [
      {
        _id: "clip_a",
        title: "Opening hello",
        versions: [{ url: "https://files.example/a.mp4", addedAt: 1 }],
      },
    ],
    ...over,
  });

  function openShared(value: unknown = shared()) {
    window.localStorage.setItem(
      "ncat-dash:share-guest",
      JSON.stringify({ id: "riley-browser-0001", name: "Riley" }),
    );
    answerQuery(api.sharedReview.room, value);
    answerQuery(api.sharedReview.comments, []);
    render(
      <TooltipProvider>
        <SharedReview token={TOKEN} />
      </TooltipProvider>,
    );
    return userEvent.setup();
  }

  test("gives the client the two buttons along the bottom", async () => {
    windowWidth(390);
    const user = openShared();
    const decision = bar()!;
    expect(decision.closest("[data-room-scroll]")).toBeNull();
    await user.click(within(decision).getByRole("button", { name: "Approve" }));
    expect(mutationOf(api.sharedReview.verdict)).toHaveBeenLastCalledWith({
      token: TOKEN,
      guestId: "riley-browser-0001",
      name: "Riley",
      approved: true,
    });
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
  });

  test("no bar when the team did not ask for a decision, or has decided", () => {
    windowWidth(390);
    openShared(shared({ allowVerdict: false }));
    expect(bar()).toBeNull();
  });

  test("keeps the buttons in the header on a wide screen", () => {
    windowWidth(1440);
    openShared();
    expect(bar()).toBeNull();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });
});
