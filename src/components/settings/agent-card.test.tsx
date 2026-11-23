import { api } from "@convex/_generated/api";
import { AGENT_MODELS, MAX_HOUSE_RULES_CHARS, NO_AGENT_SETTINGS } from "@takewon/automation-core";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { mutationOf, toastError, toastSuccess } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { AgentCard } from "./agent-card";

const models = AGENT_MODELS.map(({ id, name, note }) => ({ id, name, note }));

function show(agent = NO_AGENT_SETTINGS, canEdit = true) {
  return renderInApp(
    <AgentCard
      agent={agent}
      models={models}
      mostHouseRules={MAX_HOUSE_RULES_CHARS}
      canEdit={canEdit}
    />,
  );
}

describe("the agent card", () => {
  test("shows the server's model with nothing set, and nothing to save yet", () => {
    show();
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent("Default");
    expect(screen.getByText("The model your agent server is set up with.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "TikTok" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("saves house rules and default platforms for the team", async () => {
    const user = userEvent.setup();
    show();
    await user.type(screen.getByRole("textbox", { name: "House rules" }), "Never all capitals.");
    await user.click(screen.getByRole("checkbox", { name: "YouTube Shorts" }));
    await user.click(screen.getByRole("checkbox", { name: "TikTok" }));
    expect(screen.getByRole("checkbox", { name: "TikTok" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Platforms keep the order they are listed in, whatever order they were ticked.
    expect(mutationOf(api.teamSettings.setAgent)).toHaveBeenCalledWith({
      organizationId: "team_1",
      agent: {
        model: null,
        houseRules: "Never all capitals.",
        platforms: ["TikTok", "YouTube Shorts"],
      },
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Agent settings saved."));
  });

  test("shows the chosen model's note, and can undo changes", async () => {
    const user = userEvent.setup();
    show({ model: "anthropic/claude-opus-5-5", houseRules: "Be brief.", platforms: ["X"] });
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent("Claude Opus 5.5");
    expect(screen.getByText(/most careful with long automations/)).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "X" }));
    expect(screen.getByRole("checkbox", { name: "X" })).toHaveAttribute("aria-checked", "false");
    await user.click(screen.getByRole("button", { name: "Undo changes" }));
    expect(screen.getByRole("checkbox", { name: "X" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("says why it could not save", async () => {
    const user = userEvent.setup();
    mutationOf(api.teamSettings.setAgent).mockRejectedValueOnce(new Error("offline"));
    show();
    await user.click(screen.getByRole("checkbox", { name: "LinkedIn" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // What they chose is kept, so they can try again.
    expect(screen.getByRole("checkbox", { name: "LinkedIn" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("is read-only for members who are not owners or admins", () => {
    show({ model: null, houseRules: "Be brief.", platforms: ["TikTok"] }, false);
    expect(screen.getByRole("textbox", { name: "House rules" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "TikTok" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByText("Only a team owner or admin can change this.")).toBeInTheDocument();
  });
});
