import { api } from "@convex/_generated/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import { answerQuery, mutationOf } from "@/test/convex";

import { BetaTestersView } from "./beta-testers-view";

const ana = {
  _id: "t1",
  email: "ana@example.com",
  name: "Ana Lopez",
  source: "The KINN",
  link: "https://instagram.com/ana",
  newsletter: true,
  status: "applied" as const,
  timesApplied: 1,
  appliedAt: Date.UTC(2026, 10, 26),
  updatedAt: Date.UTC(2026, 10, 26),
  answers: [{ question: "Makes", answer: "Podcasts" }],
};
const rosa = {
  ...ana,
  _id: "t2",
  email: "rosa@example.com",
  name: "Rosa Diaz",
  source: undefined,
  newsletter: false,
  status: "joined" as const,
  joinedAt: Date.UTC(2026, 10, 26),
};

beforeEach(() => {
  answerQuery(api.operator.me, true);
  answerQuery(api.beta.counts, { applied: 1, invited: 0, joined: 1 });
  answerQuery(api.beta.list, [ana, rosa]);
  answerQuery(api.beta.get, ana);
});

describe("Beta Testers", () => {
  test("lists each sign-up with where they heard about it and its status", () => {
    render(<BetaTestersView />);
    expect(screen.getByRole("heading", { name: "Beta Testers" })).toBeTruthy();
    expect(screen.getByText("Ana Lopez")).toBeTruthy();
    expect(screen.getByText("From The KINN")).toBeTruthy();
    expect(screen.getByText("Asked for news")).toBeTruthy();
    expect(screen.getAllByText("Joined").length).toBeGreaterThan(0);
  });

  test("invites everyone waiting with one button, leaving joined people out", async () => {
    const invite = mutationOf(api.beta.invite);
    invite.mockResolvedValue(1);
    render(<BetaTestersView />);
    fireEvent.click(screen.getByRole("button", { name: "Invite 1 waiting" }));
    await waitFor(() => expect(invite).toHaveBeenCalledWith({ testerIds: ["t1"] }));
  });

  test("opens a sign-up to read every answer and invite that one person", async () => {
    const invite = mutationOf(api.beta.invite);
    invite.mockResolvedValue(1);
    render(<BetaTestersView />);
    fireEvent.click(screen.getByRole("button", { name: /Ana Lopez, ana@example.com/ }));
    expect(await screen.findByText("Podcasts")).toBeTruthy();
    expect(screen.getByText("Heard about it from")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Invite to the beta" }));
    await waitFor(() => expect(invite).toHaveBeenCalledWith({ testerIds: ["t1"] }));
  });

  test("isn't shown to anyone but the operator", () => {
    answerQuery(api.operator.me, false);
    render(<BetaTestersView />);
    expect(screen.getByText(/Only the people who run this copy/)).toBeTruthy();
    expect(screen.queryByText("Ana Lopez")).toBeNull();
  });
});
