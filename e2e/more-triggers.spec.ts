import { expect, type Page, test } from "./test";

// Several triggers on one automation's canvas, in a real browser against a real backend:
// adding a second trigger, giving it its own step, running only its steps, and removing it.

const stamp = Date.now().toString(36);
// RECORD_VIDEO=1 keeps a screen recording of the run, slowed down so it can be followed.
if (process.env.RECORD_VIDEO === "1") {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 350 },
  });
}

async function pickStep(page: Page, title: string) {
  await page.getByLabel("Search steps").fill(title);
  await page
    .getByRole("complementary", { name: "Steps you can add" })
    .getByRole("button", { name: title, exact: true })
    .click();
  // Turned off, it finishes at once, so the run needs no toolkit.
  await page.getByRole("switch", { name: "Turn this step off" }).click();
}

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("one automation with two triggers, each running its own steps", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Ira Banks");
  await page.locator("#email").fill(`ira.triggers.${stamp}@example.test`);
  await page.locator("#password").fill("more-triggers-e2e-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Two Door Studio");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Do You Have A Toolkit?" })).toBeVisible();

  await page.goto("/automations");
  await page.getByRole("link", { name: "New automation", exact: true }).click();
  await page.getByRole("button", { name: "Empty canvas" }).first().click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  await page.getByLabel("Automation name").fill("Two ways in");

  // The first trigger starts Caption video.
  await page.getByRole("button", { name: "Add step" }).click();
  await pickStep(page, "Caption video");

  // A second trigger, with its own step.
  await page.getByRole("button", { name: "Add trigger" }).click();
  const panel = page.getByRole("complementary", { name: "Settings for this step" });
  await expect(panel.getByRole("heading", { name: "Trigger 2" })).toBeVisible();
  await pick(page, "What starts it", "Webhook");
  await expect(panel.getByText("Nothing yet.")).toBeVisible();
  await expect(page.locator(".react-flow__node-trigger")).toHaveCount(2);
  await page.waitForTimeout(800);
  await panel.getByRole("button", { name: "Add a step after it" }).click();
  await pickStep(page, "Trim video");

  await page.locator('[data-node="__trigger_2"]').click();
  await expect(panel.getByText("Trim video", { exact: true })).toBeVisible();
  // Each trigger draws its own line.
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  await page.waitForTimeout(1000);

  // Run now runs only the steps of the trigger picked.
  await page.getByRole("button", { name: "Run now" }).click();
  await pick(page, "Run the steps of", "Trigger 2: Webhook");
  await page.getByRole("button", { name: "Run without a file" }).click();
  await expect(page).toHaveURL(/\/runs\/[a-z0-9]+$/, { timeout: 30_000 });
  await expect(page.locator(".react-flow__node-step")).toHaveCount(1);
  await expect(page.locator(".react-flow__node-step")).toContainText("Trim video");
  await page.waitForTimeout(1500);

  // Removing the second trigger leaves its step for the first to start.
  await page.goBack();
  await page.locator('[data-node="__trigger_2"]').click();
  await panel.getByRole("button", { name: "Remove trigger" }).click();
  await expect(page.locator(".react-flow__node-trigger")).toHaveCount(1);
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  await page.waitForTimeout(1000);
});
