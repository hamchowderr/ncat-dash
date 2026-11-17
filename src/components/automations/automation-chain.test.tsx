import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { answerQuery } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { NodePanel } from "./node-panel";
import { RunSteps, type RunDetails } from "./run-steps";
import { RunView } from "./run-view";
import { TriggerPanel } from "./trigger-panel";

const TEAM_AUTOMATIONS = [
  { _id: "auto_clips", name: "Clips" },
  { _id: "auto_captions", name: "Captions" },
  { _id: "auto_thumbs", name: "Thumbnails" },
];

function stepPanel(input: Record<string, unknown>, onChange = vi.fn()) {
  answerQuery(api.automations.list, TEAM_AUTOMATIONS);
  renderInApp(
    <NodePanel
      automationId="auto_clips"
      node={{ id: "run", kind: "automation", input }}
      before={[]}
      startGivesFile
      filled={{}}
      brand={{}}
      music={[]}
      onChange={onChange}
      onRemove={vi.fn()}
    />,
  );
  return onChange;
}

describe("the Run an automation step's settings", () => {
  test("picks another automation by name, never this one", async () => {
    const onChange = stepPanel({ wait: true });
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Automation to run" }));
    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual(["Captions", "Thumbnails"]);
    await user.click(screen.getByRole("option", { name: "Captions" }));
    expect(onChange).toHaveBeenCalledWith({ input: { wait: true, automation: "auto_captions" } });
  });

  test("shows the one picked, and waits for it unless told not to", () => {
    const onChange = stepPanel({ automation: "auto_thumbs" });
    expect(screen.getByRole("combobox", { name: "Automation to run" })).toHaveTextContent(
      "Thumbnails",
    );
    const wait = screen.getByRole("switch", { name: "Wait for it to finish" });
    expect(wait).toBeChecked();
    expect(screen.getByText(/the files it made carry on from here/)).toBeInTheDocument();
    fireEvent.click(wait);
    expect(onChange).toHaveBeenCalledWith({
      input: { automation: "auto_thumbs", wait: false },
    });
  });

  test("says when the automation it ran was deleted", () => {
    stepPanel({ automation: "auto_gone" });
    expect(screen.getByRole("combobox", { name: "Automation to run" })).toHaveTextContent(
      "That automation was deleted. Pick another",
    );
  });

  test("points to making another automation when there is none", () => {
    answerQuery(api.automations.list, [{ _id: "auto_clips", name: "Clips" }]);
    renderInApp(
      <NodePanel
        automationId="auto_clips"
        node={{ id: "run", kind: "automation", input: {} }}
        before={[]}
        startGivesFile
        filled={{}}
        brand={{}}
        music={[]}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText(/no other automations yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Make one" })).toHaveAttribute(
      "href",
      "/automations/new",
    );
  });
});

describe("the When another automation finishes trigger", () => {
  function trigger(onChange = vi.fn()) {
    answerQuery(api.automations.list, TEAM_AUTOMATIONS);
    renderInApp(
      <TriggerPanel
        trigger={{ kind: "finished", automationId: "auto_captions", when: "done" }}
        onChange={onChange}
        automationId="auto_clips"
        hookToken="token"
      />,
    );
    return onChange;
  }

  test("is picked from what starts it, and starts blank", async () => {
    const onChange = vi.fn();
    answerQuery(api.automations.list, TEAM_AUTOMATIONS);
    renderInApp(
      <TriggerPanel
        trigger={{ kind: "manual" }}
        onChange={onChange}
        automationId="auto_clips"
        hookToken="token"
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "What starts it" }));
    await user.click(await screen.findByRole("option", { name: "Another automation finishes" }));
    expect(onChange).toHaveBeenCalledWith({ kind: "finished", automationId: "", when: "done" });
  });

  test("names the automation it follows and when it starts", async () => {
    const onChange = trigger();
    expect(screen.getByRole("combobox", { name: "Which automation" })).toHaveTextContent(
      "Captions",
    );
    expect(screen.getByText(/files that run finished with/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Start after it" }));
    await user.click(await screen.findByRole("option", { name: "Fails" }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "finished",
      automationId: "auto_captions",
      when: "failed",
    });
  });
});

/** A run of Clips whose Run an automation step ran Captions, in the shape runs.get returns. */
function clipsRun(over: Record<string, unknown> = {}) {
  return {
    _id: "run_1",
    automationId: "auto_clips",
    automationName: "Clips",
    status: "running",
    triggerKind: "manual",
    startedAt: 1000,
    finishedAt: null,
    retries: 0,
    hasCuts: false,
    trigger: {},
    retryLimit: 2,
    startedByRun: null,
    startedRuns: [
      {
        runId: "run_2",
        automationId: "auto_captions",
        automationName: "Captions",
        status: "running",
        how: "step",
      },
    ],
    nodes: [
      {
        id: "run",
        kind: "automation",
        input: { automation: "auto_captions", wait: true },
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
    steps: [
      {
        _id: "s1",
        nodeId: "run",
        status: "running",
        outputs: [],
        startedAt: 1000,
        finishedAt: null,
        childRunId: "run_2",
        jobs: [],
        retries: 0,
        retryAt: null,
        retryError: null,
        facts: [],
        error: null,
      },
    ],
    ...over,
  };
}

describe("a run that started another run", () => {
  test("the step's line says it is waiting and links to the other run", () => {
    renderInApp(
      <RunSteps
        run={clipsRun() as unknown as RunDetails}
        highlighted={null}
        busy={false}
        onDecide={vi.fn()}
      />,
    );
    const row = screen.getByRole("heading", { name: "Run an automation" }).closest("li")!;
    expect(row.textContent).toContain("Waiting for its run to finish.");
    expect(screen.getByRole("link", { name: /Run of Captions/ })).toHaveAttribute(
      "href",
      "/automations/auto_captions/runs/run_2",
    );
  });

  test("once it finished, the step shows the files that came back", () => {
    const run = clipsRun({ status: "done" });
    const step = (run.steps as Record<string, unknown>[])[0];
    Object.assign(step, { status: "done", outputs: ["https://files.example/out/captioned.mp4"] });
    (run.startedRuns as Record<string, unknown>[])[0].status = "done";
    renderInApp(
      <RunSteps
        run={run as unknown as RunDetails}
        highlighted={null}
        busy={false}
        onDecide={vi.fn()}
      />,
    );
    const row = screen.getByRole("heading", { name: "Run an automation" }).closest("li")!;
    expect(row.textContent).toContain("Its run finished, and its files carried on from here.");
    expect(screen.getByRole("list", { name: "Files from Run an automation" })).toBeInTheDocument();
  });

  test("the run page links to the run that started it and to the ones that followed", () => {
    answerQuery(
      api.runs.get,
      clipsRun({
        status: "done",
        triggerKind: "finished",
        startedByRun: {
          runId: "run_0",
          automationId: "auto_thumbs",
          automationName: "Thumbnails",
          status: "done",
          how: "followed",
        },
        startedRuns: [
          {
            runId: "run_3",
            automationId: "auto_captions",
            automationName: "Captions",
            status: "running",
            how: "followed",
          },
        ],
        nodes: [
          { id: "trim", kind: "step", stepId: "video-trim", input: {}, position: { x: 0, y: 0 } },
        ],
        steps: [],
      }),
    );
    answerQuery(api.reviews.forStep, null);
    renderInApp(
      <RunView automationId={"auto_clips" as Id<"automations">} runId={"run_1" as Id<"runs">} />,
    );
    const links = screen.getByRole("navigation", { name: "Linked runs" });
    expect(links.textContent).toContain("Started by a run of Thumbnails");
    expect(screen.getByRole("link", { name: /Started by a run of Thumbnails/ })).toHaveAttribute(
      "href",
      "/automations/auto_thumbs/runs/run_0",
    );
    expect(screen.getByRole("link", { name: /Then started Captions/ })).toHaveAttribute(
      "href",
      "/automations/auto_captions/runs/run_3",
    );
    expect(screen.getByText(/Another automation finishes run/)).toBeInTheDocument();
  });
});
