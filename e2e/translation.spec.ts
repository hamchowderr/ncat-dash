import { readFile } from "node:fs/promises";

import { expect, pick, test } from "./test";

// Translating a video, in a real browser: an upload is transcribed on the (stand-in)
// toolkit as it comes in, then translated into Spanish once by the agent server's model
// (played back from a recorded answer). The Spanish lines keep the original subtitles'
// times, show as SRT, download named after the language, and can be corrected by hand.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";

test("a video is translated once, keeps its times, and a line can be corrected", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/sign-up");
  await page.locator("#name").fill("Ines Duarte");
  await page.locator("#email").fill(`ines.translate.${stamp}@example.test`);
  await page.locator("#password").fill("translate-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Duarte Subtitles");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({ timeout: 30_000 });
  await page.goto("/settings/toolkit");
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();

  await page.goto("/uploads");
  await page.getByLabel("Choose files to upload").setInputFiles("e2e/fixtures/clip.webm");
  await expect(page.getByRole("button", { name: "Open clip.webm" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/library");
  await page.getByRole("link", { name: "Open V1 clip" }).click();
  await expect(
    page.getByTestId("transcript").getByText("Today we talk about pricing your edits."),
  ).toBeVisible({ timeout: 30_000 });

  // The original subtitles, to compare the translation's times with.
  await page.getByRole("radio", { name: "SRT" }).click();
  const original = (await page.getByTestId("subtitle-text").textContent()) ?? "";
  const originalTimes = original.match(/\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}/g) ?? [];
  expect(originalTimes.length).toBeGreaterThan(1);
  await page.getByRole("radio", { name: "Transcript" }).click();

  // Translated once, into a language picked from the list.
  await page.getByRole("button", { name: "Translate", exact: true }).click();
  await page.getByRole("combobox", { name: "Find a language" }).fill("Spanish");
  await page.getByRole("option", { name: "Spanish", exact: true }).click();
  const lines = page.getByTestId("translation");
  await expect(lines).toBeVisible({ timeout: 60_000 });
  await expect(lines.getByRole("listitem")).toHaveCount(originalTimes.length);
  await expect(page.getByLabel("Language")).toContainText("Spanish");

  // Line for line on the original times.
  await page.getByRole("radio", { name: "SRT" }).click();
  const spanish = (await page.getByTestId("subtitle-text").textContent()) ?? "";
  expect(spanish.match(/\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}/g)).toEqual(originalTimes);
  expect(spanish).not.toContain("Today we talk about pricing your edits.");

  await page.getByRole("button", { name: "Download" }).click();
  const saving = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "SRT subtitles (.srt)" }).click();
  const download = await saving;
  expect(download.suggestedFilename()).toBe("clip.es.srt");
  expect(await readFile((await download.path())!, "utf8")).toBe(spanish);

  // A line corrected by hand keeps its time.
  await page.getByRole("radio", { name: "Transcript" }).click();
  await lines.getByRole("listitem").first().hover();
  await page.getByRole("button", { name: "Correct the line at 0:00" }).click();
  await page.getByLabel("Line at 0:00").fill("Bienvenidos de nuevo a la estación.");
  await page.getByLabel("Line at 0:00").press("Enter");
  await expect(lines.getByText("Bienvenidos de nuevo a la estación.")).toBeVisible();
  await page.reload();
  await pick(page.getByLabel("Language"), "Spanish");
  await expect(
    page.getByTestId("translation").getByText("Bienvenidos de nuevo a la estación."),
  ).toBeVisible();

  // Back to the original words, from the same picker.
  await pick(page.getByLabel("Language"), "Original");
  await expect(
    page.getByTestId("transcript").getByText("Today we talk about pricing your edits."),
  ).toBeVisible();

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const sideways = await page.evaluate(
      () => document.scrollingElement!.scrollWidth > innerWidth + 1,
    );
    expect(sideways, `the page scrolls sideways at ${width}`).toBe(false);
  }
});
