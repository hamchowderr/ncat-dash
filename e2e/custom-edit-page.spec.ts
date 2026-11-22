import { expect, test } from "./test";

// The Custom edit step's page names nothing after the tool the toolkit uses underneath:
// not its address, its title, or the line under Input. The old address still opens it.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";

test("the Custom edit step has a plain address and plain words", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/sign-up");
  await page.locator("#name").fill("Ravi Menon");
  await page.locator("#email").fill(`ravi.${stamp}@example.test`);
  await page.locator("#password").fill("custom-edit-e2e-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Menon Media");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: /Yes, I Have One/ }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  await page.goto("/steps");
  await page
    .getByRole("link", { name: /Custom edit/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/steps\/custom-edit$/);
  await expect(page.getByRole("heading", { level: 1, name: "Custom edit" })).toBeVisible();
  await expect(page.getByText("Runs on your toolkit with these settings.")).toBeVisible();
  expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/ffmpeg/i);

  await page.goto("/steps/ffmpeg-compose");
  await expect(page).toHaveURL(/\/steps\/custom-edit$/);
});
