import { api } from "@convex/_generated/api";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { answerQuery } from "@/test/convex";
import { daysLeftLabel } from "@/lib/trial";

import { AgentResting, TrialDays, TrialEnded, useTrialEnded } from "./trial-notice";

const BUY = "https://ncat-site.vercel.app/#early";

describe("the free trial on screen", () => {
  test("counts the days left along the top, with where to buy", () => {
    answerQuery(api.trial.status, { kind: "trial", endsAt: 1, daysLeft: 2, buyUrl: BUY });
    render(<TrialDays organizationId="team_1" />);
    expect(screen.getByText("2 days left in your trial")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Get the dashboard" }).getAttribute("href")).toBe(BUY);
  });

  test("says nothing for a team without a trial, or one that has bought", () => {
    answerQuery(api.trial.status, { kind: "none" });
    const { container, rerender } = render(<TrialDays organizationId="team_1" />);
    expect(container.textContent).toBe("");
    answerQuery(api.trial.status, { kind: "paid" });
    rerender(<TrialEnded organizationId="team_1" />);
    expect(container.textContent).toBe("");
  });

  test("leaves out the link when there is nowhere to buy yet", () => {
    answerQuery(api.trial.status, { kind: "trial", endsAt: 1, daysLeft: 1, buyUrl: null });
    render(<TrialDays organizationId="team_1" />);
    expect(screen.getByText("1 day left in your trial")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("once it is over, says the work is kept and where to get the dashboard", () => {
    answerQuery(api.trial.status, { kind: "ended", endsAt: 1, daysLeft: 0, buyUrl: BUY });
    render(<TrialEnded organizationId="team_1" />);
    const band = screen.getByRole("region", { name: "Free trial" });
    expect(band.textContent).toContain("Your free trial has ended");
    expect(band.textContent).toContain("Everything you made is kept");
    expect(screen.getByRole("link", { name: "Get the dashboard" }).getAttribute("href")).toBe(BUY);
    // Part of the page, never laid over it.
    expect(band.className).not.toMatch(/\b(fixed|absolute|sticky)\b/);
  });

  test("the agent rests once it is over, and can be closed", () => {
    const close = vi.fn();
    render(<AgentResting onClose={close} />);
    expect(screen.getByRole("heading", { name: "The agent is resting" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalled();
  });

  test("knows whether it is over, and waits while loading", () => {
    function Probe() {
      const ended = useTrialEnded("team_1");
      return <span>{ended === undefined ? "loading" : String(ended)}</span>;
    }
    const { rerender } = render(<Probe />);
    expect(screen.getByText("loading")).toBeTruthy();
    answerQuery(api.trial.status, { kind: "ended", endsAt: 1, daysLeft: 0, buyUrl: null });
    rerender(<Probe />);
    expect(screen.getByText("true")).toBeTruthy();
  });

  test("the last hours read as the last day", () => {
    expect(daysLeftLabel(0)).toBe("Last day of your trial");
    expect(daysLeftLabel(3)).toBe("3 days left in your trial");
  });
});
