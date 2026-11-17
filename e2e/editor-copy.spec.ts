import { expect, type Page, test } from "@playwright/test";

// Copy, paste and duplicate on the automation canvas, in a real browser: keys and the
// panel's button, a copy that keeps its settings, and pasting into another automation.

const stamp = Date.now().toString(36);

async function newAutomation(page: Page, name: string) {
  await page.goto("/automations");
  await page.getByRole("button", { name: "New automation", exact: true }).click();
  await page.getByRole("button", { name: "Empty canvas" }).first().click();
  await expect(page).toHaveURL(/\/automations\/[a-z0-9]+$/, { timeout: 30_000 });
  await page.getByLabel("Automation name").fill(name);
}

const steps = (page: Page) => page.locator(".react-flow__node-step");
const key = (page: Page, letter: string) =>
  page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+${letter}`);

test("steps can be duplicated, copied and pasted, here and in another automation", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Rae Kim");
  await page.locator("#email").fill(`rae.${stamp}@example.test`);
  await page.locator("#password").fill("editor-copy-e2e-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Copy Shop");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.locator("#baseUrl")).toBeVisible();

  await newAutomation(page, "First");
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByLabel("Search steps").fill("Caption video");
  await page
    .getByRole("complementary", { name: "Steps you can add" })
    .getByRole("button", { name: "Caption video", exact: true })
    .click();
  await expect(steps(page)).toHaveCount(1);
  await page.getByRole("switch", { name: "Turn this step off" }).click();

  // The panel's button puts a copy beside it, which keeps its settings.
  await page.getByRole("button", { name: "Duplicate step" }).click();
  await expect(steps(page)).toHaveCount(2);
  await expect(page.getByRole("switch", { name: "Turn this step on" })).toBeVisible();

  // Ctrl+C on the chosen copy, Ctrl+V carries on from it.
  await steps(page).nth(1).click();
  await key(page, "c");
  await expect(page.getByText("Copied the step.")).toBeVisible();
  await key(page, "v");
  await expect(steps(page)).toHaveCount(3);
  await expect(page.getByText(/^Pasted after/)).toBeVisible();
  await key(page, "d");
  await expect(steps(page)).toHaveCount(4);
  await key(page, "z");
  await expect(steps(page)).toHaveCount(3);
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();

  // The copy is still there in another automation.
  await newAutomation(page, "Second");
  await page.locator(".react-flow__pane").click();
  await key(page, "v");
  await expect(steps(page)).toHaveCount(1);
  await expect(steps(page).first()).toContainText("Turned off");
});
