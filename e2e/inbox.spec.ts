import { type Browser, expect, type Page, test } from "@playwright/test";

// The Inbox, in a real browser against a real backend: news about runs and reviews is
// counted beside Inbox in the menu, pops up once as it arrives, and is listed on its own
// page by day, with views for what needs you, failed runs and mentions.

const TOOLKIT = "http://127.0.0.1:8767";
const FILES = "http://127.0.0.1:8766";
const PASSWORD = "inbox-e2e-1";
const stamp = Date.now().toString(36);
const emailOf = (name: string) => `${name}.${stamp}@example.test`;
// RECORD_VIDEO=dir keeps a recording of each person's window, for showing the feature.
const RECORD = process.env.RECORD_VIDEO;

async function signUp(browser: Browser, name: string, email: string): Promise<Page> {
  const context = await browser.newContext(
    RECORD ? { recordVideo: { dir: RECORD, size: { width: 1440, height: 900 } } } : {},
  );
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

const inbox = (page: Page) => page.getByRole("link", { name: /^Inbox/ });
const count = (page: Page) => inbox(page).locator("[data-alerts-count]");
const commentBox = (page: Page) => page.getByRole("textbox", { name: /^Comment at this moment/ });
const pause = (page: Page) => page.waitForTimeout(RECORD ? 1500 : 0);

test.describe.configure({ mode: "serial" });

let jordan: Page;
let maya: Page;

test.beforeAll(async ({ browser }) => {
  jordan = await signUp(browser, "Jordan Lee", emailOf("jordan"));
  await jordan.getByPlaceholder("Your company or channel").fill("Salt House");
  await jordan.getByRole("button", { name: "Create team" }).click();
  await jordan.locator("#baseUrl").fill(TOOLKIT);
  await jordan.locator("#apiKey").fill("stand-in-key-1234");
  await jordan.getByRole("button", { name: "Test and connect" }).click();
  await expect(jordan.getByText(/Your toolkit answered/)).toBeVisible();

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

test("an empty Inbox says what will show up there", async () => {
  await maya.goto("/");
  await expect(inbox(maya)).toBeVisible();
  await expect(count(maya)).toHaveCount(0);
  await inbox(maya).click();
  await expect(maya).toHaveURL(/\/inbox$/);
  await expect(maya.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(maya.getByText(/Nothing to report/)).toBeVisible();
  await pause(maya);
  // No bell is left in the top bar: the Inbox is the one place for news.
  await expect(maya.locator("header").getByRole("button", { name: /Alerts/ })).toHaveCount(0);
  await maya.goto("/automations");
});

test("news is counted beside Inbox and pops up once as it arrives", async () => {
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

  // Anyone on the team may approve, so Maya is asked too.
  await expect(count(maya)).toHaveText("1", { timeout: 60_000 });
  await expect(maya.getByText("Weekly clips is waiting for your approval")).toBeVisible();
  await pause(maya);

  await jordan.goto("/review");
  await jordan.getByRole("link", { name: /Weekly clips/ }).click();
  await expect(jordan).toHaveURL(/\/review\/.+/);
  await commentBox(jordan).pressSequentially("@Ma");
  await jordan.getByRole("option", { name: /Maya Ortiz/ }).click();
  await commentBox(jordan).pressSequentially("can you check the logo here?");
  await commentBox(jordan).press("Enter");
  await expect(count(maya)).toHaveText("2", { timeout: 30_000 });
  await pause(maya);
});

test("the Inbox lists it by day, with a view for each kind", async () => {
  await inbox(maya).click();
  await expect(maya).toHaveURL(/\/inbox$/);
  const today = maya.getByRole("region", { name: "Today" });
  await expect(today.locator("[data-alert-kind]")).toHaveCount(2);
  await expect(today.locator("[data-alert-kind=mention]")).toContainText(
    "Jordan Lee mentioned you in Weekly clips",
  );
  await expect(maya.getByRole("tab", { name: /^All\W+2 new$/ })).toBeVisible();
  await pause(maya);

  await maya.getByRole("tab", { name: /^Needs you/ }).click();
  await expect(maya.locator("[data-alert-kind]")).toHaveCount(1);
  await expect(maya.locator("[data-alert-kind=approval_waiting]")).toBeVisible();
  await pause(maya);
  await maya.getByRole("tab", { name: /^Mentions and feedback/ }).click();
  await expect(maya.locator("[data-alert-kind]")).toHaveCount(1);
  await pause(maya);
  await maya.getByRole("tab", { name: /^All/ }).click();
});

test("one is marked as seen in place, and opening another goes where it happened", async () => {
  await maya.getByRole("button", { name: /^Mark as seen: Weekly clips is waiting/ }).click();
  await expect(count(maya)).toHaveText("1");
  await expect(maya.locator("[data-alert-kind=approval_waiting]")).toHaveAttribute(
    "data-alert",
    "seen",
  );
  await pause(maya);

  await maya.locator("[data-alert-kind=mention]").click();
  await expect(maya).toHaveURL(/\/review\/.+\?clip=.+&comment=.+/);
  await expect(count(maya)).toHaveCount(0);
  await pause(maya);
});

test("with the menu folded away, a dot on its button says there is news", async () => {
  await commentBox(jordan).pressSequentially("@Ma");
  await jordan.getByRole("option", { name: /Maya Ortiz/ }).click();
  await commentBox(jordan).pressSequentially("and the music at the end, please.");
  await commentBox(jordan).press("Enter");
  await expect(count(maya)).toHaveText("1", { timeout: 30_000 });

  await maya.getByRole("button", { name: "Toggle Sidebar" }).click();
  await expect(maya.locator("[data-inbox-dot]")).toBeVisible();
  await pause(maya);
  await maya.getByRole("button", { name: "Toggle Sidebar" }).click();
  await expect(maya.locator("[data-inbox-dot]")).toHaveCount(0);
  await inbox(maya).click();
  await maya.getByRole("button", { name: "Mark all as seen" }).click();
  await expect(count(maya)).toHaveCount(0);
  await expect(maya.getByRole("button", { name: "Mark all as seen" })).toHaveCount(0);
  await pause(maya);
});
