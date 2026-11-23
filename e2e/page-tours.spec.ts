import { expect, type Page, test } from "@playwright/test";

import { EDITOR_TOUR } from "../src/components/automations/editor-tour";
import { NEW_AUTOMATION_TOUR } from "../src/components/automations/new-automation-tour";
import { LIBRARY_TOUR } from "../src/components/library/library-tour";
import { PROJECT_TOUR } from "../src/components/projects/project-tour";
import { REVIEW_TOUR } from "../src/components/review/review-tour";
import { BRAND_TOUR } from "../src/components/settings/brand-tour";
import type { Tour } from "../src/components/ui/tour";

// Each page's own guided tour, in a real browser against a real local backend: it starts
// on someone's first visit, every card keeps clear of what it points at, it is remembered
// once finished, and "Take the Tour" starts it again. On a phone too.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";
const FILES = "http://127.0.0.1:8766";

const recording = process.env.RECORD_VIDEO
  ? { dir: "test-results/page-tours", size: { width: 1440, height: 900 } }
  : undefined;

test.use({
  video: recording ? { mode: "on", size: recording.size } : "off",
});

const pause = (page: Page) => page.waitForTimeout(recording ? 1300 : 0);

async function setUpTeam(page: Page, who: string) {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Theo Grant");
  await page.locator("#email").fill(`theo.${who}.${stamp}@example.test`);
  await page.locator("#password").fill("page-tours-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Grant Studio");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({ timeout: 30_000 });
  await page.goto("/settings/toolkit");
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();
}

/**
 * Whether the card keeps clear of the thing it points at, so that stays in sight. On a
 * phone the card sits at the top or bottom edge, and a tall target such as the canvas can
 * leave no room beside it: there the card may cover a strip of it, never most of it.
 */
async function clearOf(page: Page, id: string) {
  const card = await page.locator("[data-tour-card]").boundingBox();
  const target = await page.locator(`[data-tour-step-id~='${id}']`).first().boundingBox();
  const screen = page.viewportSize()!;
  if (!card || !target) return false;
  const overlapX =
    Math.min(card.x + card.width, target.x + target.width) - Math.max(card.x, target.x);
  const overlapY =
    Math.min(card.y + card.height, target.y + target.height) - Math.max(card.y, target.y);
  if (overlapX <= 1 || overlapY <= 1) return true;
  if (screen.width >= 640) return false;
  const shown = Math.min(screen.height, target.y + target.height) - Math.max(0, target.y);
  return overlapY < shown / 4;
}

/**
 * Walks a tour from its first card to the end: each card is one of the tour's steps, in
 * order, and keeps clear of its target. Optional steps whose target is not on the page
 * are left out by the tour itself.
 */
async function walk(page: Page, tour: Tour) {
  const card = page.locator("[data-tour-card]");
  await expect(card).toBeVisible();
  const counter = card.getByText(/^Step \d+ of \d+$/);
  const total = Number((await counter.textContent())!.match(/of (\d+)/)![1]);
  let from = 0;
  for (let shown = 1; shown <= total; shown++) {
    await expect(counter).toHaveText(`Step ${shown} of ${total}`);
    const heading = (await card.locator("[id$='-title']").textContent())!.trim();
    const at = tour.steps.findIndex((step, i) => i >= from && step.title === heading);
    expect(at, `"${heading}" is a step of the ${tour.id} tour, in order`).toBeGreaterThanOrEqual(0);
    from = at + 1;
    const step = tour.steps[at];
    if (!step.nextLabel) await expect.poll(() => clearOf(page, step.id), heading).toBe(true);
    await pause(page);
    const next = shown === total ? "Finish" : String(step.nextLabel ?? "Next");
    await card.getByRole("button", { name: next, exact: true }).click();
  }
  await expect(card).toHaveCount(0);
  await expect(
    page.getByText("You can take this tour again from the top of the page."),
  ).toBeVisible();
}

/** Finished, a tour stays away on the next visit, and "Take the Tour" brings it back. */
async function takeAgain(page: Page, tour: Tour) {
  await page.reload();
  const button = page.getByRole("button", { name: "Take the Tour" });
  await expect(button).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.locator("[data-tour-card]")).toHaveCount(0);
  await button.click();
  await expect(page.locator("[data-tour-card]")).toContainText(String(tour.steps[0].title));
  await page.locator("[data-tour-card]").getByRole("button", { name: "Close the tour" }).click();
  await expect(page.locator("[data-tour-card]")).toHaveCount(0);
}

test("each page's tour shows someone around on their first visit, and again when they ask", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await setUpTeam(page, "desk");

  // New automation, then the editor it opens.
  await page.goto("/automations/new");
  await walk(page, NEW_AUTOMATION_TOUR);
  await takeAgain(page, NEW_AUTOMATION_TOUR);
  await page.getByRole("button", { name: "Empty canvas" }).first().click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  await walk(page, EDITOR_TOUR);
  await takeAgain(page, EDITOR_TOUR);

  // A project.
  await page.goto("/projects/new");
  await page.getByLabel("Name", { exact: true }).fill("Episode 4");
  await page.getByRole("button", { name: "Make project" }).click();
  await expect(page).toHaveURL(/\/projects\/(?!new$)[a-z0-9]+$/);
  await walk(page, PROJECT_TOUR);
  await takeAgain(page, PROJECT_TOUR);

  // The library, with one upload in it.
  await page.goto("/uploads");
  await page.getByLabel("Choose files to upload").setInputFiles("e2e/fixtures/clip.webm");
  await expect(page.getByRole("button", { name: "Open clip.webm" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/library");
  await walk(page, LIBRARY_TOUR);
  await takeAgain(page, LIBRARY_TOUR);

  // Settings, Brand.
  await page.goto("/settings/brand");
  await walk(page, BRAND_TOUR);
  await takeAgain(page, BRAND_TOUR);

  // A review room, opened by an automation reaching its approval step.
  await page.goto("/automations");
  await page
    .getByLabel("Automation file to import")
    .setInputFiles("e2e/fixtures/weekly-clips.automation.json");
  await expect(page).toHaveURL(/\/automations\/(?!new$).+/);
  await expect(page.getByRole("switch").first()).toBeVisible();
  await page.getByRole("switch").first().click();
  await expect(page.getByRole("switch").first()).toBeChecked();
  await page.locator(".react-flow__node-trigger").click();
  const address = await page.locator("#trigger-address").inputValue();
  const started = await fetch(address, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_url: `${FILES}/station-interview.webm` }),
  });
  expect(started.status).toBe(202);
  await page.goto("/review");
  const room = page.getByRole("link", { name: /Weekly clips/ });
  await expect(room).toContainText("In review", { timeout: 60_000 });
  await room.click();
  await expect(page).toHaveURL(/\/review\/.+/);
  await walk(page, REVIEW_TOUR);
  await takeAgain(page, REVIEW_TOUR);
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("the page tours keep their cards clear of what they point at", async ({ page }) => {
    test.setTimeout(240_000);
    await setUpTeam(page, "phone");

    await page.goto("/automations/new");
    await walk(page, NEW_AUTOMATION_TOUR);
    await page.getByRole("button", { name: "Empty canvas" }).first().click();
    await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
    await walk(page, EDITOR_TOUR);

    await page.goto("/projects/new");
    await page.getByLabel("Name", { exact: true }).fill("Episode 5");
    await page.getByRole("button", { name: "Make project" }).click();
    await expect(page).toHaveURL(/\/projects\/(?!new$)[a-z0-9]+$/);
    await walk(page, PROJECT_TOUR);

    await page.goto("/library");
    await walk(page, LIBRARY_TOUR);

    await page.goto("/settings/brand");
    await walk(page, BRAND_TOUR);
  });
});
