import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery, mutationOf } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { StepTest } from "./step-test";

const AUTOMATION = "a_1" as Id<"automations">;
const NODE = {
  id: "caption",
  kind: "step" as const,
  stepId: "video-caption",
  input: { video_url: "{{steps.trim.url}}" },
};
const CLIP = "https://files.example/out/caption-1.mp4";

function testRun(step: Record<string, unknown>) {
  return {
    _id: "run_9",
    testOf: "Caption video",
    startedWith: "short-teaser.mp4",
    steps: [
      {
        _id: "s1",
        nodeId: "caption",
        status: "done",
        outputs: [],
        facts: [],
        retries: 0,
        retryAt: null,
        startedAt: 1000,
        finishedAt: 5000,
        jobs: [],
        ...step,
      },
    ],
  };
}

function show(runId?: string, onStarted = vi.fn()) {
  return renderInApp(
    <StepTest
      automationId={AUTOMATION}
      node={NODE}
      runId={runId as Id<"runs"> | undefined}
      onStarted={onStarted}
    />,
  );
}

describe("testing one step from its panel", () => {
  test("picking an uploaded file tests the step as it is in the editor", async () => {
    answerQuery(api.storage.get, { bucket: "media" });
    answerQuery(api.storage.listUploads, [
      { _id: "u1", fileName: "short-teaser.mp4", size: 1000, status: "ready" },
    ]);
    actionOf(api.storage.linkFor).mockResolvedValue("https://files.example/short-teaser.mp4");
    mutationOf(api.automations.testStep).mockResolvedValue("run_9");
    const onStarted = vi.fn();
    show(undefined, onStarted);

    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    const dialog = screen.getByRole("dialog", { name: "Test this step on one file" });
    expect(within(dialog).queryByRole("button", { name: /Run without a file/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: /short-teaser\.mp4/ }));

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("run_9"));
    expect(mutationOf(api.automations.testStep)).toHaveBeenCalledWith({
      automationId: AUTOMATION,
      node: { ...NODE, position: { x: 0, y: 0 } },
      fileUrl: "https://files.example/short-teaser.mp4",
    });
  });

  test("while it works, it says so and cannot be started twice", () => {
    answerQuery(api.runs.get, testRun({ status: "running", finishedAt: null }));
    show("run_9");
    expect(screen.getByText("Working on it. This updates by itself.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Test again" }).hasAttribute("disabled")).toBe(true);
  });

  test("when done, it shows what the step made and found out", () => {
    answerQuery(
      api.runs.get,
      testRun({ outputs: [CLIP], facts: [{ label: "Duration", value: "8" }] }),
    );
    show("run_9");
    expect(screen.getByRole("region", { name: "Test this step" }).textContent).toContain(
      "On short-teaser.mp4, took 4s",
    );
    expect(screen.getByText("Duration")).toBeTruthy();
    const files = screen.getByRole("list", { name: "Files from the test" });
    expect(within(files).getByText("caption-1.mp4")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open the test run/ }).getAttribute("href")).toBe(
      "/automations/a_1/runs/run_9",
    );
  });

  test("when it fails, it shows why", () => {
    answerQuery(api.runs.get, testRun({ status: "failed", error: "Connect a toolkit first." }));
    show("run_9");
    expect(screen.getByText("Connect a toolkit first.")).toBeTruthy();
  });
});
