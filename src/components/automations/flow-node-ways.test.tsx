import { type NodeProps, ReactFlowProvider } from "@xyflow/react";
import { describe, expect, test } from "vitest";

import { renderInApp } from "@/test/render";

import { nodeTypes, type StepFlowNode } from "./flow-nodes";

function showStep(failWay?: "used" | "offered") {
  const Step = nodeTypes.step;
  const props = {
    id: "trim",
    type: "step",
    data: { node: { id: "trim", kind: "step", stepId: "video-trim", input: {} }, failWay },
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
    <ReactFlowProvider>
      <Step {...props} />
    </ReactFlowProvider>,
  );
  return [...container.querySelectorAll(".react-flow__handle.source")];
}

describe("a step's ways out on the canvas", () => {
  // A line that names no way joins the first way out, so the usual one must come first,
  // or a plain line would be drawn from the low, red failure way.
  test.each([undefined, "offered", "used"] as const)(
    "the usual way out comes before the failure way (%s)",
    (failWay) => {
      const ways = showStep(failWay);
      expect(ways).toHaveLength(2);
      expect(ways[0].getAttribute("data-handleid")).toBeNull();
      expect(ways[1].getAttribute("data-handleid")).toBe("failed");
    },
  );
});
