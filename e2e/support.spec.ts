import { execSync } from "node:child_process";

import { type Browser, expect, type Page, test } from "./test";

// Support tickets, in a real browser against a real backend: a customer asks from Get
// Help, the operator answers from Support under Admin (with a private note the customer
// never sees), and the answer shows up beside Get Help in the customer's menu.

const PASSWORD = "support-e2e-1";
const stamp = Date.now().toString(36);
const emailOf = (name: string) => `${name}.${stamp}@example.test`;
const OPERATOR = emailOf("operator");
// RECORD_VIDEO=dir keeps a recording of each window; SHOTS=dir saves screenshots.
const RECORD = process.env.RECORD_VIDEO;
const SHOTS = process.env.SHOTS;
const pause = (page: Page) => page.waitForTimeout(RECORD ? 1200 : 0);
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

async function signUp(browser: Browser, name: string, email: string, team: string) {
  const context = await browser.newContext({
    deviceScaleFactor: SHOTS ? 2 : 1,
    ...(RECORD ? { recordVideo: { dir: RECORD, size: { width: 1440, height: 900 } } } : {}),
  });
  const page = await context.newPage();
  await page.goto("/sign-up");
  await page.locator("#name").fill(name);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByPlaceholder("Your company or channel").fill(team);
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Add your brand" })).toBeVisible({
    timeout: 30_000,
  });
  return page;
}

const thread = (page: Page) => page.getByRole("list", { name: "Messages" });

const run = (fn: string, args: object, component?: string) =>
  execSync(
    `npx convex run ${component ? `--component ${component} ` : ""}${fn} '${JSON.stringify(args)}'`,
    { stdio: "pipe", encoding: "utf8" },
  );

test.describe.configure({ mode: "serial" });

let ana: Page;
let operator: Page;

test.beforeAll(async ({ browser }) => {
  ana = await signUp(browser, "Ana Reyes", emailOf("ana"), "Example Studio");
  operator = await signUp(browser, "Chris Park", OPERATOR, "Support Desk");
  // Whoever runs this copy, with a confirmed address.
  execSync(`npx convex env set OPERATOR_EMAILS ${OPERATOR}`, { stdio: "ignore" });
  run(
    "adapter:updateMany",
    {
      input: {
        model: "user",
        where: [{ field: "email", value: OPERATOR }],
        update: { emailVerified: true },
      },
      paginationOpts: { numItems: 10, cursor: null },
    },
    "betterAuth",
  );
});

test.afterAll(async () => {
  execSync("npx convex env remove OPERATOR_EMAILS", { stdio: "ignore" });
  for (const page of [ana, operator]) await page?.context().close();
});

test("a customer asks from Get Help, which keeps the page they came from", async () => {
  await ana.goto("/runs");
  // Only the operator has the Admin pages.
  await expect(ana.getByRole("link", { name: /^Support/ })).toHaveCount(0);
  await ana.getByRole("link", { name: "Get Help" }).click();
  await expect(ana).toHaveURL(/\/help\?from=%2Fruns/);
  await expect(ana.getByRole("heading", { name: "Get Help" })).toBeVisible();
  await expect(ana.getByRole("heading", { name: "Ask a new question" })).toBeVisible();
  await pause(ana);
  await ana.getByLabel("What is it about?").fill("Captions are a second late");
  await ana
    .getByLabel("Tell us more")
    .fill(
      "On my last clip the captions show up about a second after the words.\nIt started today.",
    );
  await shot(ana, "Get Help New Question");
  await ana.getByRole("button", { name: "Send" }).click();
  await expect(ana).toHaveURL(/ticket=/);
  await expect(ana.getByText("Waiting for an answer")).toBeVisible();
  await expect(thread(ana).getByText("It started today.", { exact: false })).toBeVisible();
  await pause(ana);
  // Away from the question: had it stayed open, the answer would count as read at once.
  await ana.goto("/");
});

test("the operator sees it under Admin with who asked and from where, and answers", async () => {
  await operator.goto("/");
  const support = operator.getByRole("link", { name: /^Support/ });
  await expect(support).toBeVisible();
  // A count of what support hasn't read (other runs on this backend may have left some).
  await expect(support).toContainText(/\d+ unread/);
  await support.click();
  await expect(operator.getByRole("heading", { name: "Support", exact: true })).toBeVisible();
  await expect(operator.getByText("Needs an answer").first()).toBeVisible();
  // The newest is at the top.
  await operator
    .getByRole("button", { name: /Ana Reyes/ })
    .first()
    .click();
  await expect(operator.getByText("Example Studio").last()).toBeVisible();
  await expect(operator.getByText("Came from")).toBeVisible();
  await expect(operator.getByRole("definition").filter({ hasText: "/runs" })).toBeVisible();
  await pause(operator);

  await operator.getByRole("radio", { name: "Private note" }).click();
  await operator
    .getByLabel("Private note")
    .fill("Their captions step ran on the old timing. Fixed.");
  await operator.getByRole("button", { name: "Add note" }).click();
  await expect(operator.getByText("Private note by Chris Park")).toBeVisible();

  await operator.getByRole("radio", { name: "Answer" }).click();
  await operator
    .getByLabel("Your answer")
    .fill("Thanks Ana. That's fixed now: run the clip again and the captions line up.");
  await shot(operator, "Support Inbox Answering");
  await operator.getByRole("button", { name: "Send answer" }).click();
  await expect(thread(operator).getByText("run the clip again", { exact: false })).toBeVisible();
  await expect(operator.getByText("Answered").first()).toBeVisible();
  await shot(operator, "Support Inbox Answered");
  await pause(operator);
});

test("the answer shows beside Get Help; the private note never reaches the customer", async () => {
  await ana.goto("/");
  const help = ana.getByRole("link", { name: /Get Help/ });
  await expect(help).toContainText("1");
  await shot(ana, "Get Help New Answer In Menu");
  await help.click();
  await expect(ana.getByText("New answer")).toBeVisible();
  await ana.getByRole("button", { name: /Captions are a second late/ }).click();
  await expect(thread(ana).getByText("run the clip again", { exact: false })).toBeVisible();
  await expect(ana.getByText(/old timing/)).toHaveCount(0);
  await shot(ana, "Get Help Answer");
  // Opening it counts it read.
  await expect(ana.getByRole("link", { name: /Get Help/ })).not.toContainText("1");
  await pause(ana);

  await ana.getByRole("button", { name: "This is solved" }).click();
  await expect(ana.getByText("Solved").first()).toBeVisible();
  await pause(ana);

  await operator.goto("/admin/support?status=closed");
  await expect(operator.getByRole("button", { name: /Ana Reyes/ }).first()).toBeVisible();
});
