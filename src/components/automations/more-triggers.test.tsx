import { api } from "@convex/_generated/api";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { answerQuery } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { triggerEdges, triggerPositions } from "./flow-nodes";
import { RunDialog } from "./run-dialog";
import { newTriggerKind, TriggerPanel } from "./trigger-panel";

describe("a trigger's panel when the automation has several", () => {
  test("lists what it starts, and can stop starting one, add a step after it or go", () => {
    const onStopStarting = vi.fn();
    const onAddStep = vi.fn();
    const onRemove = vi.fn();
    renderInApp(
      <TriggerPanel
        trigger={{ kind: "schedule", schedule: { mode: "interval", minutes: 60 } }}
        onChange={vi.fn()}
        automationId="a"
        hookToken="t"
        starts={[{ id: "trim", title: "Trim video" }]}
        onStopStarting={onStopStarting}
        onAddStep={onAddStep}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText("What it starts")).toBeTruthy();
    expect(screen.getByText("Trim video")).toBeTruthy();
    expect(
      screen.getByText("Each trigger runs only the steps it starts and what comes after them."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop starting Trim video" }));
    expect(onStopStarting).toHaveBeenCalledWith("trim");
    fireEvent.click(screen.getByRole("button", { name: "Add a step after it" }));
    expect(onAddStep).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove trigger" }));
    expect(onRemove).toHaveBeenCalled();
  });

  test("says how to connect a trigger that starts nothing yet", () => {
    renderInApp(
      <TriggerPanel
        trigger={{ kind: "webhook" }}
        onChange={vi.fn()}
        automationId="a"
        hookToken="t"
        starts={[]}
      />,
    );
    expect(
      screen.getByText("Nothing yet. Add a step after it, or drag from its dot to a first step."),
    ).toBeTruthy();
  });

  test("shows none of that with one trigger", () => {
    renderInApp(
      <TriggerPanel
        trigger={{ kind: "webhook" }}
        onChange={vi.fn()}
        automationId="a"
        hookToken="t"
      />,
    );
    expect(screen.queryByText("What it starts")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove trigger" })).toBeNull();
  });

  test("does not offer a second webhook or Run now", () => {
    renderInApp(
      <TriggerPanel
        trigger={{ kind: "upload", fileType: "video" }}
        onChange={vi.fn()}
        automationId="a"
        hookToken="t"
        taken={["webhook", "manual"]}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "What starts it" }));
    expect(screen.queryByRole("option", { name: /Webhook/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /Run now|By hand/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Schedule/ })).toBeTruthy();
  });
});

describe("a new trigger", () => {
  test("starts as the first usual kind the automation does not have yet", () => {
    expect(newTriggerKind([{ trigger: { kind: "manual" } }])).toEqual({
      kind: "upload",
      fileType: "video",
    });
    expect(
      newTriggerKind([
        { trigger: { kind: "upload", fileType: "video" } },
        { trigger: { kind: "folder", prefix: "", fileType: "any" } },
      ]).kind,
    ).toBe("schedule");
  });
});

describe("several triggers on the canvas", () => {
  const steps = [
    { id: "caption", position: { x: 0, y: 0 } },
    { id: "trim", position: { x: 0, y: 150 } },
  ];
  const starts = new Map([
    ["__trigger", ["caption"]],
    ["__trigger_2", ["trim"]],
    ["__trigger_3", []],
  ]);

  test("draws a line from each trigger to each step it starts, that can be deleted", () => {
    const lines = triggerEdges(["caption", "trim"], [], starts);
    expect(lines.map((line) => line.id)).toEqual(["__trigger>caption", "__trigger_2>trim"]);
    expect(lines.every((line) => line.deletable !== false)).toBe(true);
    // One trigger: a fixed line to every step nothing feeds, as before.
    const one = triggerEdges(["caption", "trim"], []);
    expect(one.map((line) => line.source)).toEqual(["__trigger", "__trigger"]);
    expect(one[0].deletable).toBe(false);
  });

  test("puts each trigger beside its steps, and one that starts nothing below", () => {
    const places = triggerPositions(["__trigger", "__trigger_2", "__trigger_3"], steps, starts);
    expect(places.get("__trigger")).toEqual({ x: -220, y: 0 });
    expect(places.get("__trigger_2")).toEqual({ x: -220, y: 150 });
    expect(places.get("__trigger_3")!.y).toBeGreaterThan(150);
  });
});

describe("Run now with several triggers", () => {
  test("asks whose steps to run", () => {
    answerQuery(api.storage.get, null);
    answerQuery(api.storage.listUploads, []);
    const onTriggerChange = vi.fn();
    renderInApp(
      <RunDialog
        open
        onOpenChange={vi.fn()}
        startsOnUpload={false}
        start={vi.fn()}
        onUploadedOnly={vi.fn()}
        triggers={[
          { id: "__trigger", label: "Trigger 1: Upload" },
          { id: "__trigger_2", label: "Trigger 2: Webhook" },
        ]}
        triggerId="__trigger"
        onTriggerChange={onTriggerChange}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Run the steps of" }));
    fireEvent.click(screen.getByRole("option", { name: "Trigger 2: Webhook" }));
    expect(onTriggerChange).toHaveBeenCalledWith("__trigger_2");
  });
});
