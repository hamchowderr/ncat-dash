import { LESSON_STORYBOARD } from "./fixtures/lesson-storyboard";
import { expect, test } from "./test";

// The Storyboard in a real browser against a real backend: a lesson pasted as text becomes
// chapters of takes, a take is changed and gets its file, the chapter plays through from
// the files already in, the whole script is edited as text, and the cuts are listed.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";
const FILES = "http://127.0.0.1:8766";
const RECORD = process.env.RECORD_VIDEO === "1";
if (RECORD) {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 200 },
  });
}
const pause = (ms: number) => (RECORD ? new Promise((done) => setTimeout(done, ms)) : null);

test("a lesson is planned line by line and its takes come in", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Chowderr Test");
  await page.locator("#email").fill(`story.${stamp}@example.test`);
  await page.locator("#password").fill("storyboard-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Otaku Lessons");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: /Yes, I Have One/ }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  await page.goto("/projects/new");
  await page.getByLabel("Name", { exact: true }).fill("Part 1: AnyPress");
  await page.getByText("Start empty", { exact: true }).click();
  await page.getByRole("button", { name: "Make project" }).click();
  await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/);

  // No storyboard yet: paste the lesson.
  await page.getByRole("tab", { name: "Storyboard" }).click();
  await expect(page).toHaveURL(/view=storyboard/);
  await expect(page.getByText("Plan the video line by line")).toBeVisible();
  await pause(1500);
  await page.getByLabel("Script", { exact: true }).fill(LESSON_STORYBOARD);
  await expect(page.getByText(/15 chapters · 59 takes · about \d+ min/)).toBeVisible();
  await pause(1500);
  await page.getByRole("button", { name: "Make the storyboard" }).click();

  const chapters = page.getByRole("navigation", { name: "Chapters" });
  await expect(chapters.getByRole("listitem")).toHaveCount(15);
  await expect(page.getByText(/15 chapters · 59 takes/)).toBeVisible();
  const progress = page.getByRole("list", { name: "Progress" });
  await expect(progress).toContainText("Takes from you");
  await expect(progress).toContainText("0 of 59");
  const takes = page.getByRole("list", { name: "Takes" });
  await expect(takes.locator("[data-take]")).toHaveCount(2);
  await expect(takes.getByRole("img", { name: "Full Screen layout" })).toBeVisible();
  await expect(takes.getByRole("img", { name: "Panel layout" })).toBeVisible();
  await pause(2500);

  // Another chapter, with a page recording and your screen in it.
  await chapters.getByRole("button", { name: /Written rules in every repository/ }).click();
  await expect(takes.getByText("Take 14", { exact: true })).toBeVisible();
  await expect(takes.locator('[data-take="14"]')).toContainText("Page recording");
  await pause(2000);
  await chapters.getByRole("button", { name: /A thread for every job/ }).click();
  await expect(takes.locator('[data-take="10"]')).toContainText("Needs your screen");
  await pause(2000);

  // The first take gets its recording, and is moved into a Panel.
  await chapters.getByRole("button", { name: /Cold open/ }).click();
  const first = takes.locator('[data-take="1"]');
  await first.getByRole("button", { name: /Take 1/ }).click();
  await pause(1200);
  await first.getByRole("button", { name: "Link" }).click();
  await first.getByLabel("You file link", { exact: true }).fill(`${FILES}/cold-open-take.webm`);
  await pause(800);
  await first.getByRole("button", { name: "Add" }).click();
  await expect(first.getByRole("button", { name: /Take 1/ })).toContainText("Take in");
  await expect(progress).toContainText("1 of 59");
  await pause(1500);

  const line = first.getByRole("textbox", { name: "What is said" });
  await line.fill("I have never known how to code. In 39 days, Claude and I merged 881 changes.");
  await line.blur();
  await expect(first).toContainText("I have never known how to code. In 39 days");
  await pause(1200);

  // The chapter plays through: the take with a file plays, the other shows its line.
  const preview = page.getByRole("complementary", { name: "Preview" });
  await expect(preview).toContainText("1 of 2 takes have a file");
  await preview.getByRole("button", { name: "Play chapter" }).click();
  await expect(preview.locator("video")).toBeVisible();
  await expect(preview.getByText(/Take 2 · 2 of 2/)).toBeVisible({ timeout: 30_000 });
  await expect(preview.getByTestId("take-card")).toContainText("This is how the work is set up");
  await pause(2500);

  // A take added at the end of the chapter, then the whole script edited as text.
  await page.getByLabel("New take's line", { exact: true }).fill("Here is what you will see.");
  await page.getByRole("button", { name: "Add take" }).click();
  await expect(takes.locator("[data-take]")).toHaveCount(3);
  await expect(page.getByText(/15 chapters · 60 takes/)).toBeVisible();
  await pause(1500);

  await page.getByRole("radio", { name: "Script" }).click();
  const script = page.getByRole("textbox", { name: "Script" });
  await expect(script).toHaveValue(/## Cold open\n\[Full Screen · You\] I have never known/);
  const text = await script.inputValue();
  await script.fill(text.replace("## Cold open", "## The cold open"));
  await pause(1200);
  await page.getByRole("button", { name: "Save script" }).click();
  await expect(page.getByText("Saved: 15 chapters, 60 takes.")).toBeVisible();
  await page.getByRole("radio", { name: "Storyboard" }).click();
  await expect(chapters).toContainText("The cold open");
  // The edited line kept its file.
  await expect(progress).toContainText("1 of 60");
  await pause(1500);

  // The cuts made from it.
  const cuts = page.getByRole("region", { name: "Cuts from this storyboard" });
  await cuts.getByLabel("Cut", { exact: true }).fill("Full lesson");
  await cuts.getByLabel("Where it goes", { exact: true }).fill("YouTube · 16:9 · about 16 min");
  await cuts.getByRole("button", { name: "Add" }).click();
  await cuts.getByLabel("Cut", { exact: true }).fill("Ask your AI prompts");
  await cuts.getByLabel("Where it goes", { exact: true }).fill("Shorts, Reels, TikTok · 9:16");
  await cuts.getByRole("button", { name: "Add" }).click();
  await expect(cuts.getByRole("listitem")).toHaveCount(2);
  await pause(2500);

  // It stays after a reload, on the Storyboard tab.
  await page.reload();
  await expect(chapters.getByRole("listitem")).toHaveCount(15);
  await expect(cuts.getByRole("listitem")).toHaveCount(2);
});
