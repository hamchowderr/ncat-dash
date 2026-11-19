import { expect, test } from "@playwright/test";

// The Uploads page shows each video, in a real browser: a file sent from the computer
// appears as a tile with its own frame, plays without sound under the pointer, opens into
// a full player beside its details, and keeps its frame in the list view.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";

test("an uploaded video is shown, played and opened on Uploads", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Rae Okafor");
  await page.locator("#email").fill(`rae.${stamp}@example.test`);
  await page.locator("#password").fill("uploads-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Okafor Edits");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: /Yes, I Have One/ }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  await page.goto("/uploads");
  await page.getByLabel("Choose files to upload").setInputFiles("e2e/fixtures/clip.webm");

  // The tile shows the video's own frame once its details are read.
  const tile = page.getByRole("button", { name: "Open clip.webm" });
  await expect(tile).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Video · 0:06 · 180×320")).toBeVisible({ timeout: 30_000 });
  const frame = tile.getByTestId("upload-frame-video");
  await expect(frame).toBeVisible();
  await expect
    .poll(() => frame.evaluate((video: HTMLVideoElement) => video.readyState), {
      message: "the frame loads",
    })
    .toBeGreaterThan(0);
  expect(await frame.evaluate((video: HTMLVideoElement) => video.videoWidth)).toBe(180);

  // Under the pointer it plays, without sound.
  await tile.hover();
  await expect
    .poll(() => frame.evaluate((video: HTMLVideoElement) => !video.paused && video.muted))
    .toBe(true);
  await page.mouse.move(5, 5);
  await expect.poll(() => frame.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);

  // Opened, it plays at full size beside its details.
  await tile.click();
  const dialog = page.getByRole("dialog");
  const player = dialog.getByTestId("upload-player");
  await expect(player).toBeVisible();
  await expect
    .poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(0);
  await expect(dialog.getByText("180×320")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // The list view keeps every column, with the frame at the start of the row.
  await page.getByRole("button", { name: "List", exact: true }).click();
  const row = page.getByRole("row", { name: /clip\.webm/ });
  await expect(row.getByTestId("upload-frame-video")).toBeVisible();
  await expect(row.getByText("25 fps")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const sideways = await page.evaluate(
      () => document.scrollingElement!.scrollWidth > innerWidth + 1,
    );
    expect(sideways, `the page scrolls sideways at ${width}`).toBe(false);
  }
});
