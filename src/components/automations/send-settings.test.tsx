import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { renderInApp } from "@/test/render";

import { nodeLook } from "./flow-nodes";
import { NodePanel } from "./node-panel";

type PanelNode = Parameters<typeof NodePanel>[0]["node"];

function panel(node: PanelNode) {
  const onChange = vi.fn();
  renderInApp(
    <NodePanel
      node={node}
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

describe("the Send to a URL step", () => {
  test("asks for an address and says what it sends", async () => {
    const user = userEvent.setup();
    const onChange = panel({ id: "send_1", kind: "send", input: {} });
    expect(screen.getAllByText("Send to a URL").length).toBeGreaterThan(0);
    expect(screen.getByText(/posted here as JSON/)).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Address" }), "h");
    expect(onChange).toHaveBeenLastCalledWith({ input: { url: "h" } });
  });

  test("says when the address is not one it can post to", () => {
    panel({ id: "send_1", kind: "send", input: { url: "ftp://files.example" } });
    expect(screen.getByText("The address must start with http:// or https://.")).toBeVisible();
  });

  test("its box on the canvas names where it sends", () => {
    expect(
      nodeLook({ kind: "send", input: { url: "https://n8n.example.com/webhook/clips" } }).kind,
    ).toBe("To n8n.example.com");
    expect(nodeLook({ kind: "send", input: {} }).kind).toBe("Needs an address");
  });
});
