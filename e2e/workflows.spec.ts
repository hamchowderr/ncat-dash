import { expect, type Page, test } from "./test";

// Workflows in a real browser against a real backend: two linked automations made one
// workflow from the Chain tab, switched on together, and one review at the end of the
// chain instead of an approval in each piece. Its steps are switched off, so the runs
// need no toolkit.

const stamp = Date.now().toString(36);
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

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function save(page: Page) {
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
}

test("a chain becomes one workflow with one review at the end", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Rae Kim");
  await page.locator("#email").fill(`rae.workflow.${stamp}@example.test`);
  await page.locator("#password").fill("workflows-e2e-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Ad Shop");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible();

  // Cut clips ends in an Approval step of its own.
  await newAutomation(page, "Cut clips");
  await addStep(page, "Caption video");
  await page.getByRole("switch", { name: "Turn this step off" }).click();
  await addStep(page, "Approval");
  await save(page);
  const cutUrl = page.url();

  // Add captions starts when Cut clips works.
  await newAutomation(page, "Add captions");
  await page.locator(".react-flow__node-trigger").click();
  await pick(page, "What starts it", "Another automation finishes");
  await pick(page, "Which automation", "Cut clips");
  await addStep(page, "Caption video");
  await page.getByRole("switch", { name: "Turn this step off" }).click();
  await save(page);

  // From the Chain tab, the two become one workflow.
  await page.getByRole("tab", { name: /Chain/ }).click();
  const bar = page.getByRole("region", { name: "Workflow" });
  await expect(bar).toContainText("Make these 2 automations one workflow");
  await bar.getByRole("button", { name: "Make it a workflow" }).click();
  const dialog = page.getByRole("dialog", { name: "Make it a workflow" });
  await dialog.getByLabel("Name").fill("Weekly UGC");
  await dialog.getByRole("radio", { name: /UGC and ads/ }).click();
  await expect(
    dialog.getByRole("switch", { name: "One review before the files go out" }),
  ).toBeChecked();
  await expect(
    dialog.getByText(/The Approval steps in Cut clips are passed through/),
  ).toBeVisible();
  await page.waitForTimeout(800);
  await dialog.getByRole("button", { name: "Make workflow" }).click();
  await expect(bar).toContainText("Weekly UGC");
  await expect(bar).toContainText("One review before the files go out: Anyone on the team");
  const canvas = page.getByTestId("chain-canvas");
  await expect(canvas.getByRole("article", { name: "Add captions" })).toContainText(
    "Reviewed here before the files go out",
  );
  await expect(canvas.getByRole("article", { name: "Cut clips" })).toContainText(
    "covered by the workflow's review",
  );

  // One switch turns both on.
  await bar.getByRole("switch", { name: /Weekly UGC is off/ }).click();
  await expect(bar.getByText("On", { exact: true })).toBeVisible();
  await expect(canvas.getByRole("article", { name: "Cut clips" })).toContainText("On");
  await page.waitForTimeout(800);

  // Cut clips' own approval passes straight on, and Add captions starts.
  await page.goto(cutUrl);
  await page.getByRole("button", { name: "Run now" }).click();
  await page.getByRole("button", { name: "Run without a file" }).click();
  await expect(page).toHaveURL(/\/runs\/[a-z0-9]+$/, { timeout: 30_000 });
  await expect(
    page.getByText("Passed straight on: the workflow's one review at the end covers it."),
  ).toBeVisible();
  const follower = page.getByRole("link", { name: /Then started Add captions/ });
  await expect(follower).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1000);
  await follower.click();

  // The one review waits at the end of Add captions, and approving it finishes the run.
  await expect(page.getByRole("heading", { name: "Add captions", level: 1 })).toBeVisible();
  const review = page.locator("[data-step=workflow-review]");
  await expect(review.getByText("Waiting for someone to check the files.")).toBeVisible();
  await page.waitForTimeout(800);
  await review.getByRole("button", { name: "Approve" }).click();
  await expect(review.getByText("Approved by Rae Kim.")).toBeVisible();
  await page.waitForTimeout(1500);
});
