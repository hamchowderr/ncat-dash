import { expect, type Page, test } from "@playwright/test";

// The guided tour of the dashboard, in a real browser against a real local backend: it
// starts by itself where setting up ends, points at each part of the menu, is remembered
// once finished, and can be taken again from the user menu, on a phone too.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";

async function setUpTeam(page: Page) {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Lena Park");
  await page.locator("#email").fill(`lena.${stamp}@example.test`);
  await page.locator("#password").fill("tour-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Park Studio");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: /Yes, I Have One/ }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();
}

test("the tour walks someone new around the dashboard once, and again when they ask", async ({
  page,
}) => {
  await setUpTeam(page);

  // Where setting up sends a new team: Home, with the tour started.
  await page.goto("/?tour=start");
  // The card itself: on a phone the menu sheet closing is a dialog too for a moment.
  const card = page.locator("[data-tour-card]");
  await expect(card).toContainText("Welcome to Kontifi");
  await expect(card).toContainText("Step 1 of 11");
  await expect(page).toHaveURL(/\/$/);

  // Each card sits beside the menu entry it is about, which stays in sight.
  await card.getByRole("button", { name: "Show me" }).click();
  await expect(card).toContainText("Step 2 of 11");
  const home = page.locator("[data-tour-step-id~='tour-home']");
  const beside = async () => {
    const entry = (await home.boundingBox())!;
    const box = (await card.boundingBox())!;
    return box.x >= entry.x + entry.width;
  };
  await expect.poll(beside).toBe(true);

  for (const title of [
    "Automations",
    "Uploads",
    "Runs",
    "Review",
    "Library",
    "Inbox",
    "Builder",
    "Agent",
  ]) {
    await card.getByRole("button", { name: "Next" }).click();
    await expect(card.getByText(title, { exact: true })).toBeVisible();
  }
  // The Agent card hangs below the button at the top of the agent's strip on the right.
  const agent = (await page
    .getByRole("complementary", { name: "Agent" })
    .locator("[data-tour-step-id~='tour-agent']")
    .boundingBox())!;
  await expect.poll(async () => (await card.boundingBox())!.y >= agent.y + agent.height).toBe(true);

  await card.getByRole("button", { name: "Next" }).click();
  await expect(card).toContainText("Your Team Menu");
  await card.getByRole("button", { name: "Finish" }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText("You can take the tour again from your menu.")).toBeVisible();

  // Finished, so arriving the same way again does not start it.
  await page.goto("/?tour=start");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Park Studio" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // It can always be taken again from the user menu, and Escape closes it.
  await page.getByRole("button", { name: "Open user menu" }).click();
  await page.getByRole("menuitem", { name: "Take the tour" }).click();
  await expect(card).toContainText("Welcome to Kontifi");
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);

  // Folding the menu leaves its icons in place, each still a link, named on hover.
  const automations = page.getByRole("link", { name: "Automations", exact: true });
  const wide = (await automations.boundingBox())!.width;
  await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  await expect(page.locator("[data-collapsible='icon']")).toHaveCount(1);
  await expect(automations).toBeVisible();
  await expect.poll(async () => (await automations.boundingBox())!.width).toBeLessThan(wide / 3);
  await automations.hover();
  await expect(page.getByRole("tooltip", { name: "Automations" })).toBeVisible();
  await automations.click();
  await expect(page).toHaveURL(/\/automations$/);
  await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  await expect(page.locator("[data-collapsible='icon']")).toHaveCount(0);

  // On a phone the menu is folded away, so the cards sit in the middle of the screen and
  // nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByRole("button", { name: "Open user menu" }).click();
  await page.getByRole("menuitem", { name: "Take the tour" }).click();
  await expect(card).toContainText("Welcome to Kontifi");
  await card.getByRole("button", { name: "Show me" }).click();
  await expect(card).toContainText("Step 2 of 11");
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
