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
  covers: ["https://files.example/clip.mp4"],
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
    expect(screen.getByRole("link", { name: "Go to Files" })).toHaveAttribute(
      "href",
      "/files?tab=made",
    );
  });

  test("lists each review with its status and what is left to do", () => {
    answerQuery(api.reviews.list, [
      review({ _id: "r1", fromRun: true, comments: 5, open: 2 }),
      review({ _id: "r2", title: "Podcast cut", status: "approved", clips: 1, comments: 3 }),
      review({
        _id: "r3",
        title: "Promo",
        status: "rejected",
        clips: 1,
        cover: "https://f.example/a.png",
        covers: ["https://f.example/a.png"],
      }),
    ]);
    renderInApp(<ReviewsView />);
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

    expect(within(cards[2]).getByText(/1 clip · no comments/)).toBeInTheDocument();
    expect(within(cards[2]).getByText("Changes needed")).toBeInTheDocument();
    // A picture is shown as a picture, a video as its first frame.
    expect(cards[2].querySelector("img")).toHaveAttribute("src", "https://f.example/a.png");
    expect(cards[1].querySelector("video")).toHaveAttribute(
      "src",
      "https://files.example/clip.mp4#t=0.1",
    );
  });

  test("puts what is waiting for a decision first, apart from what is decided", () => {
    answerQuery(api.reviews.list, [
      review({ _id: "r1", title: "Podcast cut", status: "approved" }),
      review({ _id: "r2", title: "Weekly clips", open: 2, comments: 3 }),
      review({ _id: "r3", title: "Promo", open: 1, comments: 1 }),
    ]);
    renderInApp(<ReviewsView />);

    const waiting = screen.getByRole("region", { name: "Waiting for a decision" });
    const decided = screen.getByRole("region", { name: "Decided" });
    expect(
      within(waiting)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([expect.stringContaining("Weekly clips"), expect.stringContaining("Promo")]);
    expect(within(decided).getByRole("link")).toHaveAttribute("href", "/review/r1");

    // The numbers at the top: two waiting, three comments to resolve on them, one decided.
    const glance = screen.getByLabelText("At a glance");
    expect(within(glance).getByText("Waiting for a decision").nextSibling).toHaveTextContent("2");
    expect(within(glance).getByText("Comments to resolve").nextSibling).toHaveTextContent("3");
    expect(within(glance).getByText("Decided").nextSibling).toHaveTextContent("1");
  });

  test("says so when nothing is waiting", () => {
    answerQuery(api.reviews.list, [review({ status: "approved" })]);
    renderInApp(<ReviewsView />);
    expect(screen.getByText("Nothing is waiting for a decision right now.")).toBeInTheDocument();
  });

  test("leaves out the Decided section until something is decided", () => {
    answerQuery(api.reviews.list, [review({})]);
    renderInApp(<ReviewsView />);
    expect(screen.queryByRole("region", { name: "Decided" })).not.toBeInTheDocument();
  });

  test("shows a picture of every listed clip, and how many more there are", () => {
    const covers = [1, 2, 3, 4, 5, 6].map((n) => `https://files.example/clip-${n}.mp4`);
    answerQuery(api.reviews.list, [review({ clips: 9, covers })]);
    renderInApp(<ReviewsView />);
    const row = screen.getByRole("link");
    expect(row.querySelectorAll("[data-strip] video")).toHaveLength(6);
    expect(within(row).getByText("+3")).toBeInTheDocument();
  });

  test("still shows the first clip's picture from a backend that sends only that", () => {
    answerQuery(api.reviews.list, [review({ clips: 3, covers: undefined })]);
    renderInApp(<ReviewsView />);
    const row = screen.getByRole("link");
    expect(row.querySelectorAll("[data-strip] video")).toHaveLength(1);
    expect(within(row).getByText("+2")).toBeInTheDocument();
  });

  test("gives the facts their own columns on a wide screen", () => {
    answerQuery(api.reviews.list, [review({ clips: 4, comments: 5, open: 2 })]);
    renderInApp(<ReviewsView />);
    const row = screen.getByRole("link");
    expect(row.querySelector('[data-fact="Clips"]')).toHaveTextContent("Clips4");
    expect(row.querySelector('[data-fact="Comments"]')).toHaveTextContent("2 to resolve");
    expect(row.querySelector('[data-fact="Opened"]')).toHaveTextContent(/Opened.*2023/);
  });
});
