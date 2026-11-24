import { type Browser, expect, type Page, test } from "./test";

// Notification settings in a real browser against a real backend: a member switches
// mentions and approvals off in the Inbox, so a teammate's @mention and a waiting
// approval stay out of their bell; switched back on, the next mention shows up and opens
// the review at its thread. The daily summary and its hour are kept across a reload.

const TOOLKIT = "http://127.0.0.1:8767";
const FILES = "http://127.0.0.1:8766";
const PASSWORD = "notifications-e2e-1";
const stamp = Date.now().toString(36);
const emailOf = (name: string) => `${name}.${stamp}@example.test`;

async function signUp(browser: Browser, name: string, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/sign-up");
  await page.locator("#name").fill(name);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  return page;
}

async function auth<T>(page: Page, path: string, body?: unknown): Promise<T> {
  return await page.evaluate(
    async ([path, body]) => {
      const response = await fetch(`/api/auth/${path}`, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      return await response.json();
    },
    [path, body] as const,
  );
}

const bell = (page: Page) => page.locator("[data-alerts-bell]");
const card = (page: Page) => page.locator("#notifications");
const commentBox = (page: Page) => page.getByRole("textbox", { name: /^Comment at this moment/ });

test.describe.configure({ mode: "serial" });

let jordan: Page;
let maya: Page;
let roomUrl: string;

test.beforeAll(async ({ browser }) => {
  jordan = await signUp(browser, "Jordan Lee", emailOf("jordan"));
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

  const [team] = await auth<{ id: string }[]>(jordan, "organization/list");
  maya = await signUp(browser, "Maya Ortiz", emailOf("maya"));
  const invitation = await auth<{ id: string }>(jordan, "organization/invite-member", {
    email: emailOf("maya"),
    role: "member",
    organizationId: team.id,
  });
  await auth(maya, "organization/accept-invitation", { invitationId: invitation.id });
  await auth(maya, "organization/set-active", { organizationId: team.id });
});

test.afterAll(async () => {
  for (const page of [jordan, maya]) await page?.context().close();
});

test("each member sees every kind of news with a bell and an email switch", async () => {
  await maya.goto("/settings/notifications");
  await expect(maya.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
  const rows = card(maya).locator("[data-notification]");
  await expect(rows).toHaveCount(10);
  await expect(card(maya).getByRole("switch", { name: /in the Inbox/ })).toHaveCount(10);
  await expect(card(maya).getByRole("switch", { name: /by email/ })).toHaveCount(10);
  // Every kind starts on, except finished runs, which start off for the bell and email.
  for (const name of [/: in the Inbox$/, /: by email$/]) {
    for (const toggle of await card(maya).getByRole("switch", { name }).all()) {
      const finished = (await toggle.getAttribute("aria-label"))?.startsWith(
        "A run finishes with new files",
      );
      if (finished) await expect(toggle).not.toBeChecked();
      else await expect(toggle).toBeChecked();
    }
  }
  // The old per-person switches in the Email card are gone; it points here instead.
  await expect(maya.locator("text=Email me when a run fails")).toHaveCount(0);
});

test("a member chooses a daily summary at an hour of theirs, and it is kept", async () => {
  await card(maya).getByRole("switch", { name: "One summary email a day" }).click();
  await expect(card(maya).getByText("Send it at")).toBeVisible();
  await card(maya).getByRole("combobox").click();
  await maya.getByRole("option", { name: "6 PM" }).click();
  await expect(card(maya).getByRole("combobox")).toHaveText("6 PM");
  await expect(
    card(maya).getByText(/Emailed straight away even with a daily summary/),
  ).toBeVisible();

  await maya.reload();
  await expect(card(maya).getByRole("switch", { name: "One summary email a day" })).toBeChecked();
  await expect(card(maya).getByRole("combobox")).toHaveText("6 PM");
});

test("with mentions and approvals off in the Inbox, neither shows up there", async () => {
  for (const name of [
    "Someone mentions me in a review: in the Inbox",
    "An approval is waiting for me: in the Inbox",
  ]) {
    const toggle = card(maya).getByRole("switch", { name });
    await toggle.click();
    await expect(toggle).not.toBeChecked();
  }

  // Jordan runs an automation that stops at an approval step, which opens a review room.
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

  // Jordan kept the defaults, so the approval is under Jordan's bell.
  await expect(bell(jordan).locator("[data-alerts-count]")).toHaveText("1", { timeout: 60_000 });

  await jordan.goto("/review");
  await jordan.getByRole("link", { name: /Weekly clips/ }).click();
  await expect(jordan).toHaveURL(/\/review\/.+/);
  roomUrl = jordan.url();
  await commentBox(jordan).pressSequentially("@Ma");
  await jordan.getByRole("option", { name: /Maya Ortiz/ }).click();
  await commentBox(jordan).pressSequentially("can you check the logo here?");
  await commentBox(jordan).press("Enter");
  await expect(jordan.getByText("can you check the logo here?")).toBeVisible();

  // Give the mention time to arrive, then check Maya's bell stayed empty. Settings have
  // their own menu, so she goes back to the app, where Inbox is in the menu.
  await maya.waitForTimeout(2_000);
  await maya.getByRole("link", { name: "Back to app" }).click();
  await expect(bell(maya)).toBeVisible();
  await expect(bell(maya).locator("[data-alerts-count]")).toHaveCount(0);
  await bell(maya).click();
  await expect(maya.getByText(/Nothing to report/)).toBeVisible();
  await maya.goto("/settings/notifications");
});

test("switched back on, the next mention shows up and opens the review at its thread", async () => {
  await card(maya)
    .getByRole("switch", { name: "Someone mentions me in a review: in the Inbox" })
    .click();
  // The earlier mention is shown again now that she wants mentions in the Inbox.
  await maya.getByRole("link", { name: "Back to app" }).click();
  await expect(bell(maya).locator("[data-alerts-count]")).toHaveText("1");

  await commentBox(jordan).pressSequentially("@Ma");
  await jordan.getByRole("option", { name: /Maya Ortiz/ }).click();
  await commentBox(jordan).pressSequentially("and the music at the end, please.");
  await commentBox(jordan).press("Enter");
  await expect(bell(maya).locator("[data-alerts-count]")).toHaveText("2");

  await bell(maya).click();
  const latest = maya.locator("[data-alert-kind=mention]").first();
  await expect(latest).toContainText("Jordan Lee mentioned you in Weekly clips");
  await expect(latest).toContainText("and the music at the end, please.");
  await latest.click();
  await expect(maya).toHaveURL(new RegExp(`${new URL(roomUrl).pathname}\\?clip=.+&comment=.+`));
  await expect(bell(maya).locator("[data-alerts-count]")).toHaveText("1");
});
