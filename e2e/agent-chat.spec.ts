import { expect, type Page, test } from "./test";

// The agent's chat feels like any chat app: the message you send shows the moment you send
// it (the server's own copy only arrives a few seconds later), and closing the agent or
// reloading brings back the chat that was open. The agent server is stood in for here, so
// the timing is the browser's alone.

const stamp = Date.now().toString(36);
const PROMPT = "List my automations and say which are switched on.";
const REPLY = "You have no automations yet.";

const sse = (events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

async function standInForTheAgent(page: Page) {
  let sent = false;
  await page.route("**/api/agent-controller/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/agent-controller", "");
    if (path === "/stream") {
      // The server is slow to start the run, as the real one is before its first event.
      await new Promise((r) => setTimeout(r, 4_000));
      sent = true;
      return route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sse([
          { type: "__thread__", threadId: "t-agent-chat" },
          {
            type: "message_start",
            message: { id: "u-1", role: "user", content: [{ type: "text", text: PROMPT }] },
          },
          {
            type: "message_start",
            message: { id: "a-1", role: "assistant", content: [{ type: "text", text: REPLY }] },
          },
        ]),
      });
    }
    if (path === "/threads") {
      const threads = sent
        ? [
            {
              id: "t-agent-chat",
              title: "List my automations",
              archived: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ]
        : [];
      return route.fulfill({ json: { threads } });
    }
    if (path === "/threads/t-agent-chat/messages") {
      return route.fulfill({
        json: {
          messages: [
            { id: "u-1", role: "user", parts: [{ type: "text", text: PROMPT }] },
            { id: "a-1", role: "assistant", parts: [{ type: "text", text: REPLY }] },
          ],
        },
      });
    }
    if (path === "/threads/t-agent-chat/pending") {
      return route.fulfill({ json: { running: false, events: [] } });
    }
    return route.fulfill({ json: {} });
  });
}

test("a sent message shows at once, and the chat is still there after closing the agent", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Tomas Reyes");
  await page.locator("#email").fill(`tomas.${stamp}@example.test`);
  await page.locator("#password").fill("agent-chat-e2e-12345");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Chat Shop");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible();

  await standInForTheAgent(page);
  await page.goto("/automations");
  const agent = page.getByRole("complementary", { name: "Agent" });
  await page.locator("header").getByRole("button", { name: "Open the agent" }).click();
  await expect(agent).toBeVisible();

  // A suggestion card sends its prompt; it shows well before the slow server answers.
  await agent.getByRole("button", { name: "What do I have?" }).click();
  await expect(agent.getByText(PROMPT)).toBeVisible({ timeout: 1_500 });
  await expect(agent.getByText("Thinking…")).toBeVisible();

  // Then the reply streams in under it, and the message is not shown twice.
  await expect(agent.getByText(REPLY)).toBeVisible({ timeout: 15_000 });
  await expect(agent.getByText(PROMPT)).toHaveCount(1);

  // Closing the agent and opening it again brings the chat back.
  await agent.getByRole("button", { name: /Close the agent/ }).click();
  await page.locator("header").getByRole("button", { name: "Open the agent" }).click();
  await expect(agent.getByText(REPLY)).toBeVisible();
  await expect(agent.getByText(PROMPT)).toHaveCount(1);

  // So does a reload, and New chat starts a fresh one.
  // (The agent stays open across a reload, as it was left.)
  await page.reload();
  await expect(agent).toBeVisible();
  await expect(agent.getByText(REPLY)).toBeVisible();
  await agent.getByRole("button", { name: "New chat" }).click();
  await expect(agent.getByText(REPLY)).toHaveCount(0);
  await expect(agent.getByRole("button", { name: "What do I have?" })).toBeVisible();
});
