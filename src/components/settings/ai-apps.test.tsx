import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { toastSuccess } from "@/test/convex";

import { AI_APPS, OpenInAiApps } from "./ai-apps";

const PROMPT = "Set up the toolkit & check it: 100% done?";

describe("Open in any AI app", () => {
  test("every app has its own name, logo and a way to get the prompt there", () => {
    expect(AI_APPS.map((app) => app.name)).toEqual([
      "Cursor",
      "ChatGPT",
      "GitHub Copilot",
      "Grok",
      "Perplexity",
      "Google AI Studio",
      "Kagi Assistant",
      "Duck.ai",
      "v0",
      "Scira",
      "Claude",
      "Gemini",
      "Mistral Le Chat",
      "DeepSeek",
      "HuggingChat",
      "Phind",
    ]);
    for (const app of AI_APPS) {
      expect(app.logo, app.name).toBeTruthy();
      expect(Boolean(app.withPrompt) !== Boolean(app.open), app.name).toBe(true);
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
    expect(await screen.findByText("Opens with the prompt")).toBeInTheDocument();
    expect(screen.getByText("Copies the prompt, then opens")).toBeInTheDocument();
    const grok = screen.getByRole("menuitem", { name: "Grok" });
    expect(grok.getAttribute("target")).toBe("_blank");
    expect(grok.querySelector("svg")).not.toBeNull();
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
});
