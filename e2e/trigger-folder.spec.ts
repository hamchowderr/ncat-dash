import { expect, test } from "./test";

// The watched-folder trigger, in a real browser: the folder is picked from the bucket,
// or made there, and nobody types a path. The bucket is the stand-in toolkit's, and the
// team only sees its own folder in it, shown as "Your files".

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";

test("the watched folder is picked from the bucket", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Rae Okafor");
  await page.locator("#email").fill(`rae.${stamp}@example.test`);
  await page.locator("#password").fill("trigger-folder-e2e-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Folder Shop");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/settings/toolkit");
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();

  await page.goto("/automations/new");
  await page.getByRole("button", { name: /Vertical and captioned from a watched folder/ }).click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  await page.locator(".react-flow__node-trigger").click();

  // The starter watches incoming/, shown by name with nothing to type.
  const panel = page.locator("aside");
  await expect(panel.getByText("Your files/incoming/")).toBeVisible();
  await expect(panel.getByRole("textbox")).toHaveCount(0);

  // Walks to podcast/raw/ and watches it.
  await panel.getByRole("button", { name: "Folder" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Your files", exact: true }).click();
  await dialog.getByRole("button", { name: "podcast" }).click();
  await dialog.getByRole("button", { name: "raw" }).click();
  await dialog.getByRole("button", { name: "Watch raw" }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByText("Your files/podcast/raw/")).toBeVisible();

  // A new folder is made in the bucket and watched.
  await panel.getByRole("button", { name: "Folder" }).click();
  await dialog.getByRole("button", { name: "New folder in raw" }).click();
  await dialog.getByLabel("New folder name").fill("week 12");
  await dialog.getByRole("button", { name: "Make it" }).click();
  await dialog.getByRole("button", { name: "Watch week 12" }).click();
  await expect(panel.getByText("Your files/podcast/raw/week 12/")).toBeVisible();

  // It is saved with the automation.
  await page.getByRole("button", { name: /^Save( draft)?$/ }).click();
  await expect(page.getByRole("button", { name: /^(Saved|Draft saved)$/ })).toBeVisible();
  await page.reload();
  await page.locator(".react-flow__node-trigger").click();
  await expect(page.locator("aside").getByText("Your files/podcast/raw/week 12/")).toBeVisible();
});
