import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { toastSuccess } from "@/test/convex";

import { AI_APPS, OpenInAiApps } from "./ai-apps";

const PROMPT = "Set up the toolkit & check it: 100% done?";

describe("Open in any AI app", () => {
  test("only agents that can do the setup, each with its logo and one way to get the prompt there", () => {
    expect(AI_APPS.map((app) => app.name)).toEqual([
      "Claude Code",
      "Codex",
      "Cursor",
      "ChatGPT",
      "Claude",
    ]);
    for (const app of AI_APPS) {
      expect(app.logo, app.name).toBeTruthy();
      expect([app.command, app.withPrompt, app.open].filter(Boolean), app.name).toHaveLength(1);
    }
  });

  test("apps that take the prompt in the address get all of it, safely encoded", () => {
    for (const app of AI_APPS.filter((each) => each.withPrompt)) {
      const url = app.withPrompt!(PROMPT);
      expect(url.startsWith("https://"), app.name).toBe(true);
      const values = [...new URL(url).searchParams.values()];
      expect(values, app.name).toContain(PROMPT);
    }
  });

  test("the menu shows both kinds, with links that open in a new tab", async () => {
    const user = userEvent.setup();
    render(<OpenInAiApps prompt={PROMPT} trigger={<button type="button">Open in</button>} />);
    await user.click(screen.getByRole("button", { name: "Open in" }));
    expect(await screen.findByText("Copies the prompt for your terminal")).toBeInTheDocument();
    expect(screen.getByText("Opens with the prompt")).toBeInTheDocument();
    expect(screen.getByText("Copies the prompt, then opens")).toBeInTheDocument();
    const cursor = screen.getByRole("menuitem", { name: "Cursor" });
    expect(cursor.getAttribute("target")).toBe("_blank");
    expect(cursor.querySelector("svg")).not.toBeNull();
    expect(screen.getAllByRole("menuitem")).toHaveLength(5);
  });

  test("an app that can't take the prompt opens, with the prompt copied to paste", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<OpenInAiApps prompt={PROMPT} trigger={<button type="button">Open in</button>} />);
    await user.click(screen.getByRole("button", { name: "Open in" }));
    await user.click(await screen.findByRole("menuitem", { name: "Claude" }));
    expect(open).toHaveBeenCalledWith("https://claude.ai/new", "_blank", "noopener,noreferrer");
    expect(writeText).toHaveBeenCalledWith(PROMPT);
    expect(toastSuccess).toHaveBeenCalledWith("Prompt copied. Paste it into Claude.");
  });

  test("a terminal agent gets the prompt copied, with the command that starts it", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<OpenInAiApps prompt={PROMPT} trigger={<button type="button">Open in</button>} />);
    await user.click(screen.getByRole("button", { name: "Open in" }));
    await user.click(await screen.findByRole("menuitem", { name: "Codex" }));
    expect(open).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(PROMPT);
    expect(toastSuccess).toHaveBeenCalledWith(
      "Prompt copied. Run codex in a terminal and paste it.",
    );
  });
});
