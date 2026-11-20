import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { useAgentOpen } from "@/lib/agent-open";

import { AgentTrigger, useAgentShortcut } from "./agent-rail";

// The agent is a sidebar on the right: it opens from the robot in the bar along the top,
// or with Cmd/Ctrl+J, which closes it again too.
describe("the agent's sidebar", () => {
  beforeEach(() => localStorage.clear());

  test("its robot in the bar along the top opens it, with no button that says Agent", async () => {
    const open = renderHook(() => useAgentOpen());
    render(
      <TooltipProvider>
        <AgentTrigger />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("button", { name: "Agent" })).toBeNull();
    expect(screen.queryByText("Agent")).toBeNull();
    const button = screen.getByRole("button", { name: "Open the agent" });
    expect(button).toHaveAttribute("aria-keyshortcuts", "Meta+J Control+J");
    await userEvent.click(button);
    expect(open.result.current).toBe(true);
  });

  test("Cmd+J or Ctrl+J opens and closes it", () => {
    const open = renderHook(() => {
      const isOpen = useAgentOpen();
      useAgentShortcut(isOpen);
      return isOpen;
    });
    expect(open.result.current).toBe(false);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", metaKey: true }));
    });
    expect(open.result.current).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", ctrlKey: true }));
    });
    expect(open.result.current).toBe(false);
    // J on its own is typing, not the shortcut.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    });
    expect(open.result.current).toBe(false);
  });
});
