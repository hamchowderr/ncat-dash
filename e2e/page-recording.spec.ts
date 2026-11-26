import { expect, pick, test } from "./test";

// A storyboard take marked "Page recording", in a real browser against a real backend and
// the real agent server: the take is put in line, Convex hands it to the agent server, and
// what the agent answers comes back onto the take. The agent server here has no Firecrawl
// key, so the take ends "Not recorded" with the reason a self-hoster can act on, and a
// sign-in cannot open a browser either. The recording itself is tested on the agent server
// (packages/agent/tests/unit/page-recording.test.ts) and in convex/pageRecordings.test.ts.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";
// PAGE_RECORDING_SHOTS=dir saves screenshots of the take along the way.
const SHOTS = process.env.PAGE_RECORDING_SHOTS;

test("a take is recorded from a web page by the agent, and says why when it cannot be", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Maya Ortiz");
  await page.locator("#email").fill(`maya.record.${stamp}@example.test`);
  await page.locator("#password").fill("record-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Example Studio");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/settings/toolkit");
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText("Your own toolkit", { exact: true })).toBeVisible();

  await page.goto("/projects/new");
  await page.getByLabel("Name", { exact: true }).fill("Pricing walkthrough");
  await page.getByText("Start empty", { exact: true }).click();
  await page.getByRole("button", { name: "Make project" }).click();
  await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/);
  await page.getByRole("tab", { name: "Storyboard" }).click();
  await page
    .getByLabel("Script", { exact: true })
    .fill("## Plans\n[Full Screen · Page recording] Here are the plans, and what each one has.");
  await page.getByRole("button", { name: "Make the storyboard" }).click();

  const take = page.locator('[data-take="1"]');
  await take.getByRole("button", { name: /Take 1/ }).click();
  await take.getByRole("button", { name: "Record the page" }).click();
  const form = take.getByRole("form", { name: "Record the page" });
  await form.getByLabel("Page address").fill("example.com/pricing");
  await form.getByLabel("What to show").fill("Scroll to the yearly plans");
  if (SHOTS) await take.screenshot({ path: `${SHOTS}/1-record-form.png` });
  await form.getByRole("button", { name: "Record" }).click();

  const recording = take.getByLabel("Where the recording stands");
  await expect(recording.getByRole("status")).toHaveText("Not recorded", { timeout: 60_000 });
  await expect(recording).toContainText("https://example.com/pricing");
  await expect(recording).toContainText("Page recordings need a Firecrawl key");
  if (SHOTS) await take.screenshot({ path: `${SHOTS}/2-not-recorded.png` });

  // Trying again opens the form with the page given before.
  await recording.getByRole("button", { name: "Try again" }).click();
  await expect(form.getByLabel("Page address")).toHaveValue("https://example.com/pricing");

  // A sign-in needs a Firecrawl browser too.
  await pick(form.getByRole("combobox", { name: "Sign in as" }), "Add a sign-in");
  const signIn = take.getByRole("form", { name: "New sign-in" });
  await signIn.getByLabel("Name it").fill("Example Studio admin");
  await signIn.getByLabel("The site's sign-in page").fill("https://app.example.com/login");
  if (SHOTS) await take.screenshot({ path: `${SHOTS}/3-add-sign-in.png` });
  await signIn.getByRole("button", { name: "Open the sign-in page" }).click();
  await expect(signIn.getByRole("alert")).toContainText("Firecrawl key");
  if (SHOTS) await take.screenshot({ path: `${SHOTS}/4-sign-in-needs-firecrawl.png` });
});
