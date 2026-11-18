import { api } from "@convex/_generated/api";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { bytes, LoadTiles, READ_EVERY_MS, TeamJobs, ToolkitView, uptime } from "./toolkit-view";

const GB = 2 ** 30;
const HEALTH = {
  buildNumber: "220",
  cpus: 4,
  cpuPercent: 37.5,
  memory: { used: 2 * GB, limit: 16 * GB },
  disk: { free: 50 * GB, total: 100 * GB },
  uptimeSeconds: 5400,
  queue: { shared: true, waiting: 3, workers: 4, busy: 4 },
  jobs: { queued: 3, running: 4, done: 120 },
};
const NOW = 1_800_000_000_000;
const ACTIVITY = {
  limit: 3,
  jobs: [
    {
      _id: "j1",
      step: "Cover picture",
      state: "toolkit" as const,
      since: NOW - 95_000,
      run: { runId: "r1", automationId: "a1", automationName: "Weekly clips" },
    },
    { _id: "j2", step: "Media metadata", state: "held" as const, since: NOW - 5_000, run: null },
  ],
  more: 0,
  counts: { toolkit: 1, sending: 0, held: 1 },
  lastDay: { done: 12, failed: 1, typicalMs: 80_000 },
};

afterEach(() => vi.useRealTimers());

describe("the Toolkit page", () => {
  test("shows CPU, memory, disk and the queue from the toolkit", () => {
    render(<LoadTiles health={HEALTH} />);
    const cpu = screen.getByRole("region", { name: "CPU" });
    expect(within(cpu).getByText("38%")).toBeInTheDocument();
    expect(within(cpu).getByText("Of 4 CPUs · running for 1 h 30 min")).toBeInTheDocument();
    const memory = screen.getByRole("region", { name: "Memory" });
    expect(within(memory).getByText("2.0 GB")).toBeInTheDocument();
    expect(within(memory).getByText("Of 16 GB · 13% in use")).toBeInTheDocument();
    expect(screen.getByText("50 GB free")).toBeInTheDocument();
    const queue = screen.getByRole("region", { name: "Queue" });
    expect(within(queue).getByText("3 waiting")).toBeInTheDocument();
    expect(within(queue).getByText("4 of 4 workers busy")).toBeInTheDocument();
    expect(screen.getByTestId("everyone").textContent).toBe(
      "Everyone using this toolkit, last hour: 4 running, 3 waiting, 120 finished.",
    );
    // Nothing near its limit, so nothing to warn about.
    expect(screen.queryByText(/Nearly full|Busy\./)).not.toBeInTheDocument();
  });

  test("warns when memory or CPU is nearly used up", () => {
    render(
      <LoadTiles
        health={{
          ...HEALTH,
          cpuPercent: 97,
          memory: { used: 15 * GB, limit: 16 * GB },
          queue: { shared: false, waiting: null, workers: null, busy: null },
        }}
      />,
    );
    expect(screen.getByText(/A long video can fail when memory runs out/)).toBeInTheDocument();
    expect(screen.getByText(/New jobs wait their turn/)).toBeInTheDocument();
    expect(screen.getByText("Each toolkit process keeps its own queue")).toBeInTheDocument();
  });

  test("lists the team's jobs in flight with their runs and how long they have been at it", () => {
    renderInApp(<TeamJobs activity={ACTIVITY as never} now={NOW} />);
    const first = document.querySelector("[data-job='j1']") as HTMLElement;
    expect(within(first).getByRole("link", { name: "Weekly clips" })).toHaveAttribute(
      "href",
      "/automations/a1/runs/r1",
    );
    expect(within(first).getByText("With the toolkit")).toBeInTheDocument();
    expect(within(first).getByText("1m 35s")).toBeInTheDocument();
    const second = document.querySelector("[data-job='j2']") as HTMLElement;
    expect(within(second).getByText("Waiting for a free slot")).toBeInTheDocument();
    expect(within(second).getByText("Run by hand")).toBeInTheDocument();
    expect(screen.getByTestId("last-day").textContent).toBe(
      "Last 24 hours: 12 finished, 1 failed, usually 1m 20s each",
    );
    expect(screen.getByRole("link", { name: "Settings, under Runs" })).toHaveAttribute(
      "href",
      "/settings/runs",
    );
  });

  test("reads the toolkit when opened and again every few seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    answerQuery(api.toolkitConnections.list, [
      { _id: "c1", baseUrl: "https://toolkit.example", buildNumber: "219", status: "ok" },
    ]);
    answerQuery(api.toolkitHealth.activity, { ...ACTIVITY, jobs: [] });
    const read = actionOf(api.toolkitHealth.read);
    read.mockResolvedValue({ ok: true, checkedAt: Date.now(), health: HEALTH });
    renderInApp(<ToolkitView />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(read).toHaveBeenCalledWith({ organizationId: "team_1" });
    expect(await screen.findByText("https://toolkit.example · build 220")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is being worked on for your team/)).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(READ_EVERY_MS);
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  test("explains an older toolkit build that cannot report its load", async () => {
    answerQuery(api.toolkitConnections.list, [
      { _id: "c1", baseUrl: "https://toolkit.example", buildNumber: "219", status: "ok" },
    ]);
    answerQuery(api.toolkitHealth.activity, ACTIVITY);
    actionOf(api.toolkitHealth.read).mockResolvedValue({
      ok: false,
      checkedAt: Date.now(),
      reason: "no_health",
      detail: "",
    });
    renderInApp(<ToolkitView />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Update it to the latest build/);
    // The team's own jobs still show.
    expect(screen.getByText("Cover picture")).toBeInTheDocument();
  });

  test("writes sizes and times the way people say them", () => {
    expect(bytes(512)).toBe("512 B");
    expect(bytes(1.5 * GB)).toBe("1.5 GB");
    expect(bytes(16 * GB)).toBe("16 GB");
    expect(uptime(30)).toBe("under a minute");
    expect(uptime(600)).toBe("10 min");
    expect(uptime(3 * 86400)).toBe("3 days");
  });
});
