import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { answerQuery } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { LiveRunBadge, useLiveRun } from "./live-run";

const AUTOMATION = "a_1" as Id<"automations">;
const NOW = 1_700_000_000_000;

function latest(over: Record<string, unknown> = {}) {
  return {
    _id: "run_7",
    automationId: AUTOMATION,
    automationName: "Sort uploads by length",
    status: "running",
    triggerKind: "upload",
    startedAt: NOW - 30_000,
    finishedAt: undefined,
    retries: 0,
    steps: [
      {
        nodeId: "if",
        status: "done",
        jobCount: 0,
        branches: { yes: [], no: ["f"] },
        retryAt: null,
      },
      { nodeId: "caption", status: "running", jobCount: 1, retryAt: null },
      { nodeId: "wait", status: "pending", jobCount: 0, retryAt: null },
    ],
    ...over,
  };
}

function badge(run: ReturnType<typeof latest> | null, active: boolean) {
  return renderInApp(
    <LiveRunBadge automationId={AUTOMATION} latest={run as never} active={active} />,
  );
}

afterEach(() => vi.useRealTimers());

describe("the live run on the editor's canvas", () => {
  test("while a run goes, each step it reached carries its state", () => {
    answerQuery(api.runs.latestForAutomation, latest());
    const { result } = renderHook(() => useLiveRun(AUTOMATION));
    expect(result.current.active).toBe(true);
    expect(result.current.steps.get("caption")).toMatchObject({ status: "running", jobCount: 1 });
    expect(result.current.steps.get("if")?.note).toBe("Went No");
  });

  test("a step waiting to try again shows as trying again", () => {
    answerQuery(
      api.runs.latestForAutomation,
      latest({ steps: [{ nodeId: "caption", status: "running", jobCount: 1, retryAt: NOW }] }),
    );
    const { result } = renderHook(() => useLiveRun(AUTOMATION));
    expect(result.current.steps.get("caption")?.status).toBe("retrying");
  });

  test("once the run has finished, the canvas goes back to plain steps", () => {
    answerQuery(api.runs.latestForAutomation, latest({ status: "done", finishedAt: NOW }));
    const { result } = renderHook(() => useLiveRun(AUTOMATION));
    expect(result.current.active).toBe(false);
    expect(result.current.steps.size).toBe(0);
  });

  test("the badge says the run is going, how far it has got, and opens it", () => {
    badge(latest(), true);
    const link = screen.getByRole("status");
    expect(link.textContent).toContain("Running now");
    expect(link.textContent).toContain("1 of 3 steps");
    expect(link.getAttribute("href")).toBe("/automations/a_1/runs/run_7");
  });

  test("a run held at an approval says so", () => {
    badge(latest({ status: "waiting" }), true);
    expect(screen.getByRole("status").textContent).toContain("Waiting for approval");
  });

  test("a run that just ended is pointed to for a while, an old one is not", () => {
    vi.useFakeTimers({ now: NOW + 30_000 });
    const { unmount } = badge(latest({ status: "failed", finishedAt: NOW }), false);
    expect(screen.getByRole("status").textContent).toContain("Last run failed");
    unmount();
    badge(latest({ status: "done", finishedAt: NOW - 10 * 60_000 }), false);
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("an automation that has never run shows nothing", () => {
    badge(null, false);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
