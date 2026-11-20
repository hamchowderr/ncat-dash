import { expect, test } from "./test";

// Clean Up Pauses And Retakes in a real browser against a real backend: both ready-mades
// are in the one list, the UGC one starts from creators' folders and splits the hook takes
// the creator names, and the step can be added to any automation and set up in its panel.

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

test("cleans up pauses and retakes before editing, splitting hook takes for UGC", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Jo Park");
  await page.locator("#email").fill(`jo.cleanup.${stamp}@example.test`);
  await page.locator("#password").fill("cleanup-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Park UGC");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: /Yes, I Have One/ }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  // Both are in the one list of ready-mades.
  await page.goto("/automations/new");
  await page.getByLabel("Find a ready-made automation").fill("retakes");
  await expect(page.getByText("Clean Up Pauses And Retakes", { exact: true })).toBeVisible();
  await expect(page.getByText("Clean Up Takes For UGC Ads", { exact: true })).toBeVisible();
  await pause(2500);

  await page.getByText("Clean Up Takes For UGC Ads", { exact: true }).click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  await expect(page.getByText("Splits hook takes you name")).toBeVisible();
  await pause(1500);

  // It starts from the raw takes folder, one folder per creator.
  await page.locator(".react-flow__node-trigger").click();
  await expect(page.getByText("raw-takes/").first()).toBeVisible();
  await pause(1500);

  // The step says how to name hook takes, and keeps a creator's files together.
  await expect(async () => {
    await page.locator(".react-flow__node-step").first().click();
    await expect(page.getByRole("combobox", { name: "Hook takes" })).toBeVisible({
      timeout: 2000,
    });
  }).toPass();
  const panel = page.getByRole("complementary", { name: "Settings for this step" });
  await expect(panel.getByRole("combobox", { name: "Hook takes" })).toContainText(
    "When the creator says them",
  );
  await expect(panel.getByText(/Say “hook one”, “hook two”/)).toBeVisible();
  await expect(panel.getByText("where the toolkit hears silence in the video")).toBeVisible();
  await pause(1500);
  await panel.getByRole("textbox", { name: "Take down pauses over" }).fill("0.8");
  await pause(800);
  await panel.getByRole("textbox", { name: "Creator" }).fill("Jane Doe");
  await pause(2000);

  // On any automation, it is a step to add first.
  await page.goto("/automations");
  await page.getByRole("link", { name: "New automation", exact: true }).click();
  await page.getByRole("button", { name: "Empty canvas" }).first().click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByLabel("Search steps").fill("retakes");
  await pause(1200);
  await page
    .getByRole("complementary", { name: "Steps you can add" })
    .getByRole("button", { name: "Clean Up Pauses And Retakes", exact: true })
    .click();
  await page
    .getByRole("complementary", { name: "Settings for this step" })
    .getByRole("combobox", { name: "Hook takes" })
    .click();
  await page.getByRole("option", { name: "No hooks, one video" }).click();
  await expect(page.getByText("One cleaned video", { exact: true })).toBeVisible();
  await pause(2500);
});
