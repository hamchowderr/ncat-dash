import { createHmac } from "node:crypto";

import { AGENT_SECRET } from "../playwright.config";
import { expect, type Page, test } from "./test";

// The agent and alerts in Telegram, in a real browser against a real backend: an owner
// opens the dashboard's bot from Settings with a one-time code, the bot (played here by
// asking the dashboard the way the agent server does) links them when they press Start,
// the agent then knows who wrote, Notifications gets a Telegram column, and the owner
// adds the bot to a group, is told tagging it there needs privacy mode off, and picks the
// group for review activity.

const CONVEX_SITE = "http://127.0.0.1:3211";
const stamp = Date.now().toString(36);
const telegramUser = String(5_000_000 + Math.floor(Math.random() * 1_000_000));
const groupChat = `-100${Date.now()}`;

/** A short-lived token the agent server signs its questions to the dashboard with. */
function agentToken() {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const body = `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: "agent-server", aud: "takewon-dashboard", iat, exp: iat + 300 })}`;
  return `${body}.${createHmac("sha256", AGENT_SECRET).update(body).digest("base64url")}`;
}

/** What the agent server asks the dashboard, signed as it signs them. */
async function asAgent<T>(path: string, body: Record<string, string>): Promise<T> {
  const response = await fetch(`${CONVEX_SITE}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${agentToken()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as T;
}

/** Presses a button that opens Telegram and returns the one-time code in its address. */
async function codeFrom(page: Page, button: string, param: "start" | "startgroup") {
  const [tab] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: button }).click(),
  ]);
  await tab.waitForURL(/^https:\/\/t\.me\//);
  const url = new URL(tab.url());
  expect(url.pathname).toBe("/TakewonStandInBot");
  const code = url.searchParams.get(param);
  expect(code).toMatch(/^[0-9a-f]{32}$/);
  await tab.close();
  return code!;
}

test("links a Telegram from Settings, then a group for review activity", async ({ page }) => {
  // Telegram itself is not reached: the tab it opens gets a blank page.
  await page
    .context()
    .route("https://t.me/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<p>Telegram</p>" }),
    );
  await page.goto("/sign-up");
  await page.locator("#name").fill("Harbour Owner");
  await page.locator("#email").fill(`owner.telegram.${stamp}@example.test`);
  await page.locator("#password").fill("telegram-e2e-password-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill(`Harbour Films ${stamp}`);
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({ timeout: 30_000 });
  await page.goto("/settings/toolkit");
  await page.locator("#baseUrl").fill("http://127.0.0.1:8767");
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();

  await page.goto("/settings/integrations/telegram");
  await expect(page.getByRole("heading", { level: 1, name: "Telegram" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Telegram logo" })).toBeVisible();
  await expect(page.getByText(/@TakewonStandInBot/)).toBeVisible();

  // Before linking, the agent does not know this Telegram account.
  expect(
    await asAgent("/telegram/person", {
      chatId: telegramUser,
      telegramUserId: telegramUser,
      isGroup: "false",
    }),
  ).toEqual({ ok: false, reason: "not_linked" });

  const code = await codeFrom(page, "Link my Telegram", "start");
  await expect(page.getByRole("status")).toHaveText(/press Start in Telegram/);
  // They press Start: the bot sends the code to the dashboard.
  const linked = await asAgent<{ result: string; teamName: string }>("/telegram/link", {
    code,
    telegramUserId: telegramUser,
    chatId: telegramUser,
    isGroup: "false",
    telegramName: "Harbour O",
    username: `harbour${stamp}`,
  });
  expect(linked).toEqual({ result: "linked", teamName: `Harbour Films ${stamp}` });
  await expect(page.getByText("Linked as")).toBeVisible();
  await expect(page.getByText("Harbour O", { exact: true })).toBeVisible();
  // The same code never works twice.
  expect(
    (
      await asAgent<{ result: string }>("/telegram/link", {
        code,
        telegramUserId: "1",
        chatId: "1",
        isGroup: "false",
        telegramName: "Someone else",
      })
    ).result,
  ).toBe("expired");

  // Now the agent works for them when they write to the bot.
  const person = await asAgent<{ ok: boolean; name: string }>("/telegram/person", {
    chatId: telegramUser,
    telegramUserId: telegramUser,
    isGroup: "false",
  });
  expect(person).toMatchObject({ ok: true, name: "Harbour Owner" });

  // Notifications now offers Telegram for each kind of news.
  await page.goto("/settings/notifications");
  const telegramColumn = page.getByRole("columnheader", { name: "Telegram" });
  await expect(telegramColumn).toBeVisible();
  await expect(telegramColumn.locator("svg")).toBeVisible();
  await expect(
    page.getByRole("switch", { name: /An approval is waiting.*: in Telegram/ }),
  ).toBeChecked();

  // The owner adds the bot to the team's group; Telegram asks which, and the bot is in.
  await page.goto("/settings/integrations/telegram");
  const groupCode = await codeFrom(page, "Add to a group", "startgroup");
  const added = await asAgent<{ result: string }>("/telegram/link", {
    code: groupCode,
    telegramUserId: telegramUser,
    chatId: groupChat,
    isGroup: "true",
    chatTitle: "Harbour edit team",
    telegramName: "Harbour O",
  });
  expect(added.result).toBe("added");
  const groups = page.getByRole("region", { name: "Your Telegram groups" });
  await expect(groups.getByText("Harbour edit team")).toBeVisible();
  // The bot joined in privacy mode, so tagging it there can't reach it: Settings says so.
  await expect(groups.getByRole("note")).toContainText("send /setprivacy to @BotFather");

  await groups.getByRole("button", { name: "Post reviews here" }).click();
  await expect(groups.getByText(/review activity posts here/)).toBeVisible();
  await expect(groups.getByRole("button", { name: "Stop review posts" })).toBeVisible();

  // Unlinking stops the agent working for them.
  await page.getByRole("button", { name: "Unlink" }).click();
  await expect(page.getByRole("button", { name: "Link my Telegram" })).toBeVisible();
});
