import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { answerQuery, mutationOf } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { McpSettings, mcpUrl } from "./mcp-settings";

describe("the MCP settings", () => {
  test("shows the server address and each app's own steps, Claude first", () => {
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
    answerQuery(api.oauth.connections, []);
    renderInApp(<McpSettings />);
    fireEvent.click(screen.getByRole("tab", { name: /Claude Code/ }));
    expect(screen.getByText(/^claude mcp add --transport http content-automations/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Cursor/ }));
    expect(screen.getByRole("tabpanel").textContent).toContain('"mcpServers"');
  });

  test("every app signs in, n8n too: there are no keys to make anywhere", () => {
    answerQuery(api.oauth.connections, []);
    renderInApp(<McpSettings />);
    fireEvent.click(screen.getByRole("tab", { name: /n8n/ }));
    const n8n = screen.getByRole("tabpanel").textContent ?? "";
    expect(n8n).toContain("MCP OAuth2");
    expect(n8n).toContain("Register Client Automatically");
    expect(n8n).toContain("Server URL");
    expect(n8n).toContain("sign in and pick the team");
    fireEvent.click(screen.getByRole("tab", { name: /Other apps/ }));
    expect(screen.getByRole("tabpanel").textContent).toContain("sign in and pick the team");
    for (const tab of screen.getAllByRole("tab")) {
      fireEvent.click(tab);
      expect(screen.queryByRole("button", { name: /key/i })).toBeNull();
      expect(screen.getByRole("tabpanel").textContent).not.toMatch(/Bearer/);
    }
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  test("lists the apps that signed in, and disconnects one", async () => {
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
