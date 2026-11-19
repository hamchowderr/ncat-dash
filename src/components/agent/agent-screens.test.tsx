// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { TeamContext } from "@/lib/team-context";

import { useAgentContext } from "./agent-context";
import { approvalView } from "@/components/chat/approval-view";

import { APPROVAL_VIEWS } from "./approval-views";
import { ToolRow } from "./tool-row";

let pathname = "/automations";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

afterEach(() => {
  cleanup();
  document.cookie = "ncat_agent_context=; path=/; max-age=0";
});

describe("a line for something the agent did", () => {
  test("shows plain words while it runs, with no tool name", () => {
    const { container } = render(
      <ToolRow call={{ name: "change_automation", args: { operations: [] } }} result={undefined} />,
    );
    expect(screen.getByText("Changing the automation")).toBeTruthy();
    expect(container.textContent).not.toContain("change_automation");
  });

  test("lists what still stops the automation once it is done", () => {
    render(
      <ToolRow
        call={{ name: "change_automation", args: { operations: [] } }}
        result={{ result: { problems: [{ nodeId: null, message: "Add a logo in Settings." }] } }}
      />,
    );
    expect(screen.getByText("Still needed before it can run:")).toBeTruthy();
    expect(screen.getByText("Add a logo in Settings.")).toBeTruthy();
  });

  test("says what went wrong, in the tool's own words", () => {
    render(
      <ToolRow
        call={{ name: "create_automation", args: { name: "Clips" } }}
        result={{ isError: true, result: "You are not on this team." }}
      />,
    );
    expect(screen.getByText("You are not on this team.")).toBeTruthy();
  });

  test("the agent's own tools show plain words, never their tool id", () => {
    for (const [name, words] of [
      ["task_update", "Updated the plan"],
      ["updateWorkingMemory", "Saved a note"],
      ["browser_goto", "Using the browser"],
      ["a_tool_added_later", "Working on it"],
    ] as const) {
      const { container, unmount } = render(
        <ToolRow call={{ name, args: { a: 1 } }} result={{ result: { ok: true } }} />,
      );
      expect(container.textContent).toBe(words);
      expect(container.textContent).not.toContain(name);
      unmount();
    }
  });
});

describe("the card that asks first", () => {
  test("a tool without its own card is named in plain words, not by its id", () => {
    const view = approvalView(
      { toolCallId: "call_2", toolName: "start_schedule", args: {} } as never,
      APPROVAL_VIEWS,
    );
    expect(view.title).toBe("Allow this? Setting up a schedule");
    expect(String(view.title)).not.toMatch(/start_schedule|Start schedule/);
  });

  test("covers every tool that changes something", () => {
    expect(Object.keys(APPROVAL_VIEWS).sort()).toEqual([
      "change_automation",
      "create_automation",
      "make_folder",
      "move_files",
      "rename_file",
      "save_team_step",
      "switch_automation",
      "try_automation",
      "try_team_step",
    ]);
  });

  test("asks before trying an automation, in plain words", () => {
    const view = APPROVAL_VIEWS.try_automation?.({
      toolCallId: "call_2",
      toolName: "try_automation",
      args: { automationId: "auto_1" },
    } as never);
    expect(view?.title).toBe("Try this automation on a file?");
    const { container } = render(<>{view?.body}</>);
    expect(container.textContent).toMatch(/uses your server/);
    expect(container.textContent).not.toContain("auto_1");
  });

  test("asks in plain words and lists the change", () => {
    const view = APPROVAL_VIEWS.change_automation?.({
      toolCallId: "call_1",
      toolName: "change_automation",
      args: { operations: [{ op: "add", type: "approval", id: "approve_1" }] },
    } as never);
    expect(view?.title).toBe("Make these changes?");
    const { container } = render(<>{view?.body}</>);
    expect(screen.getByText('Add the step "Approval"')).toBeTruthy();
    expect(container.textContent).not.toContain("approve_1");
  });
});

describe("telling the agent what is on screen", () => {
  function Probe() {
    const { onAutomation } = useAgentContext();
    return <p>{onAutomation ? "on an automation" : "elsewhere"}</p>;
  }
  const show = () =>
    render(
      <TeamContext.Provider value={{ id: "team_1", name: "Salt House" }}>
        <Probe />
      </TeamContext.Provider>,
    );
  const sent = () => {
    const raw = document.cookie.split("; ").find((part) => part.startsWith("ncat_agent_context="));
    return raw ? JSON.parse(decodeURIComponent(raw.split("=")[1] ?? "")) : null;
  };

  test("sends the team, and no automation, from the list", () => {
    pathname = "/automations";
    // jsdom only shows a cookie on a page under its path.
    window.history.pushState({}, "", "/api/agent-controller/stream");
    show();
    expect(screen.getByText("elsewhere")).toBeTruthy();
    expect(sent()).toEqual({ organizationId: "team_1", automationId: null });
  });

  test("sends the automation that is open, on its editor and its runs", () => {
    window.history.pushState({}, "", "/api/agent-controller/stream");
    pathname = "/automations/abc123";
    show();
    expect(screen.getByText("on an automation")).toBeTruthy();
    expect(sent()).toEqual({ organizationId: "team_1", automationId: "abc123" });
    cleanup();
    pathname = "/automations/abc123/runs/run9";
    show();
    expect(sent()?.automationId).toBe("abc123");
  });
});
