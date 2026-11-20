import { expect, test } from "./test";

// Hook variants and length cuts in a real browser: they sit together in the one list of
// ready-mades, and UGC Ad Variants opens as variants, length cuts, three ad shapes and
// captioned copies, with each other take picked on the first step.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";
const FILES = "http://127.0.0.1:8766";
if (process.env.RECORD_VIDEO === "1") {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 250 },
  });
}
const pause = (ms: number) =>
  process.env.RECORD_VIDEO === "1" ? new Promise((done) => setTimeout(done, ms)) : null;

test("UGC Ad Variants opens as variants, cuts, shapes and captions, with its takes picked", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Rae Okafor");
  await page.locator("#email").fill(`rae.${stamp}@example.test`);
  await page.locator("#password").fill("variants-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Okafor UGC");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: /Yes, I Have One/ }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  // One category in the one list, for every kind of video.
  await page.goto("/automations/new");
  await page.getByRole("button", { name: /^Hooks, lengths and ad variants \d+$/ }).click();
  const variants = page.getByRole("region", { name: /^Hooks, lengths and ad variants/ });
  for (const name of [
    "UGC Ad Variants",
    "Ad Length Cuts In Every Shape",
    "Teasers In Three Lengths",
    "Opening Line Tests",
    "Hook And Ending Variants",
    "Length Cuts",
  ]) {
    await expect(variants.getByText(name, { exact: true })).toBeVisible();
  }
  await pause(2500);

  await variants.getByText("UGC Ad Variants", { exact: true }).click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  // Variants, length cuts, three shapes and a captioned copy of each.
  const steps = page.locator(".react-flow__node-step");
  await expect(steps).toHaveCount(8);
  await pause(2000);

  // The first step takes the base cut from the run and asks for the other takes.
  await expect(async () => {
    await steps.first().click();
    await expect(page.getByText("Hook take 2", { exact: true })).toBeVisible({ timeout: 2000 });
  }).toPass();
  await page.getByLabel("Hook take 2: address of the file").fill(`${FILES}/hooks/hook_02.mp4`);
  await pause(600);
  await page.getByLabel("Hook take 3: address of the file").fill(`${FILES}/hooks/hook_03.mp4`);
  await pause(600);
  await page.getByLabel("Ending take 2: address of the file").fill(`${FILES}/hooks/cta_02.mp4`);
  await pause(2000);

  // The length cuts keep the call to action on 6, 15, 30 and 60 second cuts.
  await steps.nth(1).click();
  await expect(page.locator("input[value='6, 15, 30, 60']")).toBeVisible();
  await pause(2500);
});
