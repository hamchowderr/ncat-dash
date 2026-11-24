import { execSync } from "node:child_process";

import { expect, test } from "./test";

// Creators and their usage rights in a real browser: a team adds a creator from the main
// menu, keeps a deal per client on their page, and a week before a deal's last day the
// daily check puts an alert in everyone's Inbox (and chat apps) that opens the creator.

const stamp = Date.now().toString(36);
const SHOTS = process.env.CREATOR_SHOTS;

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

test("a creator's deals are kept on their page, and the team hears a week before one ends", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Rae Okafor");
  await page.locator("#email").fill(`rights.${stamp}@example.test`);
  await page.locator("#password").fill("rights-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Okafor Ads");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/settings/toolkit");
  await page.locator("#baseUrl").fill("http://127.0.0.1:8767");
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();

  // A client to make a deal with.
  await page.goto("/clients");
  await page.getByLabel("Client name").fill("Acme");
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page).toHaveURL(/\/clients\/[a-z0-9]+$/, { timeout: 30_000 });

  // Creators sits in the main menu, beside Clients.
  await page.getByRole("link", { name: "Creators", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Creators" })).toBeVisible();
  await expect(page.getByText(/No creators yet/)).toBeVisible();
  await page.getByLabel("Creator name").fill("Ana Ruiz");
  await page.getByRole("button", { name: "Add creator" }).click();
  await expect(page).toHaveURL(/\/creators\/[a-z0-9]+$/, { timeout: 30_000 });
  const creatorUrl = page.url();

  const add = page.getByRole("form", { name: "Add a deal" });
  await add.getByLabel("Client").selectOption({ label: "Acme" });
  await add.getByLabel("Last day of use").fill(daysFromNow(3));
  await add.getByRole("radio", { name: "Paid ads" }).click();
  await add.getByLabel(/Note/).fill("Whitelisted on Meta");
  await add.getByRole("button", { name: "Add deal" }).click();
  const acme = page.locator('[data-deal="Acme"]');
  await expect(acme.getByText(/Last day .*, in 3 days/)).toHaveAttribute("data-tone", "soon");
  await expect(acme.getByText("Paid ads. Whitelisted on Meta")).toBeVisible();

  await add.getByLabel("Last day of use").fill(daysFromNow(70));
  await add.getByRole("radio", { name: "Organic" }).click();
  await add.getByRole("button", { name: "Add deal" }).click();
  await expect(page.locator('[data-deal="Your own content"]')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/Creator Page.png` });

  await page.goto("/creators");
  const row = page.locator('[data-creator="Ana Ruiz"]');
  await expect(row.getByText(/^Acme: Last day .*, in 3 days$/)).toBeVisible();
  await expect(row.getByText("2 deals")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/Creators List.png` });

  // The daily check, run now.
  execSync("npx convex run creators:checkEnding", { stdio: "pipe" });
  await page.goto("/inbox");
  const alert = page.getByRole("link", { name: /Ana Ruiz's rights for Acme end soon/ });
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText(/The last day you may use their footage is in 3 days/).first(),
  ).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/Rights Ending In Inbox.png` });
  await alert.click();
  await expect(page).toHaveURL(creatorUrl, { timeout: 30_000 });
});
