import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { answerQuery, mutationOf, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { McpSettings, mcpUrl } from "./mcp-settings";

const KEY = {
  keyId: "k1",
  name: "n8n",
  hint: "x9Qz",
  createdAt: Date.UTC(2026, 10, 2),
  lastUsedAt: null,
};

describe("the MCP settings", () => {
  test("shows the server address and each app's own steps, Claude first", () => {
    answerQuery(api.mcpKeys.list, { canEdit: true, keys: [] });
    answerQuery(api.oauth.connections, []);
    renderInApp(<McpSettings />);
    expect(screen.getByRole("button", { name: "Copy the MCP server address" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["Claude", "ChatGPT", "Cursor", "Claude Code", "n8n", "Other apps"]);
    expect(screen.getByRole("tabpanel").textContent).toContain("Add custom connector");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Nothing is connected yet.")).toBeTruthy();
  });

  test("switches to another app's steps", () => {
    answerQuery(api.mcpKeys.list, { canEdit: true, keys: [] });
    answerQuery(api.oauth.connections, []);
    renderInApp(<McpSettings />);
    fireEvent.click(screen.getByRole("tab", { name: /Claude Code/ }));
    expect(screen.getByText(/^claude mcp add --transport http content-automations/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Cursor/ }));
    expect(screen.getByRole("tabpanel").textContent).toContain('"mcpServers"');
  });

  test("n8n gets a key named for it, shown once, with no name to type", async () => {
    answerQuery(api.mcpKeys.list, { canEdit: true, keys: [] });
    answerQuery(api.oauth.connections, []);
    const create = mutationOf(api.mcpKeys.create);
    create.mockResolvedValueOnce({ key: "ncat_secretsecret" });
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderInApp(<McpSettings />);
    fireEvent.click(screen.getByRole("tab", { name: /n8n/ }));
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Make a key for n8n" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/Copy the key for n8n now/),
    );
    expect(create).toHaveBeenCalledWith({ organizationId: TEAM.id, name: "n8n" });
    fireEvent.click(screen.getByRole("button", { name: "Copy the new key" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("ncat_secretsecret"));
  });

  test("another app that cannot sign in gets a key named for it", async () => {
    answerQuery(api.mcpKeys.list, { canEdit: true, keys: [] });
    answerQuery(api.oauth.connections, []);
    const create = mutationOf(api.mcpKeys.create);
    create.mockResolvedValueOnce({ key: "ncat_other" });
    renderInApp(<McpSettings />);
    fireEvent.click(screen.getByRole("tab", { name: /Other apps/ }));
    fireEvent.change(screen.getByLabelText("Which app the key is for"), {
      target: { value: "Render script" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Make a key" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ organizationId: TEAM.id, name: "Render script" }),
    );
  });

  test("lists keys by name and hint, and removes one", async () => {
    answerQuery(api.mcpKeys.list, { canEdit: true, keys: [KEY] });
    answerQuery(api.oauth.connections, []);
    const remove = mutationOf(api.mcpKeys.remove);
    renderInApp(<McpSettings />);
    const row = within(screen.getByRole("list", { name: "Connected apps" })).getByRole("listitem");
    expect(row.textContent).toMatch(/n8n.*key ending in x9Qz.*never used/);
    fireEvent.click(within(row).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith({ organizationId: TEAM.id, keyId: "k1" }),
    );
    expect(toastSuccess).toHaveBeenCalled();
  });

  test("a member is told to ask an owner or admin for a key", () => {
    answerQuery(api.mcpKeys.list, { canEdit: false, keys: [] });
    answerQuery(api.oauth.connections, []);
    renderInApp(<McpSettings />);
    fireEvent.click(screen.getByRole("tab", { name: /n8n/ }));
    expect(screen.getByText("Ask a team owner or admin to make the key.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Make a key/ })).toBeNull();
  });

  test("lists the apps that signed in, and disconnects one", async () => {
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
    renderInApp(<McpSettings />);
    const row = within(screen.getByRole("list", { name: "Connected apps" })).getByRole("listitem");
    expect(row.textContent).toMatch(/Claude.*you.*not used yet/);
    fireEvent.click(within(row).getByRole("button", { name: "Disconnect" }));
    await waitFor(() =>
      expect(disconnect).toHaveBeenCalledWith({ organizationId: TEAM.id, grantId: "g1" }),
    );
  });
});

describe("the MCP server address", () => {
  test("is the MCP server's own domain when one is set, else the Convex site", () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://dash-site.example.com");
    vi.stubEnv("NEXT_PUBLIC_MCP_ORIGIN", "");
    try {
      expect(mcpUrl()).toBe("https://dash-site.example.com/mcp");
      vi.stubEnv("NEXT_PUBLIC_MCP_ORIGIN", "https://mcp.example.com/");
      expect(mcpUrl()).toBe("https://mcp.example.com/mcp");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
