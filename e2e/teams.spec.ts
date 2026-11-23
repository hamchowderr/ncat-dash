import { createHmac } from "node:crypto";

import { AGENT_SECRET } from "../playwright.config";
import { expect, test } from "./test";

import { MICROSOFT, MICROSOFT_USER, TEAMS_TEAM } from "./microsoft-data.mjs";

// The agent in Microsoft Teams, in a real browser against a real backend: an owner links
// the team's Microsoft organization from Settings (the stand-in signs in at once), the
// Teams app can be downloaded, the agent server asks who wrote in a Teams team, and the
// owner then picks one of that team's channels for alerts. An approval posted there as a
// card is approved by pressing Approve in Teams, and the card then says who decided.
// Review activity goes there too: a client's comment becomes a Teams thread, a reply in
// that thread lands in the review, and a reply in the review goes back to the thread.

const CONVEX_SITE = "http://127.0.0.1:3211";
const FILES = "http://127.0.0.1:8766";
const stamp = Date.now().toString(36);
if (process.env.RECORD_VIDEO === "1") {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 300 },
  });
}

/** A short-lived token the agent server signs its questions to the dashboard with. */
function agentToken() {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const body = `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: "agent-server", aud: "takewon-dashboard", iat, exp: iat + 300 })}`;
  return `${body}.${createHmac("sha256", AGENT_SECRET).update(body).digest("base64url")}`;
}

test("links the organization; alerts with Approve and review activity go both ways in a channel", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await page.goto("/sign-up");
  await page.locator("#name").fill("Harbour Organizer");
  await page.locator("#email").fill(`organizer.teams.${stamp}@example.test`);
  await page.locator("#password").fill("teams-e2e-password-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill(`Harbour Films ${stamp}`);
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: /Yes, I Have One/ }).click();
  await page.locator("#baseUrl").fill("http://127.0.0.1:8767");
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  // Each run signs in as its own account and organization, since one Microsoft
  // organization can be linked to only one team.
  const tenant = `00000000-0000-4000-8000-${stamp.padStart(12, "0").slice(-12)}`;
  const userId = `ms-teams-${stamp}`;
  await fetch(`${MICROSOFT}/stand-in/user`, {
    method: "POST",
    body: JSON.stringify({ id: userId, tid: tenant }),
  });

  await page.goto("/settings/integrations/teams");
  await expect(page.getByRole("heading", { level: 1, name: "Microsoft Teams" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Microsoft Teams logo" })).toBeVisible();
  await page.getByRole("button", { name: "Link Microsoft organization" }).click();
  await expect(page).toHaveURL(/\/settings\/integrations\/teams$/, { timeout: 30_000 });
  await expect(page.getByText("Your Microsoft organization is linked")).toBeVisible();
  await expect(page.getByText("Harbour Films Ltd")).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Your Microsoft account" })
      .getByText(MICROSOFT_USER.displayName),
  ).toBeVisible();

  // The Teams app to upload: a zip with the manifest naming the dashboard's bot.
  const download = page.getByRole("link", { name: /Download the Teams app/ });
  const zip = await fetch((await download.getAttribute("href")) ?? "");
  expect(zip.status).toBe(200);
  const bytes = Buffer.from(await zip.arrayBuffer()).toString("latin1");
  expect(bytes).toContain("manifest.json");
  expect(bytes).toContain("stand-in-teams-bot");

  // Before the bot has been in a Teams team, there are no channels to pick.
  await expect(page.getByText(/mention the agent once/)).toBeVisible();

  // Someone writes to the agent in a Teams team; the agent server asks who they are.
  const asked = await fetch(`${CONVEX_SITE}/teams/person`, {
    method: "POST",
    headers: { authorization: `Bearer ${agentToken()}`, "content-type": "application/json" },
    body: JSON.stringify({
      tenantId: tenant,
      aadObjectId: userId,
      // A Teams team belongs to the first dashboard team that saw it, so each run is its own.
      teamId: `${TEAMS_TEAM.id}-${stamp}`,
      teamName: TEAMS_TEAM.name,
      serviceUrl: TEAMS_TEAM.serviceUrl,
    }),
  });
  expect(await asked.json()).toMatchObject({ ok: true, name: "Harbour Organizer" });

  // Now that team's channels show, and the owner picks one for alerts.
  await page.reload();
  const select = page.getByRole("combobox", { name: "Alerts" });
  await expect(select).toBeEnabled();
  await select.click();
  await page.getByRole("option", { name: `${TEAMS_TEAM.name} › Edits` }).click();
  await expect(page.getByText("Alerts go to Teams")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Alerts" })).toHaveText(
    `${TEAMS_TEAM.name} › Edits`,
  );

  // Settings, Notifications now has a Teams column.
  await page.goto("/settings/notifications");
  await expect(
    page.getByRole("switch", { name: "An approval is waiting for me: in Teams" }),
  ).toBeChecked();

  // A run reaches an Approval step; the card comes to the channel with its buttons.
  await page.goto("/automations");
  await page
    .getByLabel("Automation file to import")
    .setInputFiles("e2e/fixtures/weekly-clips.automation.json");
  await expect(page).toHaveURL(/\/automations\/.+/);
  await page.getByRole("switch").first().click();
  await expect(page.getByRole("switch").first()).toBeChecked();
  await page.locator(".react-flow__node-trigger").click();
  const address = await page.locator("#trigger-address").inputValue();
  const started = await fetch(address, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_url: `${FILES}/station-interview.webm` }),
  });
  expect(started.status).toBe(202);

  type Post = {
    path: string;
    method: string;
    body: { text?: string; attachments?: { content: Card }[] };
  };
  type Card = {
    body: { text: string }[];
    actions: { type: string; data?: { actionId: string; value: string } }[];
  };
  const posts = async () => (await (await fetch(`${MICROSOFT}/stand-in/posts`)).json()) as Post[];
  const cardOf = (post?: Post) => post?.body.attachments?.[0]?.content;
  await expect
    .poll(
      async () =>
        (await posts()).some((post) =>
          cardOf(post)?.actions.some((action) => action.data?.actionId === "ncat_alert_approve"),
        ),
      { timeout: 60_000 },
    )
    .toBe(true);
  const all = await posts();
  const index = all.findIndex((post) =>
    cardOf(post)?.actions.some((action) => action.data?.actionId === "ncat_alert_approve"),
  );
  const approval = all[index];
  expect(approval.path).toContain(encodeURIComponent("19:edits@thread.tacv2"));
  expect(cardOf(approval)!.body[0].text).toBe(
    "Weekly clips is waiting for your approval (Approval)",
  );
  const runStepId = cardOf(approval)!.actions[0].data!.value;

  // The owner presses Approve in Teams; the agent server hands the press to the dashboard.
  const pressed = await fetch(`${CONVEX_SITE}/teams/alert-action`, {
    method: "POST",
    headers: { authorization: `Bearer ${agentToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tenant, aadObjectId: userId, runStepId, decision: "approve" }),
  });
  expect(await pressed.json()).toEqual({ ok: true, message: "Approved." });

  // The card changes to say who approved, with no buttons left.
  // The stand-in numbers what it was sent, so this card is message number index + 1.
  const activityId = String(index + 1);
  await expect
    .poll(
      async () => {
        const edit = (await posts()).find(
          (post) => post.method === "PUT" && post.path.endsWith(`/activities/${activityId}`),
        );
        return cardOf(edit)?.body.map((block) => block.text) ?? [];
      },
      { timeout: 30_000 },
    )
    .toContain("Approved by Harbour Organizer.");
  const edit = (await posts()).find((post) => post.method === "PUT")!;
  expect(cardOf(edit)!.actions.map((action) => action.type)).toEqual(["Action.OpenUrl"]);

  // The waiting automation opened a review, and the channel heard about it.
  const texts = async () => (await posts()).map((post) => String(post.body.text ?? ""));
  expect((await texts()).join("\n")).toMatch(
    /New review: \[Weekly clips\]\(http:\/\/localhost:3000\/review\/[^)]+\) \(2 clips\)\. The automation is waiting for someone to approve it\./,
  );

  // A client comments through a share link; the comment starts its own Teams thread.
  await page.goto("/review");
  await page.getByRole("link", { name: /Weekly clips/ }).click();
  await expect(page).toHaveURL(/\/review\/.+/);
  await page.getByRole("button", { name: "Share" }).click();
  const dialog = page.getByRole("dialog", { name: "Share with a client" });
  await dialog.getByRole("button", { name: "Create link" }).click();
  const link = dialog.getByRole("textbox", { name: "Share link" });
  await expect(link).toHaveValue(/\/share\/[a-f0-9]{64}$/);
  const shareUrl = await link.inputValue();
  await page.keyboard.press("Escape");

  const client = await (await browser.newContext()).newPage();
  await client.goto(shareUrl);
  await client.getByLabel("Your name").fill("Riley Client");
  await client.getByRole("button", { name: "Continue" }).click();
  const box = client.getByRole("textbox", { name: /^Comment at this moment/ });
  await box.fill("Can the end card stay up a little longer?");
  await box.press("Enter");

  const channelPath = `/bot/v3/conversations/${encodeURIComponent("19:edits@thread.tacv2")}/activities`;
  let root = -1;
  await expect
    .poll(
      async () => {
        const all = await posts();
        root = all.findIndex(
          (post) =>
            post.path === channelPath &&
            String(post.body.text ?? "").startsWith("**Riley Client** (client) commented on"),
        );
        return root >= 0 ? String(all[root].body.text) : "";
      },
      { timeout: 30_000 },
    )
    .toMatch(/> Can the end card stay up a little longer\?$/);
  const rootActivityId = String(root + 1);

  // The owner answers in Teams, in that thread, without tagging the bot. The agent server
  // passes the message on, and it becomes their reply in the review room.
  const replied = await fetch(`${CONVEX_SITE}/teams/review-reply`, {
    method: "POST",
    headers: { authorization: `Bearer ${agentToken()}`, "content-type": "application/json" },
    body: JSON.stringify({
      tenantId: tenant,
      aadObjectId: userId,
      conversationId: "19:edits@thread.tacv2",
      rootActivityId,
      activityId: `teams-reply-${stamp}`,
      text: "<p>Sure, two more seconds.</p>",
    }),
  });
  expect(await replied.json()).toEqual({ handled: true, added: true, message: null });
  const comments = (on: typeof page) => on.locator('section[aria-label="Comments"]');
  const thread = comments(page).getByRole("listitem").filter({ hasText: "Can the end card" });
  await expect(thread.getByText("Sure, two more seconds.")).toBeVisible({ timeout: 30_000 });
  await expect(thread).toContainText("Harbour Organizer");
  await expect(comments(client).getByText("Sure, two more seconds.")).toBeVisible();

  // A reply written in the room goes the other way, into the Teams thread.
  await thread.getByRole("button", { name: "Reply" }).click();
  await page.getByRole("textbox", { name: "Reply" }).fill("Done, version 2 is up.");
  await page.getByRole("textbox", { name: "Reply" }).press("Enter");
  const threadPath = `/bot/v3/conversations/${encodeURIComponent(
    `19:edits@thread.tacv2;messageid=${rootActivityId}`,
  )}/activities`;
  const inThread = async () =>
    (await posts())
      .filter((post) => post.path === threadPath)
      .map((post) => String(post.body.text ?? ""));
  await expect
    .poll(async () => (await inThread()).join("\n"), { timeout: 30_000 })
    .toContain("**Harbour Organizer**: Done, version 2 is up.");
  // What came from Teams is not posted back to it.
  expect((await inThread()).join("\n")).not.toContain("Sure, two more seconds.");
  await client.context().close();
});
