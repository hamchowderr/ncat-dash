import { createHmac } from "node:crypto";

import { type Browser, expect, type Page, test } from "./test";

import { BOT_USER, teamOfToken, TOKEN_PREFIX } from "./slack-shared";

// The agent in Slack, in a real browser against a real backend and the real agent
// server, with Slack itself played by e2e/slack-stand-in.mjs: an owner connects the
// team's own Slack app in Settings, then a teammate tags the agent in a channel and the
// answer comes back in that thread, worked out with the dashboard as that teammate.
// Someone Slack knows but the team does not is told so, and a forged request is refused.

const TOOLKIT = "http://127.0.0.1:8767";
const FILES = "http://127.0.0.1:8766";
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
  method: string;
  ts: string;
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
const comments = (page: Page) => page.locator('section[aria-label="Comments"]');
const commentBox = (page: Page) => page.getByRole("textbox", { name: /^Comment at this moment/ });

/** What the bot has posted to a channel outside any thread, newest last. */
async function channelPosts(channel: string): Promise<Posted[]> {
  return (await posted()).filter(
    (message) =>
      message.channel === channel && !message.thread_ts && message.method === "chat.postMessage",
  );
}

test.describe.configure({ mode: "serial" });

let jordan: Page;

test.beforeAll(async ({ browser }) => {
  jordan = await signUp(browser, "Jordan Lee", jordanEmail);
  await jordan.getByPlaceholder("Your company or channel").fill("Salt House");
  await jordan.getByRole("button", { name: "Create team" }).click();
  await expect(jordan.getByRole("heading", { name: "Add your brand" })).toBeVisible({
    timeout: 30_000,
  });
  await jordan.goto("/settings/toolkit");
  await jordan.locator("#baseUrl").fill(TOOLKIT);
  await jordan.locator("#apiKey").fill("stand-in-key-1234");
  await jordan.getByRole("button", { name: "Test and connect" }).click();
  await expect(jordan.getByText("Your own toolkit", { exact: true })).toBeVisible();

  // One automation, which only someone on the team can see.
  await jordan.goto("/automations");
  await jordan.getByRole("link", { name: "New automation", exact: true }).click();
  await jordan.getByRole("button", { name: "Empty canvas" }).first().click();
  await expect(jordan).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
});

test("an owner makes the team's Slack app from a filled-in manifest and connects it", async () => {
  await jordan.goto("/settings/integrations/slack");
  await expect(jordan.getByRole("heading", { level: 1, name: "Slack" })).toBeVisible();

  // The manifest carries the dashboard's own address for events and button presses.
  const create = card(jordan).getByRole("link", { name: "Create the Slack app" });
  const href = (await create.getAttribute("href")) ?? "";
  expect(href).toMatch(/^https:\/\/api\.slack\.com\/apps\?new_app=1&manifest_json=/);
  const manifest = JSON.parse(decodeURIComponent(href.split("manifest_json=")[1]));
  expect(manifest.settings.event_subscriptions.request_url).toBe(`${APP}/api/slack/events`);
  expect(manifest.settings.interactivity.request_url).toBe(`${APP}/api/slack/events`);
  expect(manifest.oauth_config.scopes.bot).toContain("users:read.email");
  expect(manifest.display_information.name).toBe("Takewon");

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

test("an owner picks the channel review activity goes to, and the app joins it", async () => {
  await jordan.goto("/settings/integrations/slack");
  const select = card(jordan).getByRole("combobox", { name: "Review activity" });
  await expect(select).toBeEnabled({ timeout: 30_000 });
  await expect(select).toHaveText(/Not posted/);
  await select.click();
  await jordan.getByRole("option", { name: "#video-team" }).click();
  await expect(select).toHaveText(/video-team/);
  const joined = (await (await fetch(`${SLACK}/stand-in/joined`)).json()) as string[];
  expect(joined).toContain("C0VIDEOTEAM");
});

let shareUrl = "";
let threadTs = "";

test("a review an automation opens is posted to the channel", async () => {
  await jordan.goto("/automations");
  await jordan
    .getByLabel("Automation file to import")
    .setInputFiles("e2e/fixtures/weekly-clips.automation.json");
  await expect(jordan).toHaveURL(/\/automations\/.+/);
  await jordan.getByRole("switch").first().click();
  await expect(jordan.getByRole("switch").first()).toBeChecked();
  await jordan.locator(".react-flow__node-trigger").click();
  const address = await jordan.locator("#trigger-address").inputValue();
  const started = await fetch(address, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_url: `${FILES}/station-interview.webm` }),
  });
  expect(started.status).toBe(202);

  await expect
    .poll(
      async () => (await channelPosts("C0VIDEOTEAM")).map((message) => message.text).join("\n"),
      {
        timeout: 60_000,
      },
    )
    .toMatch(
      /New review: <http:\/\/localhost:3000\/review\/[^|]+\|Weekly clips> \(2 clips\)\. The automation is waiting for someone to approve it\./,
    );
});

test("a client's comment starts a Slack thread, and a teammate's reply there lands in the review", async ({
  browser,
}) => {
  await jordan.goto("/review");
  await jordan.getByRole("link", { name: /Weekly clips/ }).click();
  await expect(jordan).toHaveURL(/\/review\/.+/);
  await jordan.getByRole("button", { name: "Share" }).click();
  const dialog = jordan.getByRole("dialog", { name: "Share with a client" });
  await dialog.getByRole("button", { name: "Create link" }).click();
  const link = dialog.getByRole("textbox", { name: "Share link" });
  await expect(link).toHaveValue(/\/share\/[a-f0-9]{64}$/);
  shareUrl = await link.inputValue();
  await jordan.keyboard.press("Escape");

  const client = await (await browser.newContext()).newPage();
  await client.goto(shareUrl);
  await client.getByLabel("Your name").fill("Riley Client");
  await client.getByRole("button", { name: "Continue" }).click();
  await commentBox(client).fill("Can the end card stay up a little longer?");
  await commentBox(client).press("Enter");

  await expect
    .poll(async () => (await channelPosts("C0VIDEOTEAM")).at(-1)?.text ?? "", { timeout: 30_000 })
    .toMatch(
      /^\*Riley Client\* \(client\) commented on <.+\|Weekly clips>, .+ at 0:00:\n> Can the end card stay up a little longer\?$/,
    );
  threadTs = (await channelPosts("C0VIDEOTEAM")).at(-1)!.ts;

  // Jordan answers in Slack, in that thread.
  const ts = `${Math.floor(Date.now() / 1000)}.000500`;
  const response = await sendEvent({
    type: "message",
    user: "U0JORDAN",
    text: "Sure, two more seconds.",
    ts,
    thread_ts: threadTs,
    channel: "C0VIDEOTEAM",
    channel_type: "channel",
  });
  expect(response.status).toBe(200);

  // It shows in the review room as Jordan's reply, for the team and for the client.
  const thread = comments(jordan).getByRole("listitem").filter({ hasText: "Can the end card" });
  await expect(thread.getByText("Sure, two more seconds.")).toBeVisible({ timeout: 30_000 });
  await expect(thread).toContainText("Jordan Lee");
  await expect(comments(client).getByText("Sure, two more seconds.")).toBeVisible();

  // A reply written in the room goes the other way, into the Slack thread.
  await thread.getByRole("button", { name: "Reply" }).click();
  await jordan.getByRole("textbox", { name: "Reply" }).fill("Done, version 2 is up.");
  await jordan.getByRole("textbox", { name: "Reply" }).press("Enter");
  await expect
    .poll(async () => (await repliesIn(threadTs)).join("\n"), { timeout: 30_000 })
    .toContain("*Jordan Lee*: Done, version 2 is up.");
  // What came from Slack is not posted back to it.
  expect((await repliesIn(threadTs)).join("\n")).not.toContain("Sure, two more seconds.");
  await client.context().close();
});

test("the approval waiting comes to Jordan as a Slack message, and Approve there decides it", async () => {
  // Settings, Notifications has a Slack column now that the team has Slack.
  await jordan.goto("/settings/notifications");
  await expect(jordan.getByRole("columnheader", { name: "Slack" })).toBeVisible();
  await expect(
    jordan.getByRole("switch", { name: "An approval is waiting for me: in Slack" }),
  ).toBeChecked();

  const approval = async () =>
    (await posted()).find(
      (message) =>
        message.method === "chat.postMessage" &&
        message.channel === "U0JORDAN" &&
        message.text.includes("waiting for your approval"),
    ) as (Posted & { blocks: string | null }) | undefined;
  await expect.poll(async () => Boolean(await approval()), { timeout: 30_000 }).toBe(true);
  const message = (await approval())!;
  const buttons = JSON.parse(message.blocks ?? "[]")[1].elements as {
    action_id: string;
    value: string;
  }[];
  expect(buttons.map((button) => button.action_id)).toEqual([
    "ncat_alert_approve",
    "ncat_alert_send_back",
  ]);

  // Jordan presses Approve in Slack: Slack posts the press, signed, to the dashboard.
  const body = new URLSearchParams({
    payload: JSON.stringify({
      type: "block_actions",
      team: { id: slackTeam },
      user: { id: "U0JORDAN" },
      container: { channel_id: message.channel, message_ts: message.ts },
      actions: [{ action_id: "ncat_alert_approve", value: buttons[0].value }],
    }),
  }).toString();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  const pressed = await fetch(`${APP}/api/slack/events`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    body,
  });
  expect(pressed.status).toBe(200);

  // The message now says who approved, and its buttons are gone.
  const same = async () =>
    (await posted()).find((one) => one.ts === message.ts) as Posted & { blocks: string | null };
  await expect
    .poll(async () => (await same()).blocks ?? "", { timeout: 30_000 })
    .toContain("Approved by Jordan Lee.");
  expect((await same()).blocks).not.toContain("ncat_alert_");
  expect((await same()).text).toBe("Approved by Jordan Lee.");
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
  await jordan.goto("/settings/integrations/slack");
  await card(jordan).getByRole("button", { name: "Disconnect" }).click();
  await expect(card(jordan).getByRole("link", { name: "Create the Slack app" })).toBeVisible();
});
