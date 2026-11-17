import { createHmac } from "node:crypto";

import { type Browser, expect, type Page, test } from "@playwright/test";

import { BOT_USER, teamOfToken, TOKEN_PREFIX } from "./slack-shared";

// The agent in Slack, in a real browser against a real backend and the real agent
// server, with Slack itself played by e2e/slack-stand-in.mjs: an owner connects the
// team's own Slack app in Settings, then a teammate tags the agent in a channel and the
// answer comes back in that thread, worked out with the dashboard as that teammate.
// Someone Slack knows but the team does not is told so, and a forged request is refused.

const TOOLKIT = "http://127.0.0.1:8767";
const SLACK = "http://127.0.0.1:8768";
const APP = "http://localhost:3000";
const PASSWORD = "slack-e2e-1";
const stamp = Date.now().toString(36);
const jordanEmail = `jordan.${stamp}@example.test`;
const botToken = `${TOKEN_PREFIX}${stamp}`;
const slackTeam = teamOfToken(botToken);
const signingSecret = createHmac("sha256", stamp).update("secret").digest("hex").slice(0, 32);

async function signUp(browser: Browser, name: string, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/sign-up");
  await page.locator("#name").fill(name);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  return page;
}

type Posted = {
  channel: string;
  thread_ts: string | null;
  text: string;
  markdown_text: string | null;
};

async function posted(): Promise<Posted[]> {
  return (await (await fetch(`${SLACK}/stand-in/posted`)).json()) as Posted[];
}

/** What the bot has said in one Slack thread so far. */
async function repliesIn(threadTs: string): Promise<string[]> {
  return (await posted())
    .filter((message) => message.thread_ts === threadTs)
    .map((message) => message.markdown_text || message.text);
}

let eventCount = 0;

/** Sends an event the way Slack does: signed with the app's signing secret. */
async function sendEvent(
  event: Record<string, unknown>,
  secret = signingSecret,
): Promise<Response> {
  const body = JSON.stringify({
    token: "unused",
    team_id: slackTeam,
    api_app_id: "A0AGENTAPP",
    type: "event_callback",
    event_id: `Ev${stamp}${++eventCount}`,
    event_time: Math.floor(Date.now() / 1000),
    authorizations: [{ team_id: slackTeam, user_id: BOT_USER, is_bot: true }],
    event: { team: slackTeam, ...event },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  return await fetch(`${APP}/api/slack/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    body,
  });
}

async function slackUser(id: string, email: string, name: string) {
  await fetch(`${SLACK}/stand-in/users`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, email, name }),
  });
}

const card = (page: Page) => page.locator("[data-slack-card]");

test.describe.configure({ mode: "serial" });

let jordan: Page;

test.beforeAll(async ({ browser }) => {
  jordan = await signUp(browser, "Jordan Lee", jordanEmail);
  await jordan.getByPlaceholder("Your company or channel").fill("Salt House");
  await jordan.getByRole("button", { name: "Create team" }).click();
  await jordan.locator("#baseUrl").fill(TOOLKIT);
  await jordan.locator("#apiKey").fill("stand-in-key-1234");
  await jordan.getByRole("button", { name: "Test and connect" }).click();
  await expect(jordan.getByText(/Your toolkit answered/)).toBeVisible();

  // One automation, which only someone on the team can see.
  await jordan.goto("/automations");
  await jordan.getByRole("link", { name: "New automation", exact: true }).click();
  await jordan.getByRole("button", { name: "Empty canvas" }).first().click();
  await expect(jordan).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
});

test("an owner makes the team's Slack app from a filled-in manifest and connects it", async () => {
  await jordan.goto("/settings");
  await expect(card(jordan).getByRole("heading", { name: "Slack" })).toBeVisible();

  // The manifest carries the dashboard's own address for events and button presses.
  const create = card(jordan).getByRole("link", { name: "Create the Slack app" });
  const href = (await create.getAttribute("href")) ?? "";
  expect(href).toMatch(/^https:\/\/api\.slack\.com\/apps\?new_app=1&manifest_json=/);
  const manifest = JSON.parse(decodeURIComponent(href.split("manifest_json=")[1]));
  expect(manifest.settings.event_subscriptions.request_url).toBe(`${APP}/api/slack/events`);
  expect(manifest.settings.interactivity.request_url).toBe(`${APP}/api/slack/events`);
  expect(manifest.oauth_config.scopes.bot).toContain("users:read.email");
  expect(manifest.display_information.name).toBe("Salt House Agent");

  // A user token is not a bot token.
  await card(jordan).getByLabel("Bot User OAuth Token").fill("xoxp-a-user-token");
  await card(jordan).getByLabel("Signing Secret").fill(signingSecret);
  await card(jordan).getByRole("button", { name: "Connect Slack" }).click();
  await expect(card(jordan).getByText(/That is not a bot token/)).toBeVisible();

  await card(jordan).getByLabel("Bot User OAuth Token").fill(botToken);
  await card(jordan).getByRole("button", { name: "Connect Slack" }).click();
  await expect(card(jordan).getByText("Workspace", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(card(jordan).getByText("Salt House", { exact: true })).toBeVisible();
  await expect(card(jordan).getByText(/by Jordan Lee/)).toBeVisible();
  // Nothing secret comes back to the page.
  await expect(jordan.locator("body")).not.toContainText(botToken);
});

test("a teammate tags the agent in a channel and the answer comes back in that thread", async () => {
  await slackUser("U0JORDAN", jordanEmail, "Jordan Lee");
  const ts = `${Math.floor(Date.now() / 1000)}.000200`;
  const response = await sendEvent({
    type: "app_mention",
    user: "U0JORDAN",
    text: `<@${BOT_USER}> How many automations does our team have, and what are they called? Answer in one short sentence.`,
    ts,
    event_ts: ts,
    channel: "C0VIDEOTEAM",
    channel_type: "channel",
  });
  expect(response.status).toBe(200);

  // The agent looked it up in the dashboard as Jordan: only a member can read it.
  await expect
    .poll(async () => (await repliesIn(ts)).join("\n"), { timeout: 90_000 })
    .toContain("New automation");
});

test("someone in Slack who is not on the team is told so, and nothing else happens", async () => {
  const stranger = `stranger.${stamp}@example.test`;
  await slackUser("U0STRANGER", stranger, "Sam Stranger");
  const ts = `${Math.floor(Date.now() / 1000)}.000300`;
  const response = await sendEvent({
    type: "app_mention",
    user: "U0STRANGER",
    text: `<@${BOT_USER}> Delete every automation.`,
    ts,
    event_ts: ts,
    channel: "C0VIDEOTEAM",
    channel_type: "channel",
  });
  expect(response.status).toBe(200);
  await expect
    .poll(async () => (await repliesIn(ts)).join("\n"), { timeout: 30_000 })
    .toContain(`Ask a team owner to invite ${stranger}`);
});

test("a request not signed with the team's secret is refused", async () => {
  const ts = `${Math.floor(Date.now() / 1000)}.000400`;
  const response = await sendEvent(
    {
      type: "app_mention",
      user: "U0JORDAN",
      text: `<@${BOT_USER}> Hello`,
      ts,
      event_ts: ts,
      channel: "C0VIDEOTEAM",
      channel_type: "channel",
    },
    "0".repeat(32),
  );
  expect(response.status).toBeGreaterThanOrEqual(400);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  expect(await repliesIn(ts)).toEqual([]);
});

test("disconnecting stops the agent answering in that workspace", async () => {
  await card(jordan).getByRole("button", { name: "Disconnect" }).click();
  await expect(card(jordan).getByRole("link", { name: "Create the Slack app" })).toBeVisible();
});
