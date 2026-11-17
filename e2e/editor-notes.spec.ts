import { expect, test } from "@playwright/test";

// Sticky notes on the automation canvas, in a real browser: added, written in, moved,
// kept after a reload, and removed with the keyboard.

const stamp = Date.now().toString(36);
const notes = (page: import("@playwright/test").Page) => page.locator(".react-flow__node-note");

test("notes can be added, written, moved, kept and removed", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Ivy Chen");
  await page.locator("#email").fill(`ivy.${stamp}@example.test`);
  await page.locator("#password").fill("editor-notes-e2e-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Note Shop");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.locator("#baseUrl")).toBeVisible();

  await page.goto("/automations");
  await page.getByRole("button", { name: "New automation", exact: true }).click();
  await page.getByRole("button", { name: "Empty canvas" }).first().click();
  await expect(page).toHaveURL(/\/automations\/[a-z0-9]+$/, { timeout: 30_000 });

  await page.getByRole("button", { name: "Add note" }).click();
  await expect(notes(page)).toHaveCount(1);
  const box = page.getByRole("textbox", { name: "Note" });
  await box.fill("Captions only run for clips under a minute.");
  await box.blur();

  // Dragged by its top strip, it stays where it was put down.
  const strip = notes(page).getByText("Note", { exact: true });
  const start = await notes(page).boundingBox();
  const grip = await strip.boundingBox();
  if (!start || !grip) throw new Error("The note is not on the canvas.");
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 120, grip.y + 80, { steps: 8 });
  await page.mouse.up();
  const moved = await notes(page).boundingBox();
  expect(moved!.x).toBeGreaterThan(start.x + 50);

  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note" })).toHaveValue(
    "Captions only run for clips under a minute.",
  );

  // Chosen and deleted with the keyboard, like a step.
  await notes(page).getByText("Note", { exact: true }).click();
  await page.keyboard.press("Backspace");
  await expect(notes(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Add note" })).toBeVisible();
  await expect(notes(page)).toHaveCount(0);
});
