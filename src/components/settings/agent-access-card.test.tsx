import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { answerQuery, mutationOf, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { AgentAccessCard } from "./agent-access-card";

const KEY = { keyId: "k1", name: "Claude Code on the studio Mac", hint: "x9Qz", createdAt: Date.UTC(2026, 10, 2), lastUsedAt: null };

describe("the AI agents settings", () => {
  test("shows the address and the Claude Code command to connect with", () => {
    answerQuery(api.mcpKeys.list, { canEdit: true, keys: [] });
    renderInApp(<AgentAccessCard />);
    expect(screen.getByText(/\/mcp$/)).toBeTruthy();
    expect(screen.getByText(/^claude mcp add --transport http/).textContent).toContain(
      'Authorization: Bearer <your key>',
    );
  });

  test("makes a key, shows it once, and puts it in the command", async () => {
    answerQuery(api.mcpKeys.list, { canEdit: true, keys: [] });
    const create = mutationOf(api.mcpKeys.create);
    create.mockResolvedValueOnce({ key: "ncat_secretsecret" });
    renderInApp(<AgentAccessCard />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Cursor" } });
    fireEvent.click(screen.getByRole("button", { name: "Make a key" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Cursor: copy this key now/));
    expect(create).toHaveBeenCalledWith({ organizationId: TEAM.id, name: "Cursor" });
    expect(within(screen.getByRole("status")).getByText("ncat_secretsecret")).toBeTruthy();
    expect(screen.getByText(/^claude mcp add/).textContent).toContain("Bearer ncat_secretsecret");
  });

  test("copies the new key", async () => {
    answerQuery(api.mcpKeys.list, { canEdit: true, keys: [] });
    mutationOf(api.mcpKeys.create).mockResolvedValueOnce({ key: "ncat_secretsecret" });
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderInApp(<AgentAccessCard />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Cursor" } });
    fireEvent.click(screen.getByRole("button", { name: "Make a key" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy the new key" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("ncat_secretsecret"));
  });

  test("lists keys by name and hint, and removes one", async () => {
    answerQuery(api.mcpKeys.list, { canEdit: true, keys: [KEY] });
    const remove = mutationOf(api.mcpKeys.remove);
    renderInApp(<AgentAccessCard />);
    const row = within(screen.getByRole("list", { name: "Your team's keys" })).getByRole("listitem");
    expect(row.textContent).toMatch(/Claude Code on the studio Mac.*ends in x9Qz.*never used/);
    fireEvent.click(within(row).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ organizationId: TEAM.id, keyId: "k1" }));
    expect(toastSuccess).toHaveBeenCalled();
  });

  test("tells a member that only an owner or admin manages keys", () => {
    answerQuery(api.mcpKeys.list, { canEdit: false, keys: [] });
    renderInApp(<AgentAccessCard />);
    expect(screen.getByText("Only a team owner or admin can make or remove keys.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Make a key" })).toBeNull();
  });
});
