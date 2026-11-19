import { expect, type Page, test } from "./test";

// What a picked or opened control looks like: the Schedule trigger's options in the
// automation editor, a pick list opened, and the canvas with a step selected.

const stamp = Date.now().toString(36);
const RECORD = process.env.RECORD_VIDEO === "1";
if (RECORD) {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 300 },
  });
}
const pause = (page: Page, ms = 1200) => (RECORD ? page.waitForTimeout(ms) : Promise.resolve());
const shot = (page: Page, name: string) =>
  RECORD ? page.screenshot({ path: `test-results/selected-states/${name}.png` }) : undefined;

test("the Schedule trigger's options are laid out as clear choices", async ({ page }) => {
  test.setTimeout(RECORD ? 300_000 : 120_000);
  await page.goto("/sign-up");
  await page.locator("#name").fill("Ivy Moss");
  await page.locator("#email").fill(`ivy.selected.${stamp}@example.test`);
  await page.locator("#password").fill("selected-states-e2e-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Moss Media");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Do You Have A Toolkit?" })).toBeVisible();

  await page.goto("/automations");
  await page.getByRole("link", { name: "New automation", exact: true }).click();
  await page.getByRole("button", { name: "Empty canvas" }).first().click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  await page.getByLabel("Automation name").fill("Weekly clips");

  await page.locator(".react-flow__node-trigger").click();
  // The picked step wears the one selection ring used across the app.
  await expect(page.locator(".react-flow__node-trigger .picked-ring")).toBeVisible();
  await pause(page);
  await shot(page, "01-trigger-selected");

  await page.getByRole("combobox", { name: "What starts it" }).click();
  // Each choice says in a few words when it starts the automation.
  await expect(page.getByText("Every so often, or each day at a set time")).toBeVisible();
  await pause(page);
  await shot(page, "02-what-starts-it-open");
  await page.getByRole("option", { name: "Schedule", exact: true }).click();
  await pause(page);
  await shot(page, "03-schedule");

  // The two ways sit side by side; nothing opens over the fields below.
  const often = page.getByRole("radiogroup", { name: "How often" });
  await expect(often.getByRole("radio", { name: "On repeat" })).toBeChecked();
  await expect(page.getByText("Runs every hour.")).toBeVisible();
  await page
    .getByRole("radiogroup", { name: "Unit" })
    .getByRole("radio", { name: "Minutes" })
    .click();
  await page.getByLabel("Every", { exact: true }).fill("30");
  await expect(page.getByText("Runs every 30 minutes.")).toBeVisible();
  await pause(page);
  await shot(page, "04-interval");

  await often.getByRole("radio", { name: "Every day" }).click();
  await expect(page.getByLabel("Time", { exact: true })).toBeVisible();
  await pause(page);
  await shot(page, "05-daily");

  // The time zone is picked by city from a searchable list.
  await page.getByRole("combobox", { name: "Time zone", exact: true }).click();
  await pause(page);
  await shot(page, "06-time-zone-open");
  const search = page.getByRole("combobox", { name: "Search time zones" });
  await expect(search).toBeFocused();
  await page.keyboard.type("new york");
  await pause(page, 800);
  await page.getByRole("option", { name: /New York/ }).click();
  await expect(page.getByRole("combobox", { name: "Time zone", exact: true })).toContainText(
    "New York",
  );
  await expect(page.getByText(/Runs every day at 9:00\sAM, New York time\./)).toBeVisible();
  await pause(page);
  await shot(page, "07-daily-new-york");

  // A picked step on the canvas gets a clean ring set off from its edge.
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByLabel("Search steps").fill("Caption video");
  await page
    .getByRole("complementary", { name: "Steps you can add" })
    .getByRole("button", { name: "Caption video", exact: true })
    .click();
  await pause(page);
  await shot(page, "08-step-selected");
  await page.getByRole("combobox").first().click();
  await pause(page);
  await shot(page, "09-step-pick-list");
  await page.keyboard.press("Escape");
  await pause(page, 1500);
});
