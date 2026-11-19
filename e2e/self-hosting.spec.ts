import { expect, test } from "./test";

// The self-hosting pieces, in a real browser against a real backend: the Toolkit page
// reading how busy the toolkit is, a Drive share link turned into a download link, and a
// run that failed picked up from the step it stopped at.

const TOOLKIT = "http://127.0.0.1:8767";
const FILES = "http://127.0.0.1:8766";
const stamp = Date.now().toString(36);
// RECORD_VIDEO=1 keeps a screen recording of the run, slowed down so it can be followed.
if (process.env.RECORD_VIDEO === "1") {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 300 },
  });
}

/** Makes the stand-in toolkit refuse one endpoint's jobs, or stop refusing with null. */
async function failing(path: string | null) {
  await fetch(`${TOOLKIT}/__stand-in/fail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

test.afterEach(async () => failing(null));

test("shows the toolkit's load, fixes a share link, and picks a failed run up", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Ari Cole");
  await page.locator("#email").fill(`ari.selfhost.${stamp}@example.test`);
  await page.locator("#password").fill("self-hosting-e2e-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Harbour Films");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: /Yes, I Have One/ }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  // The Toolkit page: its build, CPU, memory, space and queue.
  await page.goto("/");
  await page.getByRole("link", { name: "Toolkit", exact: true }).click();
  await expect(page).toHaveURL(/\/toolkit$/);
  await expect(page.getByText(/build 214/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("region", { name: "CPU" })).toContainText("39%");
  await expect(page.getByRole("region", { name: "CPU" })).toContainText("Of 4 CPUs");
  await expect(page.getByRole("region", { name: "Queue" })).toContainText("2 of 4 workers busy");
  await page.waitForTimeout(4000);

  // A Drive share link pasted as the video is downloaded straight from Drive.
  await page.goto("/steps/video-thumbnail");
  const address = page.getByRole("textbox", { name: "Video URL" });
  await address.fill(
    "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing",
  );
  await expect(page.getByText(/Google Drive share link\. The file is downloaded/)).toBeVisible();
  await page.waitForTimeout(3500);
  await address.fill("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  await expect(page.getByRole("alert").filter({ hasText: /folder/i })).toBeVisible();
  await page.waitForTimeout(3500);

  // An automation whose thumbnail step fails: the toolkit refuses the picture.
  await failing("/v1/video/thumbnail");
  await page.goto("/automations");
  await page
    .getByLabel("Automation file to import")
    .setInputFiles("e2e/fixtures/episode-thumbnails.automation.json");
  await expect(page).toHaveURL(/\/automations\/.+/);
  await page.getByRole("switch").first().click();
  await expect(page.getByRole("switch").first()).toBeChecked();
  await page.locator(".react-flow__node-trigger").click();
  const hook = await page.locator("#trigger-address").inputValue();
  for (const episode of ["episode-12.webm", "episode-13.webm"]) {
    const started = await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_url: `${FILES}/${episode}` }),
    });
    expect(started.status).toBe(202);
  }

  // The Runs page lists both failures with the step each one stopped at.
  await page.getByRole("link", { name: "Runs", exact: true }).click();
  await expect(page).toHaveURL(/\/runs$/);
  await page.getByRole("tab", { name: /Failed/ }).click();
  await expect(page).toHaveURL(/show=failed/);
  const rows = page.locator("tr[data-run]");
  await expect(rows).toHaveCount(2, { timeout: 30_000 });
  await expect(rows.first()).toContainText("At Video thumbnail.");
  await page.waitForTimeout(2500);

  // The toolkit is fixed; one run is picked up on its own, then the rest all at once.
  await failing(null);
  await rows
    .first()
    .getByRole("button", { name: /Pick up/ })
    .click();
  await expect(page.getByText("Picked up the run where it stopped.")).toBeVisible();
  await expect(rows).toHaveCount(1, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /Pick up the failed run/ }).click();
  await expect(rows).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText(/No failed runs/)).toBeVisible();
  await page.waitForTimeout(1500);

  // Both finished, each picked up once, and the run page says so.
  await page.getByRole("tab", { name: "All runs" }).click();
  await expect(page.locator("tr[data-run]").filter({ hasText: "Picked up once" })).toHaveCount(2);
  await expect(page.locator("tr[data-run]").filter({ hasText: "Done" })).toHaveCount(2, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1500);
  await page.locator("tr[data-run]").first().getByRole("link", { name: /View/ }).click();
  await expect(page).toHaveURL(/\/runs\/[a-z0-9]+$/);
  await page.waitForTimeout(2500);
});
