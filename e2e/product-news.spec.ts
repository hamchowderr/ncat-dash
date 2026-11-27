import { execSync } from "node:child_process";

import { type Browser, expect, type Page, test } from "./test";

// Product news and announcements in a real browser against a real backend, with toSend
// played by e2e/tosend-stand-in.mjs: sign-up never asks about product news; a customer
// turns it on in Settings; the operator (OPERATOR_EMAILS) finds them on Subscribers with
// the words they agreed to, writes an email, sends a test, sends it, and sees it on Sent
// Emails; the customer's one-click unsubscribe is counted there.

const TOSEND = "http://127.0.0.1:8775";
const PASSWORD = "product-news-e2e-1";
const stamp = Date.now().toString(36);
const OPERATOR = `operator.${stamp}@example.test`;
const CUSTOMER = `rosa.${stamp}@example.test`;
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

type Email = {
  to: { email: string }[];
  subject: string;
  text: string;
  headers?: Record<string, string>;
};

const env = (name: string, value?: string) =>
  execSync(value ? `npx convex env set ${name} ${value}` : `npx convex env remove ${name}`, {
    stdio: "ignore",
  });

async function sent(): Promise<Email[]> {
  return (await (await fetch(`${TOSEND}/stand-in/sent`)).json()) as Email[];
}

async function signUp(
  browser: Browser,
  name: string,
  email: string,
  team: string,
): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/sign-up");
  await page.locator("#name").fill(name);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill(team);
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({
    timeout: 30_000,
  });
  return page;
}

test.describe.configure({ mode: "serial" });

let operator: Page;
let customer: Page;

test.beforeAll(async ({ browser }) => {
  env("TOSEND_API_URL", TOSEND);
  env("TOSEND_API_KEY", "tsend_stand_in");
  env("EMAIL_FROM", "news@example.test");
  env("OPERATOR_EMAILS", OPERATOR);
  customer = await signUp(browser, "Rosa Lin", CUSTOMER, "Lin Studio");
  operator = await signUp(browser, "Opal Grant", OPERATOR, "Back Office");
  // Only a confirmed address counts as the operator; these tests don't confirm by email.
  execSync("npx convex run access:confirmExistingEmails", { stdio: "ignore" });
});

test.afterAll(async () => {
  for (const page of [operator, customer]) await page?.context().close();
  for (const name of ["TOSEND_API_URL", "TOSEND_API_KEY", "EMAIL_FROM", "OPERATOR_EMAILS"])
    env(name);
});

test("product news starts off, the customer turns it on in Settings, and only the operator sees Admin", async () => {
  await customer.goto("/settings/notifications");
  const toggle = customer.getByRole("switch", { name: "Product news" });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(customer.getByText(/On since/)).toBeVisible();
  await customer.goto("/");
  await expect(customer.getByRole("link", { name: "Sent Emails" })).toHaveCount(0);
  await customer.goto("/admin/subscribers");
  await expect(customer.getByText(/Only the people who run this copy/)).toBeVisible();

  await operator.goto("/");
  await expect(operator.getByRole("link", { name: "Send An Email" })).toBeVisible();
});

test("Subscribers finds the customer, with when and where they agreed", async () => {
  await operator.goto("/admin/subscribers");
  await operator.getByRole("textbox", { name: "Search by email" }).fill(`rosa.${stamp}`);
  const row = operator
    .getByRole("link", { name: new RegExp(CUSTOMER) })
    .or(operator.getByRole("button", { name: new RegExp(CUSTOMER) }));
  await expect(row.first()).toBeVisible();
  await row.first().click();
  await expect(operator.getByText("Agreed · Settings")).toBeVisible();
  await expect(
    operator.getByText(/Product news: new features and tips, a few times a month at most\./),
  ).toBeVisible();
});

test("the operator writes, previews, tests and sends an email", async () => {
  await operator.goto("/admin/emails/new");
  await operator.getByLabel("Subject").fill(`New: Best Moments ${stamp}`);
  await operator.getByLabel("Message").fill("Takewon finds the best parts.\n\nTry it today.");
  const preview = operator.frameLocator("iframe[title='Email preview']");
  await expect(preview.getByText("Try it today.")).toBeVisible();
  await expect(preview.getByText("Unsubscribe")).toBeVisible();

  await operator.getByRole("button", { name: "Send me a test" }).click();
  await expect(operator.getByText(`Test sent to ${OPERATOR}.`)).toBeVisible();
  await expect
    .poll(async () =>
      (await sent()).some((email) => email.subject === `[Test] New: Best Moments ${stamp}`),
    )
    .toBe(true);

  await operator.getByRole("button", { name: "Send", exact: true }).click();
  await operator.getByRole("alertdialog").getByRole("button", { name: "Send" }).click();
  await expect(operator).toHaveURL(/\/admin\/emails\/[a-z0-9]+$/);
  await expect(operator.getByText("Sent", { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(async () =>
      (await sent()).some(
        (email) => email.to[0].email === CUSTOMER && email.subject === `New: Best Moments ${stamp}`,
      ),
    )
    .toBe(true);
});

test("the customer's one-click unsubscribe is counted on Sent Emails", async () => {
  const email = (await sent()).find(
    (entry) => entry.to[0].email === CUSTOMER && entry.subject === `New: Best Moments ${stamp}`,
  )!;
  expect(email.text).toContain("You get this because you asked for Takewon product news.");
  const link = email.headers!["List-Unsubscribe"].replace(/^<|>$/g, "");
  const answer = await fetch(link, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "List-Unsubscribe=One-Click",
  });
  expect(answer.status).toBe(200);

  const unsubscribed = operator.locator("dt", { hasText: "Unsubscribed" }).locator("+ dd");
  await expect(unsubscribed).toHaveText("1");
  await operator.goto("/admin/emails");
  await expect(operator.getByText(new RegExp(`New: Best Moments ${stamp}`))).toBeVisible();
  await expect(operator.getByText(/Sent to \d+.*1 unsubscribed/).first()).toBeVisible();

  await customer.goto("/settings/notifications");
  await expect(customer.getByRole("switch", { name: "Product news" })).not.toBeChecked();
});

test("the Admin pages fit a phone", async ({ browser }) => {
  const page = await (await browser.newContext(PHONE)).newPage();
  await page.goto("/sign-in");
  await page.locator("#email").fill(OPERATOR);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
  for (const path of ["/admin/emails/new", "/admin/emails", "/admin/subscribers"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const wide = await page.evaluate(() => document.scrollingElement!.scrollWidth > innerWidth + 1);
    expect(wide, `${path} scrolls sideways`).toBe(false);
  }
  await page.context().close();
});
