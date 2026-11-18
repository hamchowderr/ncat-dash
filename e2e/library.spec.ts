import { expect, test } from "@playwright/test";

// The content library, in a real browser: an uploaded video joins it with a short ID, is
// made searchable on the (stand-in) toolkit, and a search for something said in it lands
// on the moment it was said. Tags, stars and names change in place.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";

test("an upload joins the library, is searched by what was said, and is tagged", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Ines Duarte");
  await page.locator("#email").fill(`ines.${stamp}@example.test`);
  await page.locator("#password").fill("library-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Duarte Media");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  await page.goto("/uploads");
  await page.getByLabel("Choose files to upload").setInputFiles("e2e/fixtures/clip.webm");
  await expect(page.getByRole("button", { name: "Open clip.webm" })).toBeVisible({
    timeout: 30_000,
  });

  // In the library with its short ID, from the sidebar.
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  const tile = page.getByTestId("library-tile").filter({ hasText: "clip" });
  await expect(tile.getByText("V1", { exact: true })).toBeVisible();
  await expect(tile.getByText(/Uploaded/)).toBeVisible();

  // Made searchable: transcribed on the toolkit.
  await page.getByRole("button", { name: "Make 1 file searchable" }).click();
  await page.getByRole("link", { name: "Open V1 clip" }).click();
  const said = page.getByTestId("transcript");
  await expect(said.getByText("Today we talk about pricing your edits.")).toBeVisible({
    timeout: 30_000,
  });

  // Tags and stars, kept.
  await page.getByLabel("Add a tag").fill("pricing, behind the scenes");
  await page.getByLabel("Add a tag").press("Enter");
  await expect(
    page.getByRole("list", { name: "Tags" }).getByText("behind the scenes"),
  ).toBeVisible();
  await page.getByRole("radiogroup", { name: "Stars" }).getByLabel("4 stars").click();
  await expect(
    page.getByRole("radiogroup", { name: "Stars" }).getByLabel("4 stars"),
  ).toHaveAttribute("aria-checked", "true");

  // A search for what was said lands on the moment.
  await page.getByRole("link", { name: "Library", exact: true }).first().click();
  await page.getByLabel("Search the library").fill("pricing");
  const hit = page.getByTestId("library-hit");
  await expect(hit.getByText("V1", { exact: true })).toBeVisible();
  const moment = hit.getByRole("link", { name: /0:02/ });
  await expect(moment).toBeVisible();
  await moment.click();
  await expect(page).toHaveURL(/\/library\/.+\?t=2&q=pricing/);
  const player = page.getByTestId("library-player");
  await expect
    .poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThanOrEqual(2);
  await expect(said.locator("mark").first()).toHaveText("pricing");

  // Renamed in the list, with its tags and stars there too.
  await page.goto("/library");
  await page.getByRole("button", { name: "List", exact: true }).click();
  const row = page.getByTestId("library-row").filter({ hasText: "V1" });
  await expect(row.getByText("behind the scenes")).toBeVisible();
  await row.getByRole("button", { name: "Rename V1 clip" }).click();
  await row.getByLabel("Name of V1").fill("Station promo");
  await row.getByLabel("Name of V1").press("Enter");
  await expect(row.getByRole("button", { name: "Rename V1 Station promo" })).toBeVisible();

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const sideways = await page.evaluate(
      () => document.scrollingElement!.scrollWidth > innerWidth + 1,
    );
    expect(sideways, `the page scrolls sideways at ${width}`).toBe(false);
  }
});

test("a caption file shows its lines, and they are searched like what was said", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Ines Duarte");
  await page.locator("#email").fill(`ines.captions.${stamp}@example.test`);
  await page.locator("#password").fill("library-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Duarte Captions");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  await page.goto("/uploads");
  await page.getByLabel("Choose files to upload").setInputFiles("e2e/fixtures/clip.srt");
  // Finished uploading (the name shows while it is still on its way).
  await expect(page.getByRole("button", { name: "Open clip.srt" })).toBeVisible({
    timeout: 30_000,
  });

  await page.goto("/library");
  await page.getByRole("link", { name: "Open F1 clip" }).click();
  const lines = page.getByTestId("transcript");
  await expect(page.getByRole("heading", { name: "What the captions say" })).toBeVisible();
  await expect(lines.getByText("Today we talk about pricing your edits.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(lines.getByText("0:03")).toBeVisible();

  await page.getByRole("link", { name: "Library", exact: true }).first().click();
  await page.getByLabel("Search the library").fill("pricing");
  await expect(page.getByTestId("library-hit").getByText("F1", { exact: true })).toBeVisible();
});
