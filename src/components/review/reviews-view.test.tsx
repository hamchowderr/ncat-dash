import { api } from "@convex/_generated/api";
import { screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { answerQuery } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { ReviewsView } from "./reviews-view";

const review = (over: Record<string, unknown>) => ({
  _id: "r1",
  title: "Weekly clips",
  status: "open",
  createdAt: 1_700_000_000_000,
  fromRun: false,
  clips: 4,
  cover: "https://files.example/clip.mp4",
  comments: 0,
  open: 0,
  ...over,
});

describe("the Review list", () => {
  test("asks for the active team's reviews", () => {
    let asked: unknown;
    answerQuery(api.reviews.list, (args: Record<string, unknown>) => {
      asked = args;
      return [];
    });
    renderInApp(<ReviewsView />);
    expect(asked).toEqual({ organizationId: TEAM.id });
  });

  test("explains how a review starts when there are none", () => {
    answerQuery(api.reviews.list, []);
    renderInApp(<ReviewsView />);
    expect(screen.getByText(/Nothing to review yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Outputs" })).toHaveAttribute("href", "/outputs");
  });

  test("lists each review with its status and what is left to do", () => {
    answerQuery(api.reviews.list, [
      review({ _id: "r1", fromRun: true, comments: 5, open: 2 }),
      review({ _id: "r2", title: "Podcast cut", status: "approved", clips: 1, comments: 3 }),
      review({ _id: "r3", title: "Promo", status: "rejected", cover: "https://f.example/a.png" }),
    ]);
    const { container } = renderInApp(<ReviewsView />);
    const cards = screen.getAllByRole("link");
    expect(cards.map((card) => card.getAttribute("href"))).toEqual([
      "/review/r1",
      "/review/r2",
      "/review/r3",
    ]);

    expect(within(cards[0]).getByText("Weekly clips")).toBeInTheDocument();
    expect(within(cards[0]).getByText(/4 clips · 2 to resolve/)).toBeInTheDocument();
    expect(within(cards[0]).getByText("In review")).toBeInTheDocument();
    expect(within(cards[0]).getByText("From an automation")).toBeInTheDocument();

    expect(within(cards[1]).getByText(/1 clip · all comments resolved/)).toBeInTheDocument();
    expect(within(cards[1]).getByText("Approved")).toBeInTheDocument();
    expect(within(cards[1]).queryByText("From an automation")).not.toBeInTheDocument();

    expect(within(cards[2]).getByText(/no comments/)).toBeInTheDocument();
    expect(within(cards[2]).getByText("Changes needed")).toBeInTheDocument();
    // A picture is shown as a picture, a video as its first frame.
    expect(cards[2].querySelector("img")).toHaveAttribute("src", "https://f.example/a.png");
    expect(container.querySelectorAll("video")).toHaveLength(2);
  });
});
