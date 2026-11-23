import { api } from "@convex/_generated/api";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery, toastError, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { SETTINGS_PAGES, settingsLocation } from "./settings-pages";
import { ToolkitCard } from "./toolkit-card";

const base = {
  _id: "c1",
  apiKeyHint: "",
  status: "ok",
  buildNumber: "219",
  bucket: "takewon",
  lastCheckedAt: 1,
  lastError: null,
};
const ours = { ...base, ours: true, baseUrl: "https://media.example" };
const own = {
  ...base,
  ours: false,
  baseUrl: "https://toolkit.studio.example",
  apiKeyHint: "9f2a",
  bucket: "studio-media",
};

beforeEach(() => {
  answerQuery(api.toolkitConnections.list, [ours]);
  answerQuery(api.toolkitConnections.offersOurs, true);
  answerQuery(api.teamSettings.get, { brand: null, music: null, canEdit: true });
});

describe("Settings, Toolkit", () => {
  test("is a settings page with a Title Case name", () => {
    expect(SETTINGS_PAGES.find((page) => page.slug === "toolkit")?.title).toBe("Toolkit");
    expect(settingsLocation("/settings/toolkit")?.menu).toBe("toolkit");
  });

  test("on ours, there is nothing to set up and no address or key is shown", () => {
    renderInApp(<ToolkitCard />);
    expect(screen.getByText("Ours, run for you")).toBeInTheDocument();
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.queryByText(/media\.example/)).toBeNull();
    expect(screen.queryByLabelText("Toolkit address")).toBeNull();
  });

  test("Use your own toolkit opens the steps, with the fork, then tests and switches", async () => {
    const connect = actionOf(api.toolkitConnections.connect);
    connect.mockResolvedValue({ ok: true, buildNumber: "220" });
    const user = userEvent.setup();
    renderInApp(<ToolkitCard />);
    await user.click(screen.getByRole("button", { name: "Use your own toolkit" }));
    const section = screen.getByTestId("own-toolkit");
    expect(
      within(section)
        .getByRole("link", { name: /github\.com\/hamchowderr\/no-code-architects-toolkit/ })
        .getAttribute("href"),
    ).toBe("https://github.com/hamchowderr/no-code-architects-toolkit");
    expect(within(section).getByText(/Give it storage/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Toolkit address"), "https://toolkit.studio.example");
    await user.type(screen.getByLabelText("API key"), "secret");
    await user.click(screen.getByRole("button", { name: "Test and connect" }));
    expect(connect).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      baseUrl: "https://toolkit.studio.example",
      apiKey: "secret",
    });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("You're on your own toolkit now."),
    );
    expect(screen.queryByLabelText("Toolkit address")).toBeNull();
  });

  test("hands over a prompt for any AI agent, with this dashboard's address, and our setup", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    renderInApp(<ToolkitCard />);
    await user.click(screen.getByRole("button", { name: "Use your own toolkit" }));
    const prompt = screen.getByTestId("agent-prompt");
    await user.click(within(prompt).getByRole("button", { name: "Copy prompt" }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0]![0];
    expect(copied).toContain(`Takewon dashboard at ${window.location.origin}`);
    expect(copied).toContain(`CORS on that bucket for ${window.location.origin}`);
    // The prompt can be read before it is copied.
    expect(within(prompt).getByText("Prompt for your AI agent")).toBeInTheDocument();
    expect(
      within(prompt).getByText(/Ask me before you delete or stop anything/),
    ).toBeInTheDocument();
    // Or opened straight in an AI app, each with its own logo, carrying the prompt.
    await user.click(within(prompt).getByRole("button", { name: /Open in/ }));
    const claude = await screen.findByRole("menuitem", { name: /Open in Claude/ });
    expect(new URL(claude.closest("a")!.href).searchParams.get("q")).toBe(copied);
    expect(screen.getByRole("menuitem", { name: /Open in Cursor/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Open in ChatGPT/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    // And the setup ours runs on, named.
    const section = screen.getByTestId("own-toolkit");
    expect(within(section).getByText("Recommended setup")).toBeInTheDocument();
    expect(within(section).getByText("Cloudflare R2 for files")).toBeInTheDocument();
    expect(within(section).getByText("Or do it yourself")).toBeInTheDocument();
  });

  test("says to copy the prompt by hand when the browser refuses", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    renderInApp(<ToolkitCard />);
    await user.click(screen.getByRole("button", { name: "Use your own toolkit" }));
    await user.click(screen.getByRole("button", { name: "Copy prompt" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Copy the prompt by hand: the browser did not allow it.",
      ),
    );
  });

  test("can be closed again without changing anything", async () => {
    const user = userEvent.setup();
    renderInApp(<ToolkitCard />);
    await user.click(screen.getByRole("button", { name: "Use your own toolkit" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Toolkit address")).toBeNull();
  });

  test("says why it can't switch while jobs are still running", async () => {
    actionOf(api.toolkitConnections.connect).mockResolvedValue({
      ok: false,
      reason: "busy",
      detail: "2 jobs are still out on your current toolkit. Switch once they finish.",
    });
    const user = userEvent.setup();
    renderInApp(<ToolkitCard />);
    await user.click(screen.getByRole("button", { name: "Use your own toolkit" }));
    await user.type(screen.getByLabelText("Toolkit address"), "https://toolkit.studio.example");
    await user.type(screen.getByLabelText("API key"), "secret");
    await user.click(screen.getByRole("button", { name: "Test and connect" }));
    expect(await screen.findByText("Jobs are still running")).toBeInTheDocument();
    expect(screen.getByText(/2 jobs are still out/)).toBeInTheDocument();
  });

  test("on its own toolkit, shows it, checks it, and can go back to ours", async () => {
    answerQuery(api.toolkitConnections.list, [own]);
    const recheck = actionOf(api.toolkitConnections.recheck);
    recheck.mockResolvedValue({ ok: true, buildNumber: "220" });
    const useOurs = actionOf(api.toolkitConnections.connectOurs);
    useOurs.mockResolvedValue({ ok: true, buildNumber: "219" });
    const user = userEvent.setup();
    renderInApp(<ToolkitCard />);
    expect(screen.getByText("Your own toolkit")).toBeInTheDocument();
    expect(screen.getByText("https://toolkit.studio.example")).toBeInTheDocument();
    expect(screen.getByText(/key ending 9f2a/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Use A Different Toolkit" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(recheck).toHaveBeenCalledWith({ connectionId: "c1" });
    await user.click(screen.getByRole("button", { name: "Use ours" }));
    expect(useOurs).toHaveBeenCalledWith({ organizationId: TEAM.id });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("You're on our toolkit."));
  });

  test("going back to ours says so when it does not answer", async () => {
    answerQuery(api.toolkitConnections.list, [own]);
    actionOf(api.toolkitConnections.connectOurs).mockResolvedValue({
      ok: false,
      reason: "unreachable",
      detail: "",
    });
    const user = userEvent.setup();
    renderInApp(<ToolkitCard />);
    await user.click(screen.getByRole("button", { name: "Use ours" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/did not answer/)),
    );
  });

  test("on a copy that lends none, the steps and form are open from the start", () => {
    answerQuery(api.toolkitConnections.list, []);
    answerQuery(api.toolkitConnections.offersOurs, false);
    renderInApp(<ToolkitCard />);
    expect(screen.getByText("No toolkit yet")).toBeInTheDocument();
    expect(screen.getByLabelText("Toolkit address")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  test("people who can't change settings see what is in use, nothing more", () => {
    answerQuery(api.teamSettings.get, { brand: null, music: null, canEdit: false });
    renderInApp(<ToolkitCard />);
    expect(screen.getByText("Ours, run for you")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use your own toolkit" })).toBeNull();
  });
});
