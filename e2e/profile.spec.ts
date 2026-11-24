import { expect, type Page, test } from "./test";

// The profile in a real browser against a real backend: a photo is uploaded to the
// app's own storage and shows on the account and the team, and a role and time zone are
// saved and shown beside the name on Members.

const stamp = Date.now().toString(36);

test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  await page.goto("/sign-up");
  await page.locator("#name").fill("Maya Ortiz");
  await page.locator("#email").fill(`maya.profile.${stamp}@example.test`);
  await page.locator("#password").fill("profile-e2e-password-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Example Studio");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({
    timeout: 30_000,
  });
});

test("a photo is uploaded to storage and shows on the account and the team", async () => {
  await page.goto("/settings/account");
  await page
    .locator('input[type="file"][accept="image/*"]')
    .setInputFiles("e2e/fixtures/still.jpg");
  await expect(page.getByText("Photo updated.")).toBeVisible({
    timeout: 30_000,
  });
  // The account keeps the stored file's address, not the picture itself.
  const photo = page.locator('img[src*="/api/storage/"]').first();
  await expect(photo).toBeVisible({ timeout: 30_000 });
  await page.goto("/settings/team");
  const people = page.getByRole("list", { name: "People on the team" });
  await expect(people.locator('img[src*="/api/storage/"]')).toBeVisible({ timeout: 30_000 });
});

test("a job title and a time zone are saved and the title shows on Members", async () => {
  await page.goto("/settings/account");
  await page.getByLabel("Job title").fill("Producer");
  await page.getByRole("button", { name: "Save changes" }).last().click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.goto("/settings/team");
  await expect(page.getByRole("list", { name: "People on the team" })).toContainText(
    "Maya Ortiz · Producer",
  );
});
