import { type Browser, expect, type Page, test } from "@playwright/test";

// One story from start to finish, in a real browser against a real backend: two
// teammates, an automation that stops at an approval step, the room it opens, comments
// arriving live, a second version, and the approval that lets the run finish.

const TOOLKIT = "http://127.0.0.1:8767";
const FILES = "http://127.0.0.1:8766";
const PASSWORD = "review-room-e2e-1";
// A fresh pair of people each run, so the tests can run again on the same backend.
const stamp = Date.now().toString(36);
const jordanEmail = `jordan.${stamp}@example.test`;
const mayaEmail = `maya.${stamp}@example.test`;

async function signUp(browser: Browser, name: string, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/sign-up");
  await page.locator("#name").fill(name);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  return page;
}

/** Calls one of Better Auth's own endpoints as the person signed in on the page. */
async function auth<T>(page: Page, path: string, body?: unknown): Promise<T> {
  return await page.evaluate(
    async ([path, body]) => {
      const response = await fetch(`/api/auth/${path}`, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      return await response.json();
    },
    [path, body] as const,
  );
}

const stage = (page: Page) => page.locator('section[aria-label="Clip"]');
const comments = (page: Page) => page.locator('section[aria-label="Comments"]');
const commentBox = (page: Page) => page.getByRole("textbox", { name: /^Comment at this moment/ });

/** Moves the clip to a moment, as dragging the timeline would. */
async function seek(page: Page, seconds: number) {
  await expect(stage(page).getByText(/\/ 0:06/)).toBeVisible();
  await stage(page).getByRole("slider").fill(String(seconds));
}

test.describe.configure({ mode: "serial" });

let jordan: Page;
let maya: Page;
let roomUrl: string;

test.beforeAll(async ({ browser }) => {
  jordan = await signUp(browser, "Jordan Lee", jordanEmail);
  await jordan.getByPlaceholder("Your company or channel").fill("Salt House");
  await jordan.getByRole("button", { name: "Create team" }).click();
  await jordan.locator("#baseUrl").fill(TOOLKIT);
  await jordan.locator("#apiKey").fill("stand-in-key-1234");
  await jordan.getByRole("button", { name: "Test and connect" }).click();
  // Storage and brand can wait; the dashboard opens once the toolkit is connected.
  await expect(jordan.getByText(/Your toolkit answered/)).toBeVisible();
  await jordan.goto("/");
  await expect(jordan.getByRole("link", { name: "Review" })).toBeVisible();

  // There is no invite screen yet, so the second teammate joins through the auth API.
  maya = await signUp(browser, "Maya Ortiz", mayaEmail);
  const [team] = await auth<{ id: string }[]>(jordan, "organization/list");
  const invitation = await auth<{ id: string }>(jordan, "organization/invite-member", {
    email: mayaEmail,
    role: "member",
    organizationId: team.id,
  });
  await auth(maya, "organization/accept-invitation", { invitationId: invitation.id });
});

test.afterAll(async () => {
  await jordan?.context().close();
  await maya?.context().close();
});

test("Review starts empty and says how a review begins", async () => {
  await jordan.getByRole("link", { name: "Review" }).click();
  await expect(jordan.getByRole("heading", { name: "Review", level: 1 })).toBeVisible();
  await expect(jordan.getByText(/Nothing to review yet/)).toBeVisible();
});

test("an automation that reaches its approval step opens a room by itself", async () => {
  await jordan.goto("/automations");
  await jordan
    .getByLabel("Automation file to import")
    .setInputFiles("e2e/fixtures/weekly-clips.automation.json");
  await expect(jordan).toHaveURL(/\/automations\/.+/);
  await jordan.getByRole("switch").first().click();
  await expect(jordan.getByRole("switch").first()).toBeChecked();

  // Start it the way another tool would: by calling its address.
  await jordan.locator(".react-flow__node-trigger").click();
  const address = await jordan.locator("#trigger-address").inputValue();
  const started = await fetch(address, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_url: `${FILES}/station-interview.webm` }),
  });
  expect(started.status).toBe(202);

  await jordan.goto("/review");
  const card = jordan.getByRole("link", { name: /Weekly clips/ });
  await expect(card).toContainText("2 clips");
  await expect(card).toContainText("In review");
  await expect(card).toContainText("From an automation");
  await card.click();
  await expect(jordan).toHaveURL(/\/review\/.+/);
  roomUrl = jordan.url();

  await expect(jordan.getByText(/An automation is paused on this review/)).toBeVisible();
  const clips = jordan.getByRole("navigation", { name: "Clips in this review" });
  await expect(clips.getByRole("button")).toHaveCount(2);
  await expect(clips.getByRole("button", { name: /Opening hello/ })).toBeVisible();
  await expect(stage(jordan).getByRole("heading")).toContainText("Clip 1 of 2");
  await expect(jordan.getByText("Only you here")).toBeVisible();
});

test("a teammate who opens the room shows up for the others", async () => {
  await maya.goto(roomUrl);
  await expect(jordan.getByText("2 here now")).toBeVisible();
  await expect(jordan.getByRole("list", { name: "Here now" })).toContainText("Maya Ortiz");
  await expect(maya.getByText("2 here now")).toBeVisible();
});

test("a comment is pinned to its moment and reaches the others as it is written", async () => {
  await seek(maya, 2);
  await commentBox(maya).fill("The logo covers the mission patch here.");
  await commentBox(maya).press("Enter");

  const thread = comments(jordan).getByRole("listitem").first();
  await expect(thread).toContainText("Maya Ortiz");
  await expect(thread).toContainText("The logo covers the mission patch here.");
  await expect(thread.getByRole("button", { name: "Jump to 0:02" })).toBeVisible();
  await expect(comments(jordan).getByText("1 to resolve")).toBeVisible();
  await expect(
    jordan.getByRole("navigation", { name: "Clips in this review" }).getByText("1 to resolve"),
  ).toBeVisible();
});

test("the face on the timeline jumps to the comment", async () => {
  await expect(stage(jordan).getByText("0:00 / 0:06")).toBeVisible();
  await stage(jordan).getByRole("button", { name: "Maya Ortiz's comment at 0:02" }).click();
  await expect(stage(jordan).getByText("0:02 / 0:06")).toBeVisible();
});

test("a reply can tag a teammate, and the tag is marked", async () => {
  await comments(jordan).getByRole("button", { name: "Reply" }).click();
  const reply = jordan.getByRole("textbox", { name: "Reply" });
  await reply.pressSequentially("@Ma");
  await expect(jordan.getByRole("option", { name: /Maya Ortiz/ })).toBeVisible();
  await reply.press("Enter");
  await expect(reply).toHaveValue("@Maya Ortiz ");
  await reply.pressSequentially("fixing it now");
  await reply.press("Enter");

  const thread = comments(maya).getByRole("listitem").first();
  await expect(thread).toContainText("@Maya Ortiz fixing it now");
  await expect(thread.getByText("@Maya Ortiz", { exact: true })).toHaveClass(/font-medium/);
});

test("a changed file is added as version 2 and version 1 keeps its comments", async () => {
  // Any other step's result will do as the changed file.
  await fetch(`${TOOLKIT}/v1/video/trim`, { method: "POST" });
  await jordan.getByRole("button", { name: "New version" }).click();
  const dialog = jordan.getByRole("dialog", { name: "Add a new version" });
  // The second clip from the same run is on offer; the first is this clip already.
  await dialog.getByRole("button", { name: /why-the-station-matters\.webm/ }).click();
  await expect(dialog).toBeHidden();

  const versions = stage(jordan).getByRole("group", { name: "Version" });
  await expect(versions.getByRole("button", { name: "Version 2" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(comments(jordan).getByText("None on this clip yet")).toBeVisible();
  // The teammate is moved to the new version too.
  await expect(stage(maya).getByRole("button", { name: "Version 2" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await versions.getByRole("button", { name: "Version 1" }).click();
  await expect(comments(jordan).getByText("The logo covers the mission patch here.")).toBeVisible();
});

test("resolving a thread shows for everyone", async () => {
  await comments(jordan).getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(comments(jordan).getByText("All resolved")).toBeVisible();
  await stage(maya).getByRole("button", { name: "Version 1" }).click();
  await expect(comments(maya).getByRole("button", { name: "Resolved" })).toBeVisible();
});

test("only the author can delete a comment", async () => {
  await expect(comments(jordan).getByRole("button", { name: "Delete your comment" })).toHaveCount(
    1,
  );
  await expect(comments(maya).getByRole("button", { name: "Delete your comment" })).toHaveCount(1);
  await comments(jordan).getByRole("button", { name: "Delete your comment" }).click();
  await expect(comments(maya).getByText("fixing it now")).toBeHidden();
});

test("approving the room lets the automation finish", async () => {
  await jordan.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(jordan.getByText("Approved by Jordan Lee")).toBeVisible();
  await expect(maya.getByText("Approved by Jordan Lee")).toBeVisible();
  await expect(jordan.getByText(/An automation is paused on this review/)).toBeHidden();

  await jordan.goto("/review");
  await expect(jordan.getByRole("link", { name: /Weekly clips/ })).toContainText("Approved");
  await jordan.goto("/automations");
  await jordan
    .getByRole("link", { name: /Weekly clips/ })
    .first()
    .click();
  await expect(jordan.getByText("Done").first()).toBeVisible();
});

test("Send to review on Outputs opens a room with that step's files", async () => {
  await jordan.goto("/outputs");
  await jordan.getByRole("button", { name: "Send to review" }).first().click();
  await expect(jordan).toHaveURL(/\/review\/.+/);
  expect(jordan.url()).not.toBe(roomUrl);
  await expect(jordan.getByRole("heading", { name: "Split video" })).toBeVisible();
  await expect(
    jordan.getByRole("navigation", { name: "Clips in this review" }).getByRole("button"),
  ).toHaveCount(2);
  await expect(jordan.getByText(/An automation is paused/)).toBeHidden();
});

test("someone on another team cannot open the room", async ({ browser }) => {
  const outsider = await signUp(browser, "Someone Else", `outsider.${stamp}@example.test`);
  await outsider.getByPlaceholder("Your company or channel").fill("Other Team");
  await outsider.getByRole("button", { name: "Create team" }).click();
  await outsider.locator("#baseUrl").fill(TOOLKIT);
  await outsider.locator("#apiKey").fill("stand-in-key-1234");
  await outsider.getByRole("button", { name: "Test and connect" }).click();
  // Storage and brand can wait; the dashboard opens once the toolkit is connected.
  await expect(outsider.getByText(/Your toolkit answered/)).toBeVisible();
  await outsider.goto("/");
  await expect(outsider.getByRole("link", { name: "Review" })).toBeVisible();

  await outsider.goto(roomUrl);
  await expect(
    outsider.getByText(/This review is gone, or it belongs to another team/),
  ).toBeVisible();
  await outsider.goto("/review");
  await expect(outsider.getByText(/Nothing to review yet/)).toBeVisible();
  await outsider.context().close();
});
