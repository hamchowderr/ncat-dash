import { expect, type Page, test } from "./test";

// The settings menu and the Integrations page in a real browser against a real backend:
// a short menu, every app under Integrations with a page of its own, old addresses still
// landing on the right page, and tabs on the pages that hold more than one job.

const TOOLKIT = "http://127.0.0.1:8767";
const stamp = Date.now().toString(36);
const RECORD = process.env.RECORD === "1";
if (RECORD) {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 250 },
  });
}
const slow = (page: Page, ms: number) => (RECORD ? page.waitForTimeout(ms) : Promise.resolve());

test("the settings menu is short, and every app lives under Integrations", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Rosa Diaz");
  await page.locator("#email").fill(`rosa.${stamp}@example.test`);
  await page.locator("#password").fill("integrations-e2e-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Harbour Light");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({ timeout: 30_000 });
  await page.goto("/settings/toolkit");
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();

  // The menu: four short groups, no app listed in it.
  await page.goto("/settings/brand");
  const menu = page.getByRole("navigation", { name: "Settings" });
  await expect(menu.getByRole("link")).toHaveText([
    "Account",
    "Notifications",
    "Members",
    "Integrations",
    "Brand",
    "Captions",
    "Motion",
    "Toolkit",
    "Agent",
    "Runs",
    "B-Roll",
    "Video Editors",
  ]);
  await expect(menu.getByRole("link", { name: "Slack" })).toHaveCount(0);
  await slow(page, 1500);

  // Integrations lists every app by group, with Email already set up by nobody yet.
  await menu.getByRole("link", { name: "Integrations" }).click();
  await expect(page).toHaveURL(/\/settings\/integrations$/);
  await expect(page.getByRole("heading", { level: 1, name: "Integrations" })).toBeVisible();
  for (const group of ["Chat", "Meeting Recordings", "Files", "AI Apps", "Sending Email"]) {
    await expect(page.getByRole("heading", { level: 2, name: group })).toBeVisible();
  }
  await expect(page.getByRole("img", { name: "Zoom logo" })).toBeVisible();
  await slow(page, 2000);

  // An app opens its own page; Integrations stays lit and leads back.
  await page.locator("[data-integration=zoom]").click();
  await expect(page).toHaveURL(/\/settings\/integrations\/zoom$/);
  await expect(page.getByRole("heading", { level: 1, name: "Zoom" })).toBeVisible();
  await expect(menu.locator("[aria-current=page]")).toHaveText("Integrations");
  await slow(page, 1500);
  await page.getByRole("link", { name: "Integrations", exact: true }).last().click();
  await expect(page).toHaveURL(/\/settings\/integrations$/);

  // Old addresses still land on the app's page, with what they carried.
  await page.goto("/settings/slack");
  await expect(page).toHaveURL(/\/settings\/integrations\/slack$/);
  await expect(page.getByRole("heading", { level: 1, name: "Slack" })).toBeVisible();
  await page.goto("/settings/ai-agents");
  await expect(page).toHaveURL(/\/settings\/integrations\/mcp$/);

  // A page with more than one job shows one at a time, as tabs, kept in the address.
  await page.goto("/settings/agent");
  const tabs = page.getByRole("tablist", { name: "Agent" });
  await expect(tabs.getByRole("tab")).toHaveText(["Model And Rules", "Your Anthropic Key"]);
  await slow(page, 1200);
  await tabs.getByRole("tab", { name: "Your Anthropic Key" }).click();
  await expect(page).toHaveURL(/\/settings\/agent\?tab=key$/);
  await expect(page.getByText(/Anthropic/).first()).toBeVisible();
  await slow(page, 1500);
  await page.reload();
  await expect(tabs.getByRole("tab", { name: "Your Anthropic Key" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Captions: Styles first, the rest a tab away.
  await page.goto("/settings/captions");
  await expect(page.getByRole("tablist", { name: "Captions" }).getByRole("tab")).toHaveText([
    "Styles",
    "Style For Each Shape",
    "Word Fixes",
  ]);
  await slow(page, 1200);
  await page.getByRole("tab", { name: "Style For Each Shape" }).click();
  await expect(page.getByRole("combobox", { name: "Vertical videos" })).toBeVisible();
  await slow(page, 1500);

  // On a phone the Integrations list fits the screen: nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings/integrations");
  await expect(page.getByRole("heading", { level: 1, name: "Integrations" })).toBeVisible();
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(wide).toBeLessThanOrEqual(0);
  await slow(page, 1500);
});
