import { type Browser, expect, type Page, test } from "./test";

// Uploads and review on a phone, in a real browser held like one (390×844, touch): a video
// sent from the camera roll, opened on the whole screen; a review where the note box sits
// under the clip and the decision waits along the bottom; and a client deciding from the
// share link on their own phone. Nothing scrolls sideways and nothing covers the clips.

const TOOLKIT = "http://127.0.0.1:8767";
const FILES = "http://127.0.0.1:8766";
const stamp = Date.now().toString(36);
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

test.describe.configure({ mode: "serial" });

let owner: Page;
let shareUrl: string;

async function phone(browser: Browser): Promise<Page> {
  return await (await browser.newContext(PHONE)).newPage();
}

async function noSideways(page: Page) {
  const wide = await page.evaluate(() => document.scrollingElement!.scrollWidth > innerWidth + 1);
  expect(wide, "the page scrolls sideways").toBe(false);
}

/** The element's box lies inside the window, under nothing. */
async function onScreen(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(844 + 0.5);
  expect(box!.y).toBeGreaterThan(0);
}

test.beforeAll(async ({ browser }) => {
  owner = await phone(browser);
  await owner.goto("/sign-up");
  await owner.locator("#name").fill("Ines Duarte");
  await owner.locator("#email").fill(`ines.${stamp}@example.test`);
  await owner.locator("#password").fill("phones-e2e-123456");
  await owner.getByRole("button", { name: "Create account" }).click();
  await expect(owner).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await owner.getByPlaceholder("Your company or channel").fill("Duarte Media");
  await owner.getByRole("button", { name: "Create team" }).click();
  await owner.getByRole("button", { name: /Yes, I Have One/ }).click();
  await owner.locator("#baseUrl").fill(TOOLKIT);
  await owner.locator("#apiKey").fill("stand-in-key-1234");
  await owner.getByRole("button", { name: "Test and connect" }).click();
  await expect(owner.getByText(/Your toolkit answered/)).toBeVisible();
});

test.afterAll(async () => {
  await owner?.context().close();
});

test("a video sent from the phone shows as a tile and opens on the whole screen", async () => {
  await owner.goto("/uploads");
  await expect(owner.getByText("Choose videos and photos from your phone.")).toBeVisible();
  await expect(owner.getByText(/Drop files here/)).toBeHidden();
  // The button is big enough for a thumb.
  const choose = owner.getByRole("button", { name: "Choose files", exact: true });
  expect((await choose.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await owner.getByLabel("Choose files to upload").setInputFiles("e2e/fixtures/clip.webm");
  const tile = owner.getByRole("button", { name: "Open clip.webm" });
  await expect(tile).toBeVisible({ timeout: 30_000 });
  await expect(owner.getByText("Video · 0:06 · 180×320 · 45 KB")).toBeVisible({ timeout: 30_000 });
  // Two across: a tile is about half the width.
  const width = (await tile.boundingBox())!.width;
  expect(width).toBeLessThan(200);
  // No list to switch to: nine columns do not fit across a phone.
  await expect(owner.getByRole("button", { name: "List", exact: true })).toBeHidden();
  await noSideways(owner);

  await tile.tap();
  const dialog = owner.getByRole("dialog");
  await expect(dialog.getByTestId("upload-player")).toBeVisible();
  // Once it has grown in, it is the whole screen.
  await expect
    .poll(async () => {
      const box = (await dialog.boundingBox())!;
      return [box.x, box.y, box.width, box.height].map(Math.round);
    })
    .toEqual([0, 0, 390, 844]);
  const copy = dialog.getByRole("button", { name: "Copy link" });
  await copy.scrollIntoViewIfNeeded();
  expect((await copy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await dialog.getByRole("button", { name: "Close" }).tap();
  await expect(dialog).toBeHidden();
});

test("the review room fits the phone, with the decision along the bottom", async () => {
  await owner.goto("/automations");
  await owner
    .getByLabel("Automation file to import")
    .setInputFiles("e2e/fixtures/weekly-clips.automation.json");
  await expect(owner).toHaveURL(/\/automations\/.+/);
  await owner.getByRole("switch").first().tap();
  await expect(owner.getByRole("switch").first()).toBeChecked();
  await owner.locator(".react-flow__node-trigger").tap();
  const address = await owner.locator("#trigger-address").inputValue();
  const started = await fetch(address, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_url: `${FILES}/station-interview.webm` }),
  });
  expect(started.status).toBe(202);

  // The menu slides in over the page, and picking a page in it puts it away again.
  await owner.getByRole("button", { name: "Toggle Sidebar" }).tap();
  const menuLink = owner.getByRole("link", { name: "Review", exact: true });
  await menuLink.tap();
  await expect(owner).toHaveURL(/\/review$/);
  await expect(menuLink).toBeHidden();
  const card = owner.getByRole("link", { name: /Weekly clips/ });
  await expect(card).toContainText("In review", { timeout: 60_000 });
  await card.tap();
  await expect(owner).toHaveURL(/\/review\/.+/);
  await expect(owner.getByRole("heading", { name: /Clip 1 of 2/ })).toBeVisible();

  // The decision is at the bottom of the screen, and the page itself does not scroll: the
  // room scrolls inside, above the buttons, so they never sit over a clip or a comment.
  const bar = owner.locator("[data-decision-bar]");
  await expect(bar.getByRole("button", { name: "Approve" })).toBeVisible();
  await expect(bar.getByText(/An automation is paused on this review/)).toBeVisible();
  await onScreen(owner, "[data-decision-bar]");
  const approveBox = (await bar.getByRole("button", { name: "Approve" }).boundingBox())!;
  expect(approveBox.height).toBeGreaterThanOrEqual(44);
  expect(
    await owner.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight + 1),
    "the page scrolls instead of the room",
  ).toBe(true);
  await noSideways(owner);

  // A tall clip leaves room under it: the note box is straight below the player.
  const stage = owner.locator('section[aria-label="Clip"]');
  expect((await stage.boundingBox())!.height).toBeLessThan(844 * 0.8);
  const box = owner.getByRole("textbox", { name: /^Comment at this moment/ });
  const list = owner.locator('section[aria-label="Comments"]').getByText(/Pause where something/);
  expect((await box.boundingBox())!.y).toBeLessThan((await list.boundingBox())!.y);
  // Big enough text that the phone does not zoom in when it is tapped.
  expect(await box.evaluate((field) => getComputedStyle(field).fontSize)).toBe("16px");

  // Pause at a moment and write a note there.
  await stage.getByRole("slider").fill("2");
  await box.tap();
  await box.fill("Trim the first second here.");
  await box.press("Enter");
  const thread = owner.locator('section[aria-label="Comments"]').getByRole("listitem").first();
  await expect(thread).toContainText("Trim the first second here.");
  await expect(thread.getByRole("button", { name: "Jump to 0:02" })).toBeVisible();
  // Your own note can be deleted without a hover to reveal the button.
  await expect(thread.getByRole("button", { name: "Delete your comment" })).toBeVisible();

  // Share with a client from the icon in the top row.
  await owner.getByRole("button", { name: "Share" }).tap();
  const share = owner.getByRole("dialog", { name: "Share with a client" });
  await share.getByRole("button", { name: "Create link" }).tap();
  const link = share.getByRole("textbox", { name: "Share link" });
  await expect(link).toHaveValue(/\/share\/[a-f0-9]{64}$/);
  shareUrl = await link.inputValue();
  await share.getByRole("button", { name: "Close" }).tap();
  await expect(share).toBeHidden();
});

test("a client decides from their own phone", async ({ browser }) => {
  const client = await phone(browser);
  await client.goto(shareUrl);
  await client.getByLabel("Your name").fill("Sol Rivera");
  await client.getByRole("button", { name: "Continue" }).tap();
  await expect(client.getByText("Reviewing as Sol Rivera")).toBeVisible();

  const bar = client.locator("[data-decision-bar]");
  await expect(bar.getByRole("button", { name: "Approve" })).toBeVisible();
  await onScreen(client, "[data-decision-bar]");
  await noSideways(client);
  await bar.getByRole("button", { name: "Approve" }).tap();
  await expect(bar.getByRole("status")).toHaveText("Sol Rivera approved");

  // The team sees the client's answer, and makes the call from the bottom of the screen.
  await expect(owner.locator('[data-client-verdict="approved"]')).toContainText(
    "Sol Rivera approved",
  );
  await owner.locator("[data-decision-bar]").getByRole("button", { name: "Approve" }).tap();
  await expect(owner.getByText(/Approved by Ines Duarte/)).toBeVisible();
  await expect(owner.locator("[data-decision-bar]")).toHaveCount(0);
  await expect(client.getByText("Approved by the team")).toBeVisible();
  await client.context().close();
});
