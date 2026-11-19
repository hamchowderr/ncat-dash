import { type Browser, expect, type Page, test } from "./test";

// The team's agent settings in a real browser against a real backend: the owner picks a
// model, writes house rules and ticks default platforms; they are kept across a reload,
// and a member of the team sees them without being able to change them.

const TOOLKIT = "http://127.0.0.1:8767";
const PASSWORD = "agent-settings-e2e-1";
const stamp = Date.now().toString(36);
const emailOf = (name: string) => `${name}.${stamp}@example.test`;

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

const card = (page: Page) => page.locator("#agent");

test.describe.configure({ mode: "serial" });

let jordan: Page;
let maya: Page;

test.beforeAll(async ({ browser }) => {
  jordan = await signUp(browser, "Jordan Lee", emailOf("jordan"));
  await jordan.getByPlaceholder("Your company or channel").fill("Salt House");
  await jordan.getByRole("button", { name: "Create team" }).click();
  await jordan.getByRole("button", { name: /Yes, I Have One/ }).click();
  await jordan.locator("#baseUrl").fill(TOOLKIT);
  await jordan.locator("#apiKey").fill("stand-in-key-1234");
  await jordan.getByRole("button", { name: "Test and connect" }).click();
  await expect(jordan.getByText(/Your toolkit answered/)).toBeVisible();

  const [team] = await auth<{ id: string }[]>(jordan, "organization/list");
  maya = await signUp(browser, "Maya Ortiz", emailOf("maya"));
  const invitation = await auth<{ id: string }>(jordan, "organization/invite-member", {
    email: emailOf("maya"),
    role: "member",
    organizationId: team.id,
  });
  await auth(maya, "organization/accept-invitation", { invitationId: invitation.id });
  await auth(maya, "organization/set-active", { organizationId: team.id });
});

test.afterAll(async () => {
  for (const page of [jordan, maya]) await page?.context().close();
});

test("the owner sets the model, house rules and default platforms, and they are kept", async () => {
  await jordan.goto("/settings/agent");
  await expect(jordan.getByRole("heading", { level: 1, name: "Agent" })).toBeVisible();
  const save = card(jordan).getByRole("button", { name: "Save" });
  await expect(save).toBeDisabled();

  await card(jordan).getByRole("combobox", { name: "Model" }).click();
  await jordan.getByRole("option", { name: "Claude Opus 5.5" }).click();
  await expect(card(jordan).getByText(/most careful with long automations/)).toBeVisible();
  await card(jordan)
    .getByRole("textbox", { name: "House rules" })
    .fill("Captions never in all capitals.\nClips no longer than 45 seconds.");
  await card(jordan).getByRole("checkbox", { name: "YouTube Shorts" }).click();
  await card(jordan).getByRole("checkbox", { name: "TikTok" }).click();
  await save.click();
  await expect(jordan.getByText("Agent settings saved.")).toBeVisible();
  await expect(save).toBeDisabled();

  await jordan.reload();
  await expect(card(jordan).getByRole("combobox", { name: "Model" })).toHaveText("Claude Opus 5.5");
  await expect(card(jordan).getByRole("textbox", { name: "House rules" })).toHaveValue(
    "Captions never in all capitals.\nClips no longer than 45 seconds.",
  );
  for (const name of ["TikTok", "YouTube Shorts"]) {
    await expect(card(jordan).getByRole("checkbox", { name })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  }
  await expect(card(jordan).getByRole("checkbox", { name: "LinkedIn" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
});

test("a member sees the team's settings but cannot change them", async () => {
  await maya.goto("/settings/agent");
  await expect(card(maya).getByRole("textbox", { name: "House rules" })).toHaveValue(
    /Clips no longer than 45 seconds\./,
  );
  await expect(card(maya).getByRole("textbox", { name: "House rules" })).toBeDisabled();
  await expect(card(maya).getByRole("checkbox", { name: "TikTok" })).toBeDisabled();
  await expect(card(maya).getByRole("button", { name: "Save" })).toHaveCount(0);
  await expect(card(maya).getByText("Only a team owner or admin can change this.")).toBeVisible();
});
