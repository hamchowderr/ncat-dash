import { expect, test } from "@playwright/test";

// Clients and projects in a real browser against a real backend: a client with its own
// brand and folder, a project made from a package for it, a file put in a slot sending it
// to review, and the board moving a slot on.

const stamp = Date.now().toString(36);
const TOOLKIT = "http://127.0.0.1:8767";
const FILES = "http://127.0.0.1:8766";

const recording = process.env.RECORD_VIDEO
  ? { dir: "test-results/portal", size: { width: 1440, height: 900 } }
  : undefined;

test.use({
  video: recording ? { mode: "on", size: recording.size } : "off",
});

test("a client's project is laid out from a package and worked through", async ({
  page,
  browser,
}) => {
  await page.goto("/sign-up");
  await page.locator("#name").fill("Noa Fischer");
  await page.locator("#email").fill(`noa.${stamp}@example.test`);
  await page.locator("#password").fill("projects-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill("Fischer Studio");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.locator("#baseUrl").fill(TOOLKIT);
  await page.locator("#apiKey").fill("stand-in-key-1234");
  await page.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByText(/Your toolkit answered/)).toBeVisible();

  // A client, with its own font and delivery folder.
  await page.goto("/clients");
  await expect(page.getByText(/No clients yet/)).toBeVisible();
  await page.getByLabel("Client name", { exact: true }).fill("Acme Studio");
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page).toHaveURL(/\/clients\/[a-z0-9]+$/);
  await expect(page.getByLabel("Client name", { exact: true })).toHaveValue("Acme Studio");
  await expect(page.getByText("Clients/Acme Studio/")).toBeVisible();
  await page.getByLabel("Font", { exact: true }).fill("Acme Sans");
  await page.getByRole("button", { name: "Save client brand" }).click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await page.getByLabel("Folder", { exact: true }).fill("Deliveries/Acme");
  await page
    .getByRole("region", { name: "Delivery folder" })
    .getByRole("button", { name: "Save" })
    .click();
  await expect(page.getByText("Deliveries/Acme/")).toBeVisible();

  // A video podcast for the client, with two shorts.
  await page.getByRole("link", { name: "New project" }).click();
  await expect(page).toHaveURL(/\/projects\/new\?client=/);
  await expect(page.getByLabel("For", { exact: true })).toHaveValue(/.+/);
  await page.getByLabel("Name", { exact: true }).fill("Episode 12");
  await page.getByLabel("Shorts", { exact: true }).fill("2");
  const planned = page.getByRole("region", { name: "Slots it will have" });
  await expect(planned.getByRole("listitem")).toHaveCount(7);
  await page.getByRole("button", { name: "Make project" }).click();
  await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/);
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Episode 12");
  await expect(page.getByLabel("Client", { exact: true })).toHaveValue(/.+/);
  await expect(page.getByText("0 of 7")).toBeVisible();
  const toDo = page.getByRole("region", { name: "To do" });
  await expect(toDo.getByRole("button")).toHaveCount(7);

  // A file in the episode's slot sends it to review, in the project's own room.
  await toDo.getByRole("button", { name: /Full episode/ }).click();
  const panel = page.getByRole("region", { name: "Slot Full episode" });
  await expect(panel.getByText("No file yet")).toBeVisible();
  await panel.getByLabel("File link", { exact: true }).fill(`${FILES}/episode-12.mp4`);
  await panel.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("region", { name: "In review" })).toContainText("Full episode");
  await expect(panel.getByLabel("Status", { exact: true })).toHaveValue("review");
  await expect(panel.locator("video")).toBeVisible();
  await expect(page.getByText("1 of 7")).toBeVisible();
  await expect(panel.getByRole("link", { name: "Open in the review room" })).toBeVisible();

  // The panel sits beside the list: nothing is drawn over the slots.
  const list = await toDo.boundingBox();
  const side = await panel.boundingBox();
  expect(list && side && list.x + list.width <= side.x).toBe(true);

  // On the board, dragging the episode on to Approved moves it.
  await panel.getByRole("button", { name: "Close slot" }).click();
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "Board" }).click();
  const approved = page.getByRole("region", { name: "Approved" });
  await page
    .getByRole("region", { name: "In review" })
    .getByRole("button", { name: /Full episode/ })
    .dragTo(approved);
  await expect(approved.getByRole("button", { name: /Full episode/ })).toBeVisible();
  await approved.getByRole("button", { name: /Full episode/ }).click();
  await expect(panel.getByLabel("Status", { exact: true })).toHaveValue("approved");

  // The project shows on the client and on the Projects list.
  await page.goto("/projects");
  const row = page.getByRole("link", { name: /Episode 12/ });
  await expect(row).toContainText("Acme Studio");
  await expect(row).toContainText("1 of 7");

  // The client's portal: one link, only their projects, in the team's name.
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.getByRole("link", { name: /Acme Studio/ }).click();
  await page.getByRole("button", { name: "Make the portal link" }).click();
  const link = await page.getByLabel("Portal link", { exact: true }).inputValue();
  expect(link).toMatch(/\/portal\/[a-f0-9]{64}$/);

  const client = await browser.newContext({ recordVideo: recording });
  const portal = await client.newPage();
  await portal.goto(link);
  await expect(portal.getByRole("heading", { name: "Projects for Acme Studio" })).toBeVisible();
  await expect(portal.getByText("Fischer Studio").first()).toBeVisible();
  await portal.getByRole("link", { name: /Episode 12/ }).click();
  const piece = portal.getByRole("listitem").filter({ hasText: "Full episode" });
  await expect(piece.getByText("Approved")).toBeVisible();
  await expect(piece.locator("video")).toBeVisible();
  await portal.getByRole("button", { name: "Review and comment" }).click();
  await expect(portal).toHaveURL(/\/share\/[a-f0-9]{64}\?back=/);
  await expect(portal.getByText(/will see this name/)).toBeVisible();
  await client.close();

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const sideways = await page.evaluate(
      () => document.scrollingElement!.scrollWidth > innerWidth + 1,
    );
    expect(sideways, `the page scrolls sideways at ${width}`).toBe(false);
  }
});
