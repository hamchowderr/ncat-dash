import { expect, test } from "./test";

// B-Roll in a real browser: the settings page says where footage comes from, the
// ready-made is in the one list, and its step asks for nothing to be typed in.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";

test("B-Roll is set up in Settings and the ready-made needs nothing filled in", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Rae Okafor");
  await page.locator("#email").fill(`rae.${stamp}@example.test`);
  await page.locator("#password").fill("broll-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Okafor Films");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/settings/toolkit");
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();

  await page.goto("/settings/broll");
  await expect(page.getByRole("heading", { name: "B-Roll" })).toBeVisible();
  await expect(page.getByText("Your library", { exact: true })).toBeVisible();
  await expect(page.getByText("Free stock", { exact: true })).toBeVisible();
  await expect(page.getByText("Pixabay", { exact: true })).toBeVisible();

  await page.goto("/automations/new");
  await page.getByLabel("Find a ready-made automation").fill("b-roll");
  await expect(page.getByText("Clips with B-Roll", { exact: true })).toBeVisible();
  await page.getByText("Talking head with B-Roll", { exact: true }).click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  const steps = page.locator(".react-flow__node-step");
  await expect(steps).toHaveCount(2);
  await steps.first().click();
  await expect(page.getByText("Handled for you")).toBeVisible();
  await expect(page.getByLabel("How often")).toBeVisible();
  await expect(page.getByLabel("Footage from")).toContainText("Your library, then free stock");
});
