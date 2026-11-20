import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import { answerQuery, mutationOf, pushed } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { HomeView } from "./home-view";

const NOW = Date.now();
const SETUP_DONE = {
  toolkit: true,
  bucket: true,
  brand: true,
  automationOn: true,
  firstRun: true,
  goals: true,
};
const run = (n: number, status: string, extra: Record<string, unknown> = {}) => ({
  runId: `run${n}`,
  automationId: "auto1",
  automationName: "Weekly clips",
  status,
  startedAt: NOW - n * 60_000,
  finishedAt: null,
  startedWith: `episode ${n}.mp4`,
  error: null,
  ...extra,
});

function summary(overrides: Record<string, unknown> = {}) {
  return {
    week: { runs: 12, done: 10, failed: 1, going: 1 },
    recentRuns: [run(1, "done"), run(2, "failed", { error: "The toolkit did not answer." })],
    failures: [run(2, "failed", { error: "The toolkit did not answer." })],
    automations: { total: 4, on: 3 },
    setup: SETUP_DONE,
    contentKinds: [],
    ...overrides,
  };
}

const CONNECTION = {
  _id: "c1",
  baseUrl: "https://toolkit.example",
  apiKeyHint: "1234",
  status: "ok",
  buildNumber: "210",
  bucket: "media",
  lastCheckedAt: NOW,
  lastError: null,
};

beforeEach(() => {
  answerQuery(api.toolkitConnections.list, [CONNECTION]);
  answerQuery(api.runs.waitingApprovals, []);
});

describe("the home page", () => {
  test("says how the week went in one sentence", () => {
    answerQuery(api.home.summary, summary());
    renderInApp(<HomeView />);
    expect(screen.getByRole("heading", { level: 1, name: TEAM.name })).toBeTruthy();
    expect(screen.getByTestId("home-week").textContent).toBe(
      "3 automations on. 12 runs this week, 1 failed.",
    );
    const week = screen.getByRole("region", { name: "This week" });
    expect(within(week).getByText("Runs").nextSibling?.textContent).toBe("12");
  });

  test("puts what needs you first: approvals and this week's failures", () => {
    answerQuery(api.home.summary, summary());
    answerQuery(api.runs.waitingApprovals, [
      {
        runStepId: "s1",
        runId: "run9",
        automationId: "auto2",
        automationName: "Podcast master",
        waitingSince: NOW - 3_600_000,
        forYou: true,
        asked: ["Olu"],
      },
    ]);
    renderInApp(<HomeView />);
    const needs = screen.getByRole("region", { name: "Needs you" });
    expect(within(needs).getByRole("link", { name: "Review" }).getAttribute("href")).toBe(
      "/automations/auto2/runs/run9",
    );
    expect(within(needs).getByText("Asks you")).toBeTruthy();
    expect(within(needs).getByText(/failed on/).textContent).toContain("on episode 2.mp4");
    expect(
      within(needs).getByRole("link", { name: "Pick up failed runs" }).getAttribute("href"),
    ).toBe("/runs?show=failed");
    expect(within(needs).getByText("The toolkit did not answer.")).toBeTruthy();
    expect(
      within(needs).getByRole("link", { name: "See what happened" }).getAttribute("href"),
    ).toBe("/automations/auto1/runs/run2");
  });

  test("leaves out Needs you when nothing does", () => {
    answerQuery(api.home.summary, summary({ failures: [] }));
    renderInApp(<HomeView />);
    expect(screen.queryByRole("region", { name: "Needs you" })).toBeNull();
  });

  test("lists the latest runs with the file each one worked on", () => {
    answerQuery(api.home.summary, summary());
    renderInApp(<HomeView />);
    const latest = screen.getByRole("region", { name: "Latest runs" });
    const links = within(latest).getAllByRole("link", { name: /Weekly clips/ });
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("/automations/auto1/runs/run1");
    expect(links[0].textContent).toContain("episode 1.mp4");
  });

  test("leads with ready-made automations until one is switched on, and starts one", async () => {
    answerQuery(
      api.home.summary,
      summary({
        recentRuns: [],
        failures: [],
        week: { runs: 0, done: 0, failed: 0, going: 0 },
        automations: { total: 0, on: 0 },
        setup: { ...SETUP_DONE, automationOn: false, firstRun: false },
      }),
    );
    mutationOf(api.automations.create).mockResolvedValue("auto7");
    renderInApp(<HomeView />);
    const regions = screen
      .getAllByRole("region")
      .map((region) => region.getAttribute("aria-labelledby"));
    expect(regions.indexOf("home-ready-made-automations")).toBeLessThan(
      regions.indexOf("home-latest-runs"),
    );
    const ready = screen.getByRole("region", { name: "Ready-made automations" });
    expect(
      within(ready)
        .getByRole("link", { name: /See all 73/ })
        .getAttribute("href"),
    ).toBe("/automations/new");
    fireEvent.click(within(ready).getByText("Podcast master and transcript"));
    await waitFor(() => expect(pushed).toHaveBeenCalled());
    expect(mutationOf(api.automations.create)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      name: "Podcast master and transcript",
      starterId: "podcast-master",
    });
    expect(pushed.mock.calls[0][0]).toBe("/automations/auto7");
  });

  test("shows getting started only while something is left, with links to each step", () => {
    answerQuery(
      api.home.summary,
      summary({ setup: { ...SETUP_DONE, brand: false, firstRun: false } }),
    );
    const { unmount } = renderInApp(<HomeView />);
    const setup = screen.getByRole("region", { name: "Getting started, 4 of 6 done" });
    expect(
      within(setup)
        .getByRole("link", { name: /Add your logo/ })
        .getAttribute("href"),
    ).toBe("/settings/brand");
    expect(within(setup).queryByRole("link", { name: /Connect your toolkit/ })).toBeNull();
    unmount();
    answerQuery(api.home.summary, summary());
    renderInApp(<HomeView />);
    expect(screen.queryByRole("region", { name: /Getting started/ })).toBeNull();
  });

  test("Connect your toolkit opens the toolkit form, not the start of setting up", () => {
    answerQuery(api.home.summary, summary({ setup: { ...SETUP_DONE, toolkit: false } }));
    renderInApp(<HomeView />);
    const setup = screen.getByRole("region", { name: /Getting started/ });
    expect(
      within(setup)
        .getByRole("link", { name: /Connect your toolkit/ })
        .getAttribute("href"),
    ).toBe("/onboarding?toolkit=connect");
  });

  test("asks what the team makes until it is answered", () => {
    answerQuery(api.home.summary, summary({ setup: { ...SETUP_DONE, goals: false } }));
    renderInApp(<HomeView />);
    const setup = screen.getByRole("region", { name: "Getting started, 5 of 6 done" });
    expect(
      within(setup)
        .getByRole("link", { name: /Tell us what you make/ })
        .getAttribute("href"),
    ).toBe("/get-started");
  });

  test("puts the ready-made automations for what the team makes first", () => {
    answerQuery(
      api.home.summary,
      summary({ automations: { total: 0, on: 0 }, contentKinds: ["coaching"] }),
    );
    renderInApp(<HomeView />);
    const ready = screen.getByRole("region", { name: "Ready-made automations" });
    const names = within(ready)
      .getAllByRole("button")
      .map((button) => button.textContent ?? "");
    expect(names[0]).toContain("Coaching session pack");
    expect(names[1]).toContain("Sermon, webinar or lecture pack");
    // Still six to start from, the rest from the usual mix.
    expect(names).toHaveLength(6);
  });

  test("keeps the toolkit to one line, and opens its details when it is not answering", () => {
    answerQuery(api.home.summary, summary());
    answerQuery(api.toolkitConnections.list, [
      { ...CONNECTION, status: "failing", lastError: "Connection refused." },
    ]);
    renderInApp(<HomeView />);
    expect(screen.getByTestId("connection-status").textContent).toBe("Toolkit not responding");
    expect(screen.getByText("https://toolkit.example")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See how busy it is" }).getAttribute("href")).toBe(
      "/toolkit",
    );
  });

  test("leaves out the toolkit's load for a team whose toolkit is run for it", () => {
    answerQuery(api.home.summary, summary());
    answerQuery(api.toolkitHealth.shown, false);
    answerQuery(api.toolkitConnections.list, [
      { ...CONNECTION, status: "failing", lastError: "Connection refused." },
    ]);
    renderInApp(<HomeView />);
    expect(screen.getByText("https://toolkit.example")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "See how busy it is" })).toBeNull();
  });
});
