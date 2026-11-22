import { expect, type Page, test } from "./test";

// The Automations, Runs and Jobs pages as lists of soft rows, in a real browser against a
// real backend: a client's automations sit in its folder at the top, a row's menu moves
// one there, and the pages still fit a phone.

const stamp = Date.now().toString(36);
if (process.env.RECORD_VIDEO === "1") {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 350 },
  });
}

const pause = (ms: number) =>
  process.env.RECORD_VIDEO === "1" ? new Promise((done) => setTimeout(done, ms)) : null;

async function importAutomation(page: Page) {
  await page.goto("/automations");
  await page
    .getByLabel("Automation file to import")
    .setInputFiles("e2e/fixtures/weekly-clips.automation.json");
  await expect(page).toHaveURL(/\/automations\/[a-z0-9]+$/, { timeout: 30_000 });
}

test("automations, runs and jobs are rows, with a client's automations in its folder", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Lee Park");
  await page.locator("#email").fill(`lee.lists.${stamp}@example.test`);
  await page.locator("#password").fill("item-lists-e2e-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Row House");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Do You Have A Toolkit?" })).toBeVisible();

  await page.goto("/clients");
  await page.getByLabel("Client name").fill("Clio");
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page).toHaveURL(/\/clients\/[a-z0-9]+$/, { timeout: 30_000 });

  await importAutomation(page);
  await importAutomation(page);
  await page.goto("/automations");
  const list = page.getByRole("list", { name: "Automations" });
  const rows = list.locator("[data-automation]");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText(/Last updated just now/);
  await expect(rows.first()).toContainText(/Created \d+ \w+/);
  await expect(rows.first().getByRole("switch")).toBeVisible();
  await pause(2000);

  // One goes into the client's folder from its menu.
  await rows
    .first()
    .getByRole("button", { name: /^More for / })
    .click();
  await page.getByRole("menuitem", { name: "Move to folder" }).click();
  await page.getByRole("menuitemradio", { name: "Clio" }).click();
  await expect(page.getByText("Moved to Clio")).toBeVisible();
  const folder = list.locator("[data-folder]");
  await expect(folder).toHaveCount(1);
  await expect(folder).toContainText("Clio");
  await expect(folder).toContainText("1 automation");
  await expect(rows).toHaveCount(1);
  await pause(2000);

  // The folder opens onto what is in it, and leads back.
  await folder.getByRole("link", { name: "Clio folder" }).click();
  await expect(page).toHaveURL(/\/automations\?folder=/);
  await expect(page.getByRole("navigation", { name: "Folder" })).toContainText("Clio");
  await expect(
    page.getByRole("list", { name: "Automations for Clio" }).locator("[data-automation]"),
  ).toHaveCount(1);
  await pause(2000);
  await page.getByRole("link", { name: /All automations/ }).click();
  await expect(page).toHaveURL(/\/automations$/);
  await pause(1000);

  // Runs and Jobs say there is nothing yet, in the same soft panel.
  await page.goto("/runs");
  await expect(page.getByText(/Nothing has run yet/)).toBeVisible();
  await page.goto("/jobs");
  await expect(page.getByText(/Nothing has run yet/)).toBeVisible();

  // On a phone the rows wrap, and nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/automations");
  await expect(list.locator("[data-folder]")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  const row = list.locator("[data-automation]").first();
  const rowBox = (await row.boundingBox())!;
  const toggle = (await row.getByRole("switch").boundingBox())!;
  expect(toggle.x + toggle.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
  await pause(1500);
});
