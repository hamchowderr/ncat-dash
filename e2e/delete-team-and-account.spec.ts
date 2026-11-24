import { expect, type Page, test } from "./test";

// Deleting a team and an account in a real browser against a real backend. An owner
// deletes their team from Settings > Members after typing its name, and lands on making a
// new one. Then they delete their account from Settings > Account with their password:
// the team only they are on goes with it, and the account can't sign in again.

const PASSWORD = "delete-e2e-password-1";
const stamp = Date.now().toString(36);
const email = `maya.${stamp}@example.test`;

async function makeTeam(page: Page, name: string) {
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill(name);
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  page = await context.newPage();
  await page.goto("/sign-up");
  await page.locator("#name").fill("Maya Ortiz");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await makeTeam(page, "Example Studio");
});

test("an owner deletes their team after typing its name", async () => {
  await page.goto("/settings/team");
  await expect(page.getByText("Deletes Example Studio and everything in it")).toBeVisible();
  await page.getByRole("button", { name: "Delete team" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: "Delete Example Studio?" })).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "Delete team" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/to confirm/).fill("Example Studio");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  // With no team left, the dashboard asks for a new one.
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 30_000 });
});

test("deleting the account takes the team only they are on, and signs them out", async () => {
  await makeTeam(page, "Pine Studio");
  await page.goto("/settings/account?tab=security");
  const open = page.getByRole("button", { name: "Delete account" });
  await expect(open).toBeEnabled({ timeout: 30_000 });
  await open.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Pine Studio has nobody else on it, so it is deleted too");
  await dialog.locator("#delete-password").fill(PASSWORD);
  await dialog.getByRole("button", { name: "Delete account" }).click();
  await expect(page).toHaveURL(/\/sign-in/, { timeout: 30_000 });

  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(/Invalid email or password/i)).toBeVisible();
});
