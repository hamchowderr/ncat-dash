import { expect, type Locator, type Page, test } from "@playwright/test";

// The content calendar in a real browser against a real local backend: a repeating slot
// for Instagram, a queued post taking its next time, a post dragged from the side list
// onto a day and between days, the week view, and a project slot given a due date.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";

const recording = process.env.RECORD_VIDEO
  ? { dir: "test-results/calendar", size: { width: 1440, height: 900 } }
  : undefined;

test.use({
  video: recording ? { mode: "on", size: recording.size } : "off",
});

/** Drags one element onto another the way the browser does, with one shared DataTransfer. */
async function drag(page: Page, source: Locator, target: Locator) {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent("dragstart", { dataTransfer });
  await target.dispatchEvent("dragenter", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer });
  await target.dispatchEvent("drop", { dataTransfer });
  await source.dispatchEvent("dragend", { dataTransfer });
}

test("posts are planned on the calendar, fill repeating slots, and move by dragging", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/sign-up");
  await page.locator("#name").fill("Kai Moreno");
  await page.locator("#email").fill(`kai.${stamp}@example.test`);
  await page.locator("#password").fill("calendar-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Moreno Media");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: /Yes, I Have One/ }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  // A project, so its slots wait in the side list for a due date.
  await page.goto("/projects/new");
  await page.getByLabel("Name", { exact: true }).fill("Episode 7");
  await page.getByRole("button", { name: "Make project" }).click();
  // Wait for the project's own page: /projects/new matches the same pattern.
  await expect(page).toHaveURL(/\/projects\/(?!new$)[a-z0-9]+$/);
  await expect(page.getByText(/0 of \d+/)).toBeVisible();

  await expect(page.getByRole("link", { name: "Calendar" }).first()).toHaveAttribute(
    "href",
    "/calendar",
  );
  await page.goto("/calendar");
  await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
  const side = page.getByRole("complementary", { name: "Side list" });
  await expect(
    side.getByRole("region", { name: "Project Slots" }).getByText("Full episode"),
  ).toBeVisible();

  // A repeating slot every Monday at 10:00 for Instagram.
  await side.getByRole("button", { name: "Repeating Slots" }).click();
  await side.getByLabel("Day", { exact: true }).selectOption("Monday");
  await side.getByLabel("Time", { exact: true }).fill("10:00");
  await side.getByLabel("Where").selectOption("Instagram");
  await side.getByRole("button", { name: "Add Slot" }).click();
  await expect(side.getByText("Mondays at 10:00")).toBeVisible();
  await expect(page.getByRole("button", { name: /Open slot for Instagram/ }).first()).toBeVisible();

  // A queued post takes the next Monday.
  await side.getByRole("button", { name: "Not Scheduled" }).click();
  await side.getByRole("button", { name: "Add Post" }).click();
  await side.getByLabel("Title").fill("Episode 7 teaser");
  await side.getByLabel("Where").selectOption("Instagram");
  await side.getByRole("button", { name: "Add Post" }).click();
  const teaser = page.getByRole("button", { name: /Episode 7 teaser, Instagram at/ });
  await expect(teaser).toBeVisible();
  const monday = await teaser.evaluate((chip) =>
    chip.closest("[data-day]")!.getAttribute("data-day"),
  );
  expect(new Date(`${monday}T12:00:00`).getDay()).toBe(1);

  // A post with no time waits in the side list, then is dragged onto a day.
  await expect(side.getByRole("heading", { name: "Post", exact: true })).toBeVisible();
  await side.getByRole("button", { name: "Back" }).click();
  await side.getByRole("button", { name: "Add Post" }).click();
  await side.getByLabel("Title").fill("Behind the scenes");
  await side.getByLabel("Where").selectOption("TikTok");
  await side.getByLabel("Not Scheduled Yet").check();
  await side.getByRole("button", { name: "Add Post" }).click();
  await expect(side.getByRole("heading", { name: "Post", exact: true })).toBeVisible();
  await side.getByRole("button", { name: "Back" }).click();
  const waiting = side
    .getByRole("region", { name: "Posts" })
    .getByRole("button", { name: /Behind the scenes/ });
  await expect(waiting).toBeVisible();

  const days = page.locator("[data-day]");
  const target = days.nth(17);
  const targetDay = await target.getAttribute("data-day");
  await drag(page, waiting, target);
  const planned = page.getByRole("button", { name: /Behind the scenes, TikTok at 10 AM/ });
  await expect(planned).toBeVisible();
  await expect(target.getByRole("button", { name: /Behind the scenes/ })).toBeVisible();
  await expect(side.getByRole("region", { name: "Posts" }).getByRole("button")).toHaveCount(0);

  // Dragged to another day, it keeps its time.
  const next = days.nth(18);
  await drag(page, planned, next);
  await expect(
    next.getByRole("button", { name: /Behind the scenes, TikTok at 10 AM/ }),
  ).toBeVisible();
  expect(targetDay).not.toBe(await next.getAttribute("data-day"));

  // A project slot dragged onto a day is due then.
  const episode = side
    .getByRole("region", { name: "Project Slots" })
    .getByRole("button", { name: /Full episode/ });
  await drag(page, episode, days.nth(19));
  await expect(
    days.nth(19).getByRole("button", { name: "Full episode for Episode 7, due" }),
  ).toBeVisible();

  // The week view, with hours.
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.locator("[data-hour]").first()).toBeVisible();

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const sideways = await page.evaluate(
      () => document.scrollingElement!.scrollWidth > innerWidth + 1,
    );
    expect(sideways, `the page scrolls sideways at ${width}`).toBe(false);
  }
});
