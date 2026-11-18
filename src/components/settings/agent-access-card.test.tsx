import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { answerQuery, mutationOf, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { AgentAccessCard } from "./agent-access-card";

const KEY = {
  keyId: "k1",
  name: "Claude Code on the studio Mac",
  hint: "x9Qz",
  createdAt: Date.UTC(2026, 10, 2),
  lastUsedAt: null,
};

describe("the AI agents settings", () => {
  test("shows the address for Claude's connectors and the Claude Code command, which sign in", () => {
    answerQuery(api.mcpKeys.list, { canEdit: true, keys: [] });
    answerQuery(api.oauth.connections, []);
    renderInApp(<AgentAccessCard />);
    expect(screen.getByRole("button", { name: "Copy the MCP server address" })).toBeTruthy();
    expect(screen.getByText(/Add custom connector/)).toBeTruthy();
    const command = screen.getByText(/^claude mcp add --transport http/).textContent ?? "";
    expect(command).toMatch(/content-automations \S*\/mcp$/);
    expect(command).not.toContain("Bearer");
    expect(screen.getByText("No agent has signed in yet.")).toBeTruthy();
  });

  test("makes a key, shows it once, with the header to send it in", async () => {
    answerQuery(api.mcpKeys.list, { canEdit: true, keys: [] });
    answerQuery(api.oauth.connections, []);
    const create = mutationOf(api.mcpKeys.create);
    create.mockResolvedValueOnce({ key: "ncat_secretsecret" });
    renderInApp(<AgentAccessCard />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Cursor" } });
    fireEvent.click(screen.getByRole("button", { name: "Make a key" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/Cursor: copy this key now/),
    );
    expect(create).toHaveBeenCalledWith({ organizationId: TEAM.id, name: "Cursor" });
    expect(within(screen.getByRole("status")).getByText("ncat_secretsecret")).toBeTruthy();
    expect(
      within(screen.getByRole("status")).getByText("Authorization: Bearer ncat_secretsecret"),
    ).toBeTruthy();
  });

  test("copies the new key", async () => {
    answerQuery(api.mcpKeys.list, { canEdit: true, keys: [] });
    answerQuery(api.oauth.connections, []);
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
    answerQuery(api.oauth.connections, []);
    const remove = mutationOf(api.mcpKeys.remove);
    renderInApp(<AgentAccessCard />);
    const row = within(screen.getByRole("list", { name: "Your team's keys" })).getByRole(
      "listitem",
    );
    expect(row.textContent).toMatch(/Claude Code on the studio Mac.*ends in x9Qz.*never used/);
    fireEvent.click(within(row).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith({ organizationId: TEAM.id, keyId: "k1" }),
    );
    expect(toastSuccess).toHaveBeenCalled();
  });

  test("tells a member that only an owner or admin manages keys", () => {
    answerQuery(api.mcpKeys.list, { canEdit: false, keys: [] });
    answerQuery(api.oauth.connections, []);
    renderInApp(<AgentAccessCard />);
    expect(screen.getByText("Only a team owner or admin can make or remove keys.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Make a key" })).toBeNull();
  });

  test("lists the agents that signed in, and disconnects one", async () => {
    answerQuery(api.mcpKeys.list, { canEdit: true, keys: [] });
    answerQuery(api.oauth.connections, [
      {
        grantId: "g1",
        clientName: "Claude",
        person: "Maya Ortiz",
        mine: true,
        createdAt: Date.UTC(2026, 10, 2),
        lastUsedAt: null,
      },
    ]);
    const disconnect = mutationOf(api.oauth.disconnect);
    renderInApp(<AgentAccessCard />);
    const row = within(screen.getByRole("list", { name: "Connected agents" })).getByRole(
      "listitem",
    );
    expect(row.textContent).toMatch(/Claude.*you.*not used yet/);
    fireEvent.click(within(row).getByRole("button", { name: "Disconnect" }));
    await waitFor(() =>
      expect(disconnect).toHaveBeenCalledWith({ organizationId: TEAM.id, grantId: "g1" }),
    );
  });
});
