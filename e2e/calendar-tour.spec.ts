import { expect, type Page, test } from "@playwright/test";

// The calendar's guided tour, in a real browser against a real local backend: it starts
// on someone's first visit, points at each part of the page, is remembered once finished,
// and can be taken again from the top of the page, on a phone too.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";

const recording = process.env.RECORD_VIDEO
  ? { dir: "test-results/calendar-tour", size: { width: 1440, height: 900 } }
  : undefined;

test.use({
  video: recording ? { mode: "on", size: recording.size } : "off",
});

async function setUpTeam(page: Page) {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Rosa Diaz");
  await page.locator("#email").fill(`rosa.${stamp}@example.test`);
  await page.locator("#password").fill("calendar-tour-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Diaz Studio");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({ timeout: 30_000 });
  await page.goto("/settings/toolkit");
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();
}

/** Whether the card keeps clear of the thing it points at, so that stays in sight. */
async function clearOf(page: Page, id: string) {
  const card = await page.locator("[data-tour-card]").boundingBox();
  const target = await page.locator(`[data-tour-step-id~='${id}']`).boundingBox();
  // Not laid out yet (the card moving to the next step, or the page still drawing): ask again.
  if (!card || !target) return false;
  return (
    card.x >= target.x + target.width - 1 ||
    card.x + card.width <= target.x + 1 ||
    card.y >= target.y + target.height - 1 ||
    card.y + card.height <= target.y + 1
  );
}

test("the calendar tour shows someone around on their first visit, and again when they ask", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await setUpTeam(page);

  await page.goto("/calendar");
  // The card itself: on a phone the menu sheet closing is a dialog too for a moment.
  const card = page.locator("[data-tour-card]");
  await expect(card).toContainText("Your Content Calendar");
  await expect(card).toContainText("Step 1 of 7");
  await page.waitForTimeout(recording ? 1500 : 0);

  await card.getByRole("button", { name: "Show me" }).click();
  const steps: [string, string][] = [
    ["Posts, Due Dates and Runs", "tour-calendar-grid"],
    ["Move Through Time", "tour-calendar-move"],
    ["Month or Week", "tour-calendar-views"],
    ["Add a Post", "tour-calendar-add"],
    ["Not Scheduled", "tour-calendar-waiting"],
    ["Repeating Slots", "tour-calendar-slots"],
  ];
  for (const [i, [title, id]] of steps.entries()) {
    if (i > 0) await card.getByRole("button", { name: "Next" }).click();
    await expect(card.getByText(title, { exact: true })).toBeVisible();
    await expect.poll(() => clearOf(page, id), title).toBe(true);
    await page.waitForTimeout(recording ? 1500 : 0);
  }
  await card.getByRole("button", { name: "Finish" }).click();
  await expect(card).toHaveCount(0);
  await expect(
    page.getByText("You can take this tour again from the top of the page."),
  ).toBeVisible();

  // Finished, so coming back does not start it.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Take the Tour" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // It can be taken again from the top of the page, and Escape closes it.
  await page.getByRole("button", { name: "Take the Tour" }).click();
  await expect(card).toContainText("Your Content Calendar");
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);

  // On a phone the side list sits below the calendar: the tour scrolls down to it, and
  // nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Take the Tour" }).click();
  await card.getByRole("button", { name: "Show me" }).click();
  for (let step = 2; step < 6; step++) await card.getByRole("button", { name: "Next" }).click();
  await expect(card.getByText("Not Scheduled", { exact: true })).toBeVisible();
  const side = page.getByRole("complementary", { name: "Side list" });
  await expect(side).toBeInViewport();
  const box = (await card.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  const sideways = await page.evaluate(
    () => document.scrollingElement!.scrollWidth > innerWidth + 1,
  );
  expect(sideways).toBe(false);
  await card.getByRole("button", { name: "Close the tour" }).click();
  await expect(card).toHaveCount(0);
});
