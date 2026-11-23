import { expect, test } from "./test";

// Check Footage in a real browser against a real backend: both UGC ready-mades that start
// from creators' folders check every take first, the step says what it wants and what it
// does when something is wrong, and it can be added first to any automation.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";
if (process.env.RECORD_VIDEO === "1") {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 250 },
  });
}
const pause = (ms: number) =>
  process.env.RECORD_VIDEO === "1" ? new Promise((done) => setTimeout(done, ms)) : null;

test("checks creator footage before editing", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Rae Kim");
  await page.locator("#email").fill(`rae.footage.${stamp}@example.test`);
  await page.locator("#password").fill("footage-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Kim UGC");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({ timeout: 30_000 });
  await page.goto("/settings/toolkit");
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();

  // The creator folders ready-made checks every take first.
  await page.goto("/automations/new");
  await page.getByLabel("Find a ready-made automation").fill("creator folders");
  await expect(page.getByText(/every take is checked \(vertical, sharp enough/)).toBeVisible();
  await pause(2000);
  await page.getByText("UGC Ad Variants From Creator Folders", { exact: true }).click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  const check = page.locator(".react-flow__node-step").filter({ hasText: "Check Footage" });
  await expect(check).toContainText("Vertical, stops on a problem");
  await pause(1500);

  await expect(async () => {
    await check.click();
    await expect(page.getByRole("combobox", { name: "Filmed in" })).toBeVisible({
      timeout: 2000,
    });
  }).toPass();
  const panel = page.getByRole("complementary", { name: "Settings for this step" });
  await expect(panel.getByRole("combobox", { name: "Filmed in" })).toContainText("Vertical");
  await expect(
    panel.getByText(/each hook and ending take, measured by your toolkit/),
  ).toBeVisible();
  await expect(panel.getByText(/Nothing is edited until better footage lands/)).toBeVisible();
  await pause(1500);
  await panel.getByRole("textbox", { name: "Short side at least" }).fill("1080");
  await pause(800);
  await panel.getByRole("combobox", { name: "When something is wrong" }).click();
  await page.getByRole("option", { name: "Tell the team and keep going" }).click();
  await expect(check).toContainText("Vertical, tells, then edits");
  await pause(2000);

  // On any automation, it is a step to add first.
  await page.goto("/automations");
  await page.getByRole("link", { name: "New automation", exact: true }).click();
  await page.getByRole("button", { name: "Empty canvas" }).first().click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByLabel("Search steps").fill("footage");
  await pause(1200);
  await page
    .getByRole("complementary", { name: "Steps you can add" })
    .getByRole("button", { name: "Check Footage", exact: true })
    .click();
  await expect(
    page
      .getByRole("complementary", { name: "Settings for this step" })
      .getByRole("combobox", { name: "When something is wrong" }),
  ).toContainText("Stop before editing");
  await pause(2500);
});
