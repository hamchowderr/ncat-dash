import { expect, test } from "./test";

// The Library shows each video, in a real browser: a file sent from the computer appears
// as a tile with its own frame, plays without sound under the pointer, keeps its frame in
// the list view, and opens onto its own page with a full player.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";

test("an uploaded video is shown, played and opened on the Library", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Rae Okafor");
  await page.locator("#email").fill(`rae.${stamp}@example.test`);
  await page.locator("#password").fill("uploads-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Okafor Edits");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/settings/toolkit");
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();

  await page.goto("/library");
  await page.getByLabel("Choose files to upload").setInputFiles("e2e/fixtures/clip.webm");

  // The tile shows the video's own frame once it is in.
  const tile = page.getByTestId("library-tile").filter({ hasText: "clip" });
  await expect(tile).toBeVisible({ timeout: 30_000 });
  await expect(tile.getByText(/0:06/)).toBeVisible({ timeout: 30_000 });
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

  // The list view keeps the frame at the start of the row, and is remembered.
  await page.getByRole("button", { name: "List", exact: true }).click();
  const row = page.getByTestId("library-row").filter({ hasText: "clip" });
  await expect(row.getByTestId("upload-frame-video")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Opened, it plays at full size on its own page.
  await row.getByLabel(/^Open V\d+ clip$/).click();
  await expect(page).toHaveURL(/\/library\/[a-z0-9]+$/);
  const player = page.getByTestId("library-player");
  await expect(player).toBeVisible();
  await page.goto("/library");

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const sideways = await page.evaluate(
      () => document.scrollingElement!.scrollWidth > innerWidth + 1,
    );
    expect(sideways, `the page scrolls sideways at ${width}`).toBe(false);
  }
});
