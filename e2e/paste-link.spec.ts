import { expect, test } from "./test";

// A video from a pasted link, in a real browser against a real backend: the stand-in
// toolkit "downloads" it into the team's folder and it shows in Uploads under its title.
// A site that wants a sign-in says to add cookies; with cookies added in Settings, Video
// Links, the same link comes in.

const TOOLKIT = "http://127.0.0.1:8767";
const stamp = Date.now().toString(36);
if (process.env.RECORD_VIDEO === "1") {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 250 },
  });
}

const COOKIES = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n";

test("a pasted link comes into Uploads, and cookies get past a sign-in", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/sign-up");
  await page.locator("#name").fill("Rosa Mendes");
  await page.locator("#email").fill(`rosa.links.${stamp}@example.test`);
  await page.locator("#password").fill("links-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill(`Mendes Media ${stamp}`);
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: /Yes, I Have One/ }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  await page.goto("/uploads");
  await page
    .getByLabel("Paste a link to a video")
    .fill("https://www.tiktok.com/@mendes/video/7301");
  await page.getByRole("button", { name: "Bring in" }).click();
  await expect(page.getByRole("button", { name: "Open Crew interview reel.webm" })).toBeVisible({
    timeout: 60_000,
  });

  // YouTube asks a server to sign in.
  const youtube = "https://www.youtube.com/watch?v=needs-sign-in";
  await page.getByLabel("Paste a link to a video").fill(youtube);
  await page.getByRole("button", { name: "Bring in" }).click();
  await expect(page.getByText(/asks for a sign-in before it shares this video/)).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("link", { name: "Settings, Video Links" }).click();
  await expect(page).toHaveURL(/\/settings\/video-links/);
  await page.getByLabel("cookies.txt", { exact: true }).fill(COOKIES);
  await page.getByRole("button", { name: "Save cookies" }).click();
  await expect(page.getByText("For youtube.com")).toBeVisible();

  await page.goto("/uploads");
  await page.getByRole("button", { name: "Put away" }).click();
  await expect(page.getByText(/asks for a sign-in/)).toBeHidden();
  await page.getByLabel("Paste a link to a video").fill(youtube);
  await page.getByRole("button", { name: "Bring in" }).click();
  await expect(page.getByRole("button", { name: "Open Crew interview reel.webm" })).toHaveCount(
    2,
    { timeout: 60_000 },
  );
});
