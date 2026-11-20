import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { useAgentOpen } from "@/lib/agent-open";

import { AgentRail, AgentTrigger, useAgentShortcut } from "./agent-rail";

// The agent is a sidebar on the right: folded to a strip, it opens from its button, from
// anywhere along the strip, or with Cmd/Ctrl+J, which closes it again too.
describe("the agent's sidebar", () => {
  beforeEach(() => localStorage.clear());

  test("folded, its strip has an open button and no button that says Agent", async () => {
    const open = renderHook(() => useAgentOpen());
    render(
      <TooltipProvider>
        <AgentRail />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("button", { name: "Agent" })).toBeNull();
    expect(screen.queryByText("Agent")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Open the agent" }));
    expect(open.result.current).toBe(true);
  });

  test("anywhere along the strip opens it", async () => {
    const open = renderHook(() => useAgentOpen());
    const { container } = render(
      <TooltipProvider>
        <AgentRail />
      </TooltipProvider>,
    );
    await userEvent.click(container.querySelector("[data-agent-rail]")!);
    expect(open.result.current).toBe(true);
  });

  test("the phone's button in the top bar opens it too", async () => {
    const open = renderHook(() => useAgentOpen());
    render(<AgentTrigger />);
    await userEvent.click(screen.getByRole("button", { name: "Open the agent" }));
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
