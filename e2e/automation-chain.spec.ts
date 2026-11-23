import { expect, type Page, test } from "./test";

// Automations that start other automations, in a real browser against a real backend: a
// Run an automation step, a run page that links the two runs, a loop refused on save, and
// an automation that starts by itself when another one finishes.

const stamp = Date.now().toString(36);
// RECORD_VIDEO=1 keeps a screen recording of the run, slowed down so it can be followed.
if (process.env.RECORD_VIDEO === "1") {
  test.use({
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 350 },
  });
}

async function newAutomation(page: Page, name: string) {
  await page.goto("/automations");
  await page.getByRole("link", { name: "New automation", exact: true }).click();
  await expect(page).toHaveURL(/\/automations\/new$/);
  await page.getByRole("button", { name: "Empty canvas" }).first().click();
  await expect(page).toHaveURL(/\/automations\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
  await page.getByLabel("Automation name").fill(name);
}

async function addStep(page: Page, title: string) {
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByLabel("Search steps").fill(title);
  await page
    .getByRole("complementary", { name: "Steps you can add" })
    .getByRole("button", { name: title, exact: true })
    .click();
}

/** A step that is turned off finishes at once, so these runs need no toolkit. */
async function addQuickStep(page: Page) {
  await addStep(page, "Caption video");
  await page.getByRole("switch", { name: "Turn this step off" }).click();
}

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function save(page: Page) {
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
}

test("one automation runs another, links the runs, refuses a loop, and starts a follower", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Rae Kim");
  await page.locator("#email").fill(`rae.chain.${stamp}@example.test`);
  await page.locator("#password").fill("automation-chain-e2e-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Chain Shop");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible();

  await newAutomation(page, "Make captions");
  await addQuickStep(page);
  await save(page);
  const captionsUrl = page.url();

  // The step picks the other automation by name and waits for it.
  await newAutomation(page, "Make clips");
  await addStep(page, "Run an automation");
  await pick(page, "Automation to run", "Make captions");
  await expect(page.getByRole("switch", { name: "Wait for it to finish" })).toBeChecked();
  await save(page);
  const clipsUrl = page.url();

  await page.getByRole("button", { name: "Run now" }).click();
  await page.getByRole("button", { name: "Run without a file" }).click();
  await expect(page).toHaveURL(/\/runs\/[a-z0-9]+$/, { timeout: 30_000 });
  const toCaptions = page.getByRole("link", { name: /Run of Make captions/ });
  await expect(toCaptions).toContainText("Done");
  await expect(
    page.getByText("Its run finished, and its files carried on from here."),
  ).toBeVisible();
  await page.waitForTimeout(1500);

  // The run it started links back.
  await toCaptions.click();
  await expect(page.getByRole("heading", { name: "Make captions", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /Started by a run of Make clips/ })).toBeVisible();
  await page.waitForTimeout(1500);

  // Making Make captions run Make clips back would loop, and saving says so.
  await page.goto(captionsUrl);
  await addStep(page, "Run an automation");
  await pick(page, "Automation to run", "Make clips");
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByText("Saved, but it cannot run yet")).toBeVisible();
  await expect(
    page.getByText(
      "This would make automations start each other in a loop: Make captions → Make clips → Make captions. Remove one of those links.",
    ),
  ).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Remove step" }).click();
  await save(page);

  // An automation that starts by itself when Make clips finishes.
  await newAutomation(page, "Share clips");
  await page.locator(".react-flow__node-trigger").click();
  await pick(page, "What starts it", "Another automation finishes");
  await pick(page, "Which automation", "Make clips");
  await expect(page.getByRole("combobox", { name: "Start after it" })).toContainText("Works");
  await addQuickStep(page);
  await save(page);
  await page.getByRole("switch", { name: "Off" }).click();
  await expect(page.getByText("On", { exact: true })).toBeVisible();
  await page.waitForTimeout(1000);

  await page.goto(clipsUrl);
  await page.getByRole("button", { name: "Run now" }).click();
  await page.getByRole("button", { name: "Run without a file" }).click();
  await expect(page).toHaveURL(/\/runs\/[a-z0-9]+$/, { timeout: 30_000 });
  const follower = page.getByRole("link", { name: /Then started Share clips/ });
  await expect(follower).toContainText("Done");
  await page.waitForTimeout(1500);
  await follower.click();
  await expect(page.getByRole("heading", { name: "Share clips", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /Started by a run of Make clips/ })).toBeVisible();
  await page.waitForTimeout(1500);
});
