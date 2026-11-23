import { type Browser, expect, type Page, test } from "./test";

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
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
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
let shareUrl: string;
let client: Page;

test.beforeAll(async ({ browser }) => {
  jordan = await signUp(browser, "Jordan Lee", jordanEmail);
  await jordan.getByPlaceholder("Your company or channel").fill("Salt House");
  await jordan.getByRole("button", { name: "Create team" }).click();
  await expect(jordan.getByRole("heading", { name: "Add your brand" })).toBeVisible({ timeout: 30_000 });
  await jordan.goto("/settings/toolkit");
  await jordan.locator("#baseUrl").fill(TOOLKIT);
  await jordan.locator("#apiKey").fill("stand-in-key-1234");
  await jordan.getByRole("button", { name: "Test and connect" }).click();
  // Files go to the toolkit's storage; the brand can wait. The dashboard opens now.
  await expect(jordan.getByText("Your own toolkit", { exact: true })).toBeVisible();
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
  await client?.context().close();
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

test("a link to a comment opens the room at it, as a notification will", async () => {
  const clipId = await jordan
    .getByRole("navigation", { name: "Clips in this review" })
    .getByRole("button", { name: /Opening hello/ })
    .getAttribute("data-clip-id");
  const thread = comments(jordan).getByRole("listitem").first();
  const commentId = (await thread.getAttribute("id"))?.replace("thread-", "");
  expect(clipId && commentId).toBeTruthy();

  const page = await jordan.context().newPage();
  try {
    await page.goto(`${roomUrl}?clip=${clipId}&comment=${commentId}`);
    // Version 2 is the newest, but the comment is on version 1.
    await expect(stage(page).getByRole("button", { name: "Version 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(stage(page).getByText("0:02 / 0:06")).toBeVisible();
    await expect(page.locator(`#thread-${commentId}`)).toHaveClass(/bg-muted\/60/);
  } finally {
    await page.close();
  }
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

test("tagging @Agent gets the agent's answer in the thread, for everyone", async () => {
  // Another clip, so the threads above stay as they were.
  await maya
    .getByRole("navigation", { name: "Clips in this review" })
    .getByRole("button", { name: /Why the station matters/ })
    .click();
  await seek(maya, 2);
  await commentBox(maya).pressSequentially("@ag");
  await maya.getByRole("option", { name: /Agent/ }).click();
  await commentBox(maya).pressSequentially("does this part move too fast?");
  await commentBox(maya).press("Enter");

  // The real agent server answers after Convex took a still of 0:02 from the toolkit. The
  // model's answer is one Sonnet 5.5 really gave to this question with this still, played
  // back (packages/agent/fixtures/recorded): it saw there is no logo in the frame.
  const thread = comments(maya).getByRole("listitem").first();
  await expect(thread.getByText("@Agent", { exact: true })).toHaveClass(/font-medium/);
  await expect(thread).toContainText(/one continuous shot with no cuts/, {
    timeout: 60_000,
  });
  await expect(thread).toContainText("for Maya");

  await jordan
    .getByRole("navigation", { name: "Clips in this review" })
    .getByRole("button", { name: /Why the station matters/ })
    .click();
  const seen = comments(jordan).getByRole("listitem").first();
  await expect(seen).toContainText(/one continuous shot with no cuts/);
  // Only Maya, who asked, can delete the answer.
  await expect(seen.getByRole("button", { name: "Delete this answer" })).toHaveCount(0);
  await expect(thread.getByRole("button", { name: "Delete this answer" })).toHaveCount(1);
});

test("a drawing on the paused frame goes with the comment and shows for the team", async () => {
  await seek(maya, 4);
  await comments(maya).getByRole("button", { name: "Draw on the frame" }).click();
  const tools = maya.getByRole("toolbar", { name: "Drawing tools" });
  await expect(tools).toBeVisible();
  // The tools take the timeline's place while drawing.
  await expect(stage(maya).getByRole("slider")).toHaveCount(0);
  await tools.getByRole("button", { name: "Box" }).click();
  await tools.getByRole("button", { name: "Yellow" }).click();

  const area = maya.getByRole("img", { name: /Drawing area/ });
  const box = (await area.boundingBox())!;
  // The drawing area sits exactly over the picture, not the black space around it.
  const picture = (await stage(maya).locator("video").boundingBox())!;
  expect(Math.abs(box.width - picture.width)).toBeLessThan(2);
  expect(Math.abs(box.x - picture.x)).toBeLessThan(2);
  await maya.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await maya.mouse.down();
  await maya.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4, { steps: 8 });
  await maya.mouse.up();
  await expect(area.locator('[data-shape="box"]')).toHaveCount(1);
  await tools.getByRole("button", { name: "Done" }).click();
  await expect(comments(maya).getByRole("button", { name: "Draw on the frame" })).toContainText(
    "1 mark",
  );
  await commentBox(maya).fill("Keep this corner clear for the lower third.");
  await commentBox(maya).press("Enter");

  const thread = comments(jordan).getByRole("listitem").filter({ hasText: "lower third" });
  await expect(thread.getByText("Drawing", { exact: true })).toBeVisible();
  await thread.getByText("Keep this corner clear for the lower third.").click();
  await expect(stage(jordan).getByText("0:04 / 0:06")).toBeVisible();
  const shown = stage(jordan).locator('[data-drawing="showing"] [data-shape="box"]');
  await expect(shown).toHaveAttribute("data-color", "yellow");
  // Playing on puts the clip back without the drawing on it.
  await stage(jordan).getByRole("button", { name: "Play" }).click();
  await expect(shown).toHaveCount(0);
  await stage(jordan).getByRole("button", { name: "Pause" }).click();
});

test("a teammate shares the room, and a client opens it with no account", async ({ browser }) => {
  await jordan.getByRole("button", { name: "Share" }).click();
  const dialog = jordan.getByRole("dialog", { name: "Share with a client" });
  await expect(dialog.getByRole("switch", { name: "Let them approve" })).toBeChecked();
  await expect(dialog.getByRole("switch", { name: "Show the team's comments" })).not.toBeChecked();
  await dialog.getByRole("button", { name: "Create link" }).click();
  const link = dialog.getByRole("textbox", { name: "Share link" });
  await expect(link).toHaveValue(/\/share\/[a-f0-9]{64}$/);
  shareUrl = await link.inputValue();
  await expect(dialog.getByText(/The link works until/)).toBeVisible();
  await jordan.keyboard.press("Escape");

  // A fresh browser: nobody is signed in.
  client = await (await browser.newContext()).newPage();
  await client.goto(shareUrl);
  await expect(client.getByRole("heading", { name: "Before you start" })).toBeVisible();
  await expect(
    client.getByText("Salt House will see this name beside your comments."),
  ).toBeVisible();
  await client.getByLabel("Your name").fill("Riley Client");
  await client.getByRole("button", { name: "Continue" }).click();
  await expect(client.getByText("Salt House", { exact: true })).toBeVisible();
  await expect(client.getByText("Reviewing as Riley Client")).toBeVisible();
  await expect(
    client.getByRole("navigation", { name: "Clips in this review" }).getByRole("button"),
  ).toHaveCount(2);
  // The team's own threads stay with the team.
  await expect(comments(client).getByText(/Pause where something needs a change/)).toBeVisible();
  await expect(comments(client).getByText("The logo covers the mission patch here.")).toHaveCount(
    0,
  );
});

test("the team and the client see each other in the room", async () => {
  const teamHere = jordan.getByRole("list", { name: "Here now" });
  await expect(teamHere).toContainText("Riley Client");
  const clientHere = client.getByRole("list", { name: "Here now" });
  await expect(clientHere).toContainText("Jordan Lee");
  await expect(clientHere).toContainText("Maya Ortiz");
  await expect(clientHere).toContainText("Riley Client");
});

test("the client's comment reaches the team marked as theirs, with an alert", async () => {
  // The team looks at the same clip and version the client opened on.
  await jordan
    .getByRole("navigation", { name: "Clips in this review" })
    .getByRole("button", { name: /Opening hello/ })
    .click();
  await stage(jordan).getByRole("button", { name: "Version 2" }).click();

  await seek(client, 1);
  await commentBox(client).pressSequentially("Can the end card stay up");
  // The team sees the client typing a new comment, under the comment box.
  await expect(comments(jordan).getByRole("status")).toHaveText("Riley is typing…");
  await commentBox(client).pressSequentially(" a little longer?");
  await commentBox(client).press("Enter");
  await expect(comments(client).getByRole("listitem").first()).toContainText("Riley Client");
  await expect(comments(jordan).getByRole("status")).toHaveCount(0);

  const thread = comments(jordan).getByRole("listitem").first();
  await expect(thread).toContainText("Can the end card stay up a little longer?");
  await expect(thread.getByText("Client", { exact: true })).toBeVisible();

  await jordan.locator("[data-alerts-bell]").click();
  const alert = jordan.locator('[data-alert-kind="client_feedback"]').first();
  await expect(alert).toContainText("Riley Client left feedback on Weekly clips");
  await jordan.goBack();

  // A new team comment being written stays hidden from the client: it would be internal.
  await commentBox(jordan).pressSequentially("Internal: check the music licence");
  await client.waitForTimeout(1000);
  await expect(comments(client).getByRole("status")).toHaveCount(0);
  await commentBox(jordan).fill("");

  // A reply in the client's thread is theirs to see, typing included.
  await thread.getByRole("button", { name: "Reply" }).click();
  await jordan.getByRole("textbox", { name: "Reply" }).pressSequentially("Sure, two more");
  await expect(comments(client).getByRole("status")).toHaveText("Jordan is typing…");
  await jordan.getByRole("textbox", { name: "Reply" }).pressSequentially(" seconds.");
  await jordan.getByRole("textbox", { name: "Reply" }).press("Enter");
  await expect(comments(client).getByText("Sure, two more seconds.")).toBeVisible();
  await expect(comments(client).getByRole("status")).toHaveCount(0);
});

test("the client approves, and the team sees it before making the call", async () => {
  await client.getByRole("button", { name: "Approve" }).click();
  await expect(client.getByText("Riley Client approved")).toBeVisible();
  await expect(jordan.locator("[data-client-verdict]")).toHaveText("Riley Client approved");
  await expect(jordan.locator("[data-client-verdict]")).toHaveAttribute(
    "data-client-verdict",
    "approved",
  );
  // Only a teammate decides: the automation is still waiting.
  await expect(jordan.getByText(/An automation is paused on this review/)).toBeVisible();
});

test("approving the room lets the automation finish", async () => {
  await jordan.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(jordan.getByText("Approved by Jordan Lee")).toBeVisible();
  await expect(maya.getByText("Approved by Jordan Lee")).toBeVisible();
  // An approved review closes the link the team shared by hand.
  await expect(client.getByRole("heading", { name: "This review is approved" })).toBeVisible();
  await expect(client.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(jordan.getByText(/An automation is paused on this review/)).toBeHidden();

  await jordan.goto("/review");
  await expect(jordan.getByRole("link", { name: /Weekly clips/ })).toContainText("Approved");
  await jordan.goto("/automations");
  await jordan
    .getByRole("link", { name: /Weekly clips/ })
    .first()
    .click();
  // Pages left behind stay in the document, hidden, so only what is on screen counts.
  await expect(jordan.getByText("Done").filter({ visible: true }).first()).toBeVisible();
});

test("Outputs shows the run's files and sends them to review", async () => {
  await jordan.goto("/outputs");
  const run = jordan.getByRole("region", { name: /^Weekly clips, / });
  await expect(run).toContainText("From station-interview.webm · Webhook");
  await expect(run.getByRole("heading", { name: "Split video · 2 files" })).toBeVisible();
  await expect(run.getByRole("link", { name: "See the run" })).toHaveAttribute(
    "href",
    /\/automations\/.+\/runs\/.+/,
  );
  await run.getByRole("button", { name: "Send to review" }).click();
  await expect(jordan).toHaveURL(/\/review\/.+/);
  expect(jordan.url()).not.toBe(roomUrl);
  await expect(
    jordan.getByRole("heading", { name: "Weekly clips: station-interview.webm" }),
  ).toBeVisible();
  await expect(
    jordan.getByRole("navigation", { name: "Clips in this review" }).getByRole("button"),
  ).toHaveCount(2);
  await expect(jordan.getByText(/An automation is paused/)).toBeHidden();
});

test("someone on another team cannot open the room", async ({ browser }) => {
  const outsider = await signUp(browser, "Someone Else", `outsider.${stamp}@example.test`);
  await outsider.getByPlaceholder("Your company or channel").fill("Other Team");
  await outsider.getByRole("button", { name: "Create team" }).click();
  await expect(outsider.getByRole("heading", { name: "Add your brand" })).toBeVisible({ timeout: 30_000 });
  await outsider.goto("/settings/toolkit");
  await outsider.locator("#baseUrl").fill(TOOLKIT);
  await outsider.locator("#apiKey").fill("stand-in-key-1234");
  await outsider.getByRole("button", { name: "Test and connect" }).click();
  // Files go to the toolkit's storage; the brand can wait. The dashboard opens now.
  await expect(outsider.getByText("Your own toolkit", { exact: true })).toBeVisible();
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

test("the room gives a tall clip only the width it needs and the comments the rest", async () => {
  await jordan.setViewportSize({ width: 1440, height: 900 });
  await jordan.goto(roomUrl);
  const clip = stage(jordan);
  await expect(clip).toHaveAttribute("data-shape", /^0\./);
  const picture = await clip.locator("video").boundingBox();
  const box = await clip.boundingBox();
  const panel = await comments(jordan).boundingBox();
  // The clip fills the stage's height, and the stage is only its padding wider than it.
  expect(picture!.height).toBeGreaterThan(box!.height * 0.75);
  expect(box!.width - picture!.width).toBeLessThan(48);
  // The comments get the rest of the row, so they are wider than the tall clip.
  expect(panel!.width).toBeGreaterThan(box!.width);
  expect(panel!.x).toBeGreaterThan(box!.x + box!.width);
  // The room fits the window exactly: the page itself does not scroll.
  expect(
    await jordan
      .locator("[data-page-frame]")
      .evaluate((frame) => frame.scrollHeight - frame.clientHeight),
  ).toBeLessThanOrEqual(1);
  // Nothing spills past the page.
  expect(await jordan.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    1440,
  );
});

test("the Review list uses the whole width, with what waits for a decision first", async () => {
  await jordan.goto("/review");
  const waiting = jordan.getByRole("region", { name: "Waiting for a decision" });
  const decided = jordan.getByRole("region", { name: "Decided" });
  await expect(waiting.getByRole("link")).toContainText("station-interview");
  await expect(decided.getByRole("link")).toContainText("Approved");
  // Each review is a row across the page, with a picture of each of its clips.
  await jordan.setViewportSize({ width: 1600, height: 900 });
  const row = await decided.getByRole("link").boundingBox();
  const heading = await jordan.getByRole("heading", { name: "Review", level: 1 }).boundingBox();
  const main = await jordan.locator("[data-page-frame]").boundingBox();
  expect(row!.x).toBeCloseTo(heading!.x, 0);
  expect(row!.width).toBeGreaterThan(main!.width * 0.9);
  await expect(decided.locator("[data-strip] video")).toHaveCount(2);
});
