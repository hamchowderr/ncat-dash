import { type NodeProps, ReactFlowProvider } from "@xyflow/react";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Brand } from "@ncat-dash/automation-core";
import { renderInApp } from "@/test/render";

import { BrandContext, nodeTypes, type StepFlowNode } from "./flow-nodes";
import { NodePanel } from "./node-panel";
import { TemplateGallery } from "./template-gallery";

function panel(input: Record<string, unknown> = {}, brand: Brand = {}) {
  return renderInApp(
    <NodePanel
      node={{ id: "beat_1", kind: "step", stepId: "recipe-beat-cut", input }}
      before={[]}
      startGivesFile
      filled={{}}
      brand={brand}
      music={[]}
      onChange={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
}

describe("the Cut To The Beat step", () => {
  test("asks how often to cut, how long and what shape up front", () => {
    panel();
    for (const name of ["Change the picture", "Length", "Shape"]) {
      expect(screen.getAllByText(name, { exact: true }).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Default (every 2 beats)")).toBeTruthy();
    // Where to start in the song is rarer, so it waits under More options.
    expect(screen.queryByText("Start at", { exact: true })).toBeNull();
    expect(screen.getByRole("button", { name: "More options" })).toBeTruthy();
  });

  test("takes every video that reaches it, and says so", () => {
    panel();
    expect(screen.getByText("every video that reaches this step")).toBeTruthy();
    expect(screen.queryByText(/Video urls/)).toBeNull();
  });

  test("says it needs the team's music until it is set, then that it is handled", () => {
    panel();
    expect(
      screen.getByText(/uses your team's background music, which is not set yet/),
    ).toBeTruthy();
    const { container } = panel({}, { music: "upload:song" });
    expect(container.textContent).toContain("Music: your team's background music (Settings)");
    expect(container.textContent).not.toContain("which is not set yet");
  });

  test("says the beat is found without AI", () => {
    panel();
    expect(screen.getByText(/plain sound analysis, no AI/)).toBeTruthy();
  });
});

describe("Cut To The Beat on the canvas", () => {
  test("shows its own title", () => {
    const Step = nodeTypes.step;
    const props = {
      id: "beat_1",
      type: "step",
      data: { node: { id: "beat_1", kind: "step", stepId: "recipe-beat-cut", input: {} } },
      selected: false,
      dragging: false,
      draggable: true,
      selectable: true,
      deletable: true,
      isConnectable: true,
      zIndex: 0,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
    } as unknown as NodeProps<StepFlowNode>;
    const { container } = renderInApp(
      <BrandContext.Provider value={{ music: "upload:song" }}>
        <ReactFlowProvider>
          <Step {...props} />
        </ReactFlowProvider>
      </BrandContext.Provider>,
    );
    expect(screen.getByText("Cut To The Beat")).toBeTruthy();
    expect(container.querySelector("svg.lucide-drum")).toBeTruthy();
  });
});

describe("Cut To The Beat among the ready-mades", () => {
  test("is under Music and starts by hand, to pick the clips", () => {
    const onPick = vi.fn();
    renderInApp(<TemplateGallery onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /^Music \d+$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Cut To The Beat/ }));
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "recipe-beat-cut", trigger: { kind: "manual" } }),
    );
  });

  test("is found by searching for beat", () => {
    renderInApp(<TemplateGallery onPick={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Find a ready-made automation"), {
      target: { value: "beat" },
    });
    expect(screen.getAllByText("Cut To The Beat", { exact: true }).length).toBeGreaterThan(0);
  });
});
