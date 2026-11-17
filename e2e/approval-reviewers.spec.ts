import { type Browser, expect, type Page, test } from "@playwright/test";

// Picking who reviews an Approval step, in a real browser against a real backend: the
// owner names one teammate and a time limit, the run stops there, only that teammate is
// told under the bell, a third teammate cannot decide, and the named one approves.

const TOOLKIT = "http://127.0.0.1:8767";
const FILES = "http://127.0.0.1:8766";
const PASSWORD = "approval-e2e-1";
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

test.describe.configure({ mode: "serial" });

let jordan: Page;
let maya: Page;
let sam: Page;
let runPath: string;

test.beforeAll(async ({ browser }) => {
  jordan = await signUp(browser, "Jordan Lee", emailOf("jordan"));
  await jordan.getByPlaceholder("Your company or channel").fill("Salt House");
  await jordan.getByRole("button", { name: "Create team" }).click();
  await jordan.locator("#baseUrl").fill(TOOLKIT);
  await jordan.locator("#apiKey").fill("stand-in-key-1234");
  await jordan.getByRole("button", { name: "Test and connect" }).click();
  await expect(jordan.getByText(/Your toolkit answered/)).toBeVisible();

  const [team] = await auth<{ id: string }[]>(jordan, "organization/list");
  const join = async (name: string, short: string) => {
    const page = await signUp(browser, name, emailOf(short));
    const invitation = await auth<{ id: string }>(jordan, "organization/invite-member", {
      email: emailOf(short),
      role: "member",
      organizationId: team.id,
    });
    await auth(page, "organization/accept-invitation", { invitationId: invitation.id });
    await auth(page, "organization/set-active", { organizationId: team.id });
    return page;
  };
  maya = await join("Maya Ortiz", "maya");
  sam = await join("Sam Park", "sam");
});

test.afterAll(async () => {
  for (const page of [jordan, maya, sam]) await page?.context().close();
});

test("the owner names a reviewer and a time limit on the Approval step", async () => {
  await jordan.goto("/automations");
  await jordan
    .getByLabel("Automation file to import")
    .setInputFiles("e2e/fixtures/weekly-clips.automation.json");
  await expect(jordan).toHaveURL(/\/automations\/.+/);

  const step = jordan.locator(".react-flow__node").filter({ hasText: "Approval" });
  await expect(step).toContainText("Anyone on the team");
  await step.click();
  await expect(jordan.getByText(/Nobody picked, so anyone on the team can approve/)).toBeVisible();
  await jordan.getByRole("checkbox", { name: /Maya Ortiz/ }).click();
  await expect(
    jordan.getByText(/Only Maya Ortiz can approve, plus team owners and admins/),
  ).toBeVisible();
  await jordan.getByRole("switch", { name: /Decide by itself/ }).click();
  await expect(jordan.getByLabel("If nobody decides within")).toHaveValue("24");
  await expect(step).toContainText("1 reviewer · 24 hours");

  await jordan.getByRole("button", { name: "Save", exact: true }).click();
  await expect(jordan.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
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
});

test("only the named reviewer is told under the bell", async () => {
  await maya.goto("/automations");
  await expect(bell(maya).locator("[data-alerts-count]")).toHaveText("1", { timeout: 60_000 });
  await bell(maya).click();
  const alert = maya.getByRole("link", { name: /Weekly clips is waiting for your approval/ });
  await expect(alert).toContainText("If nobody decides within 24 hours, it is rejected by itself.");
  runPath = (await alert.getAttribute("href"))!;
  await expect(maya.getByText("Asks you")).toBeVisible();

  await sam.goto("/automations");
  await expect(sam.getByText("Waiting for approval")).toBeVisible();
  await expect(bell(sam).locator("[data-alerts-count]")).toHaveCount(0);
  await bell(sam).click();
  await expect(sam.getByText(/Nothing to report/)).toBeVisible();
});

test("a teammate who was not asked cannot decide", async () => {
  await sam.goto(runPath);
  const card = sam.locator("[data-step=approval]");
  await expect(card.getByText("Maya Ortiz is asked to decide.")).toBeVisible();
  await expect(
    card.getByText("Only Maya Ortiz, or a team owner or admin, can decide this one."),
  ).toBeVisible();
  await expect(card.getByRole("button", { name: "Approve" })).toBeDisabled();
  await expect(card.getByRole("button", { name: "Reject" })).toBeDisabled();
});

test("the reviewer approves and the run finishes", async () => {
  await maya.goto(runPath);
  const card = maya.locator("[data-step=approval]");
  await expect(card.getByText("You are asked to decide.")).toBeVisible();
  await expect(card.getByText(/If nobody decides by .+, it is rejected by itself\./)).toBeVisible();
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card.getByText("Approved by Maya Ortiz.")).toBeVisible();
  await expect(
    sam.locator("[data-step=approval]").getByText("Approved by Maya Ortiz."),
  ).toBeVisible();
  // The alert asking Maya to decide is gone.
  await expect(bell(maya).locator("[data-alerts-count]")).toHaveCount(0);
});
