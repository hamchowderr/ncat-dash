import { createHash, randomBytes } from "node:crypto";

import { expect, test } from "./test";

// An AI agent connecting to the dashboard's MCP server, in a real browser against a real
// backend: it signs in with OAuth (the person allows it and picks the team), builds an
// automation as a draft, runs it, and shows the run's steps in the chat (MCP Apps).

const TOOLKIT = "http://127.0.0.1:8767";
const SITE = "http://127.0.0.1:3211";
const FILES = "http://127.0.0.1:8766";
const REDIRECT = "http://localhost:3000/agent-came-back";
const stamp = Date.now().toString(36);
// RECORD_VIDEO=1 keeps a screen recording of the run, slowed down so it can be followed.
if (process.env.RECORD_VIDEO === "1") {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 300 },
  });
}

const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {
    extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } },
  },
  "io.modelcontextprotocol/clientInfo": { name: "e2e agent", version: "1" },
};

let nextId = 1;
async function mcp(token: string, method: string, params: Record<string, unknown> = {}) {
  const response = await fetch(`${SITE}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId++,
      method,
      params: { ...params, _meta: META },
    }),
  });
  return (await response.json()) as { result: Record<string, unknown> };
}

async function tool(token: string, name: string, args: Record<string, unknown>) {
  const { result } = await mcp(token, "tools/call", { name, arguments: args });
  return result.structuredContent as Record<string, unknown>;
}

test("an agent signs in, builds a draft, and shows its run in the chat", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Ari Cole");
  await page.locator("#email").fill(`ari.agents.${stamp}@example.test`);
  await page.locator("#password").fill("ai-agents-e2e-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Harbour Films");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: /Yes, I Have One/ }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  // Settings > AI agents: the address to paste into Claude, and nothing connected yet.
  await page.goto("/settings/integrations/mcp");
  await expect(page.getByRole("tab", { name: /Claude Code/ })).toBeVisible();
  await expect(page.getByText("Nothing is connected yet.")).toBeVisible();
  await page.waitForTimeout(1500);
  for (const app of ["ChatGPT", "Cursor", "Claude Code", "n8n", "Claude"]) {
    await page.getByRole("tab", { name: app, exact: true }).click();
    await page.waitForTimeout(1200);
  }

  // The agent finds how to sign in from the MCP address, registers, and opens the
  // sign-in page, which lands on the dashboard's Allow page.
  const challenge = await fetch(`${SITE}/mcp`, { method: "POST", body: "{}" });
  expect(challenge.status).toBe(401);
  expect(challenge.headers.get("www-authenticate")).toContain("resource_metadata=");
  const registered = await (
    await fetch(`${SITE}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT] }),
    })
  ).json();
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: registered.client_id,
    redirect_uri: REDIRECT,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: "e2e",
    resource: `${SITE}/mcp`,
  });
  let back = "";
  await page.route(`${REDIRECT}**`, async (route) => {
    back = route.request().url();
    await route.fulfill({
      contentType: "text/html",
      body: "<p>Connected. You can go back to Claude.</p>",
    });
  });
  await page.goto(`${SITE}/oauth/authorize?${params}`);
  await expect(
    page.getByRole("heading", { name: "Claude wants to connect to Harbour Films" }),
  ).toBeVisible();
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(page.getByText("Connected. You can go back to Claude.")).toBeVisible();
  const code = new URL(back).searchParams.get("code")!;
  const tokens = await (
    await fetch(`${SITE}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id: registered.client_id,
        redirect_uri: REDIRECT,
      }).toString(),
    })
  ).json();
  const token = tokens.access_token as string;

  // Signed in, the agent builds an automation. It is kept as a draft to publish.
  const made = await tool(token, "create_automation", { name: "Podcast captions" });
  const changed = await tool(token, "change_automation", {
    automation_id: made.automation_id,
    operations: [
      { op: "trigger", trigger: { kind: "manual" } },
      {
        op: "add",
        type: "step:video-trim",
        id: "trim",
        settings: { start: "00:00:01", end: "00:00:04" },
      },
      {
        op: "add",
        type: "step:media-convert",
        id: "convert",
        after: "trim",
        settings: { format: "mp4" },
      },
    ],
  });
  expect(changed.draft).toBe(true);
  await page.goto(made.address as string);
  await expect(page.getByText(/draft/i).first()).toBeVisible();
  await page.waitForTimeout(2500);

  // It tries the draft on a file, and the chat shows the run as it goes (MCP Apps).
  const started = await tool(token, "start_automation", {
    automation_id: made.automation_id,
    file_url: `${FILES}/clip.mp4`,
    version: "draft",
  });
  const listed = await mcp(token, "tools/list");
  const tools = listed.result.tools as { name: string; _meta?: { ui?: { resourceUri: string } } }[];
  const uri = tools.find((each) => each.name === "check_run")!._meta!.ui!.resourceUri;
  const page_ = await mcp(token, "resources/read", { uri });
  const html = (page_.result.contents as { text: string }[])[0].text;
  await page.goto("/agent-came-back");
  await page.setContent(chatHost(html), { waitUntil: "load" });
  await page.exposeFunction(
    "callTool",
    async (name: string, args: Record<string, unknown>) =>
      (await mcp(token, "tools/call", { name, arguments: args })).result,
  );
  await page.evaluate(
    (result) => (window as unknown as { start: (r: unknown) => void }).start(result),
    { content: [{ type: "text", text: JSON.stringify(started) }], structuredContent: started },
  );
  const frame = page.frameLocator("iframe");
  await expect(frame.getByText("Podcast captions")).toBeVisible();
  await expect(frame.getByText("Done", { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2000);

  // Settings lists it as connected; disconnecting turns it away.
  await page.unrouteAll();
  await page.goto("/settings/integrations/mcp");
  const connected = page.getByRole("list", { name: "Connected apps" });
  await expect(connected).toContainText("Claude");
  await page.waitForTimeout(1000);
  await connected.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("Nothing is connected yet.")).toBeVisible();
  const refused = await fetch(`${SITE}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "server/discover",
      params: { _meta: META },
    }),
  });
  expect(refused.status).toBe(401);
  await page.waitForTimeout(1000);
});

/**
 * A stand-in chat: Claude's reply with the run page under it, as an MCP Apps host shows
 * it. It answers the page's ui/initialize, hands it the tool result, and passes its
 * tools/call requests on to the MCP server.
 */
function chatHost(appHtml: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; background: #f7f7f5; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; color: #1f1f1f; }
    main { max-width: 720px; margin: 48px auto; padding: 0 16px; }
    .you { background: #ebe9e4; border-radius: 16px; padding: 10px 14px; margin: 0 0 20px auto; width: fit-content; }
    iframe { width: 100%; border: 1px solid #e4e4e0; border-radius: 12px; background: #fff; height: 200px; }
  </style></head><body><main>
    <p class="you">Try the podcast captions automation on clip.mp4</p>
    <p>I ran the draft on clip.mp4. Here it is as it goes:</p>
    <iframe sandbox="allow-scripts" srcdoc="${appHtml.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe>
  </main><script>
    const frame = document.querySelector("iframe");
    let result = null, ready = false;
    window.start = (r) => { result = r; if (ready) give(); };
    function give() { frame.contentWindow.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result }, "*"); }
    window.addEventListener("message", async (event) => {
      const m = event.data;
      if (!m || m.jsonrpc !== "2.0") return;
      const reply = (r) => frame.contentWindow.postMessage({ jsonrpc: "2.0", id: m.id, result: r }, "*");
      if (m.method === "ui/initialize") reply({ protocolVersion: "2026-01-26", hostInfo: { name: "chat", version: "1" }, hostCapabilities: {}, hostContext: {} });
      if (m.method === "ui/notifications/initialized") { ready = true; if (result) give(); }
      if (m.method === "ui/notifications/size-changed") frame.style.height = m.params.height + 2 + "px";
      if (m.method === "tools/call") reply(await window.callTool(m.params.name, m.params.arguments));
    });
  </script></body></html>`;
}
