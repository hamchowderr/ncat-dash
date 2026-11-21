import { execSync } from "node:child_process";

import { expect, test } from "./test";

// Creator usage rights in a real browser: a team sets the last day it may use a creator's
// footage in Settings > Creators, and a week before that day the daily check puts an
// alert in everyone's Inbox (and their chat apps), linking back to Creators.

const stamp = Date.now().toString(36);

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

test("a creator's end date is kept, and the team hears a week before it", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Rae Okafor");
  await page.locator("#email").fill(`rights.${stamp}@example.test`);
  await page.locator("#password").fill("rights-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Okafor Ads");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: /Yes, I Have One/ }).click();
  await page.locator("#baseUrl").fill("http://127.0.0.1:8767");
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  await page.goto("/settings/creators");
  await expect(page.getByRole("heading", { name: "Creators" })).toBeVisible();
  await expect(page.getByText(/No end dates yet/)).toBeVisible();

  const creator = `Ana ${stamp}`;
  await page.getByRole("textbox", { name: "Creator" }).fill(creator);
  await page.getByLabel("Last day of use").fill(daysFromNow(3));
  await page.getByLabel(/Note/).fill("Paid on Meta");
  await page.getByRole("button", { name: "Add creator" }).click();
  const row = page.locator(`[data-creator="${creator}"]`);
  await expect(row).toBeVisible();
  await expect(row.getByText(/Last day .*, in 3 days/)).toHaveAttribute("data-tone", "soon");
  await expect(row.getByText("Paid on Meta")).toBeVisible();

  // The daily check, run now.
  execSync("npx convex run creatorRights:checkEnding", { stdio: "pipe" });
  await page.goto("/inbox");
  const alert = page.getByRole("link", {
    name: new RegExp(`Usage rights for ${creator} end soon`),
  });
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/The last day you may use their footage is in 3 days/)).toBeVisible();
  await alert.click();
  await expect(page).toHaveURL(/\/settings\/creators/, { timeout: 30_000 });
});
