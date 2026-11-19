import { api } from "@convex/_generated/api";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { actionOf, mutationOf, toastError, toastSuccess } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { AnthropicKeyCard } from "./anthropic-key-card";

const KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz-WXYZ";
const SAVED = { hint: "WXYZ", setAt: Date.UTC(2026, 10, 19, 12) };

describe("the team's own Anthropic key", () => {
  test("an owner adds a key, and it is cleared from the field once saved", async () => {
    const user = userEvent.setup();
    renderInApp(<AnthropicKeyCard anthropicKey={null} canEdit />);
    const field = screen.getByLabelText("API key");
    expect(field).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Anthropic Console" })).toHaveAttribute(
      "href",
      "https://console.anthropic.com/settings/keys",
    );

    await user.type(field, KEY);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(actionOf(api.anthropicKey.set)).toHaveBeenCalledWith({
      organizationId: "team_1",
      key: KEY,
    });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "Your Anthropic key is saved. The agent now runs on it.",
      ),
    );
    expect(field).toHaveValue("");
  });

  test("says why a key was not taken, and keeps what was typed", async () => {
    const user = userEvent.setup();
    actionOf(api.anthropicKey.set).mockRejectedValueOnce(new Error("refused"));
    renderInApp(<AnthropicKeyCard anthropicKey={null} canEdit />);
    await user.type(screen.getByLabelText("API key"), KEY);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByLabelText("API key")).toHaveValue(KEY);
  });

  test("a saved key shows only its end, and can be replaced or removed", async () => {
    const user = userEvent.setup();
    renderInApp(<AnthropicKeyCard anthropicKey={SAVED} canEdit />);
    expect(screen.getByText("Key ending WXYZ")).toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Replace" }));
    expect(screen.getByLabelText("API key")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(mutationOf(api.anthropicKey.remove)).toHaveBeenCalledWith({ organizationId: "team_1" });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Your Anthropic key is removed."),
    );
  });

  test("members who are not owners or admins only see whether there is one", () => {
    const { unmount } = renderInApp(<AnthropicKeyCard anthropicKey={null} canEdit={false} />);
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
    expect(screen.getByText(/Only a team owner or admin can add one/)).toBeInTheDocument();
    unmount();
    renderInApp(<AnthropicKeyCard anthropicKey={SAVED} canEdit={false} />);
    expect(screen.getByText("Key ending WXYZ")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });
});
