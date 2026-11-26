import { expect, test } from "./test";

// A run where one branch fails and the other finishes, in a real browser against a real
// local backend and the stand-in toolkit: the run shows as partly done, not just failed,
// on the run page and in the automation's runs, and what the finished branch made is in Files.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";
const FILES = "http://127.0.0.1:8766";
// Set to a folder to keep screenshots, as sent with the pull request.
const SHOTS = process.env.PARTLY_SHOTS;

const failAt = (path: string | null) =>
  fetch(`${TOOLKIT}/__stand-in/fail`, { method: "POST", body: JSON.stringify({ path }) });

test.afterEach(async () => {
  await failAt(null);
});

test("a run whose thumbnail fails but whose trim finishes is partly done", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Rae Kim");
  await page.locator("#email").fill(`rae.partly.${stamp}@example.test`);
  await page.locator("#password").fill("partly-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Kim Talks");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/settings/toolkit");
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();

  await page.goto("/automations");
  await page
    .getByLabel("Automation file to import")
    .setInputFiles("e2e/fixtures/two-ways.automation.json");
  await expect(page).toHaveURL(/\/automations\/.+/);
  await page.getByRole("switch").first().click();
  await expect(page.getByRole("switch").first()).toBeChecked();
  await page.locator(".react-flow__node-trigger").click();
  const address = await page.locator("#trigger-address").inputValue();

  await failAt("/v1/video/thumbnail");
  const started = await fetch(address, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_url: `${FILES}/station-interview.webm` }),
  });
  expect(started.status).toBe(202);

  await page.getByRole("tab", { name: /Runs/ }).click();
  const runs = page.getByRole("tabpanel");
  await expect(runs.getByText("Partly done")).toBeVisible({ timeout: 90_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/Automation Runs.png` });

  await page
    .getByRole("link", { name: /^View run/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/runs\//);
  await expect(page.getByText("Partly done").first()).toBeVisible();
  await expect(
    page
      .getByRole("group")
      .filter({ hasText: "Video thumbnail" })
      .getByText("Failed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group").filter({ hasText: "Trim video" }).getByText("Done", { exact: true }),
  ).toBeVisible();
  if (SHOTS) {
    // Let the alert close, so the picture shows the run itself.
    // The alert closes on its own after 15 seconds.
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/Run Page.png`, fullPage: true });
  }

  // What the trim made is kept in Files.
  await page.goto("/files");
  await page.getByRole("button", { name: "Finished", exact: true }).click({ timeout: 60_000 });
  await page.getByRole("button", { name: "Two ways", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "tighter-cut" })).toBeVisible({
    timeout: 30_000,
  });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/Files.png` });
});
