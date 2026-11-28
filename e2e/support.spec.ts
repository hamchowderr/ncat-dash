import { execSync } from "node:child_process";

import { type Browser, expect, type Page, test } from "./test";

// Support tickets, in a real browser against a real backend: a customer asks from Get
// Help, the operator answers from Support under Admin (with a private note the customer
// never sees), and the answer shows up beside Get Help in the customer's menu.

const PASSWORD = "support-e2e-1";
const stamp = Date.now().toString(36);
const emailOf = (name: string) => `${name}.${stamp}@example.test`;
const OPERATOR = emailOf("operator");
// The token a coding Factory sends to read requests a platform admin sent it (docs/factory.md).
const FACTORY_TOKEN = `factory-e2e-${stamp}`;
const CONVEX_SITE = "http://127.0.0.1:3211";
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
  execSync(`npx convex env set FACTORY_INTAKE_TOKEN ${FACTORY_TOKEN}`, { stdio: "ignore" });
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
  execSync("npx convex env remove FACTORY_INTAKE_TOKEN", { stdio: "ignore" });
  for (const page of [ana, operator]) await page?.context().close();
});

test("a customer asks from Get Help, which keeps the page they came from", async () => {
  await ana.goto("/runs");
  // Only the operator has the Admin pages.
  await expect(ana.getByRole("link", { name: /^Support/ })).toHaveCount(0);
  await ana.getByRole("link", { name: "Get Help" }).click();
  await expect(ana).toHaveURL(/\/help\?from=%2Fruns/);
  await expect(ana.getByRole("heading", { name: "Get Help" })).toBeVisible();
  // They came from Runs, so the form starts on that category; they pick a closer one.
  await expect(ana.getByRole("radio", { name: /Automations and runs/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await pause(ana);
  await ana.getByRole("radio", { name: /Clips, captions and edits/ }).click();
  await ana.getByLabel("Subject").fill("Captions are a second late");
  await ana
    .getByLabel("Details")
    .fill(
      "On my last clip the captions show up about a second after the words.\nIt started today.",
    );
  await shot(ana, "Get Help New Question");
  await ana.getByRole("button", { name: "Send" }).click();
  await expect(ana).toHaveURL(/ticket=/);
  await expect(ana.getByText("Waiting for an answer")).toBeVisible();
  await expect(ana.getByText("Clips, captions and edits").first()).toBeVisible();
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
  // Only that category's questions.
  await operator.getByRole("combobox", { name: "Category" }).click();
  await operator.getByRole("option", { name: /Clips, captions and edits/ }).click();
  await expect(operator).toHaveURL(/category=results/);
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

test("the platform admin sends it to the Factory, which reads it and reports it fixed", async () => {
  await operator.goto("/admin/support?status=closed");
  await expect(operator.getByText("Platform Admin").first()).toBeVisible();
  await operator
    .getByRole("button", { name: /Ana Reyes/ })
    .first()
    .click();
  const summary = operator.getByLabel("Summary for the Factory");
  await expect(summary).toHaveValue("Captions are a second late");
  // The repository is public: the customer's name can't go in the summary.
  await summary.fill("Ana Reyes sees late captions");
  await operator.getByRole("button", { name: "Send to Factory" }).click();
  await expect(operator.getByRole("alert")).toContainText(/name/);
  await summary.fill(`Captions show a second late, run ${stamp}`);
  await operator.getByRole("button", { name: "Send to Factory" }).click();
  await expect(operator.getByText(/Sent to Factory .* by Chris Park/)).toBeVisible();
  await shot(operator, "Support Sent To Factory");

  const bearer = { authorization: `Bearer ${FACTORY_TOKEN}` };
  expect((await fetch(`${CONVEX_SITE}/factory/tickets`)).status).toBe(403);
  const listed = (await (
    await fetch(`${CONVEX_SITE}/factory/tickets`, { headers: bearer })
  ).json()) as {
    tickets: { id: string; title: string; description?: string }[];
  };
  const ticket = listed.tickets.find(
    (each) => each.title === `Captions show a second late, run ${stamp}`,
  );
  expect(ticket).toBeTruthy();
  expect(JSON.stringify(ticket)).not.toContain("Ana");
  const fixed = await fetch(`${CONVEX_SITE}/factory/tickets/${ticket!.id}/fixed`, {
    method: "POST",
    headers: { ...bearer, "content-type": "application/json" },
    body: JSON.stringify({ beadId: "dash-e2e", reason: "Caption timing fixed" }),
  });
  expect(fixed.status).toBe(200);

  await expect(operator.getByText("Caption timing fixed")).toBeVisible();
  await expect(operator.getByText(/dash-e2e/)).toBeVisible();
  await ana.goto("/help");
  await expect(ana.getByText("Fixed").first()).toBeVisible();
  await shot(ana, "Get Help Fixed");
});

const sse = (events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
const ASK = "The Clips step failed twice on my podcast. Can a person look at it?";

/** The agent server, stood in for: it answers with a help request that waits for a yes. */
async function agentAsksForHelp(page: Page) {
  await page.route("**/api/agent-controller/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/agent-controller", "");
    if (path === "/stream") {
      return route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sse([
          { type: "__thread__", threadId: "t-help" },
          {
            type: "message_start",
            message: { id: "u-1", role: "user", content: [{ type: "text", text: ASK }] },
          },
          {
            type: "message_start",
            message: {
              id: "a-1",
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: "I couldn't fix that from here: the toolkit stops the Clips step before it starts. I can ask Takewon support for you.",
                },
              ],
            },
          },
          {
            type: "tool_approval_required",
            toolCallId: "call-help",
            toolName: "ask_for_help",
            category: null,
            args: {
              subject: "The Clips step fails on my podcast",
              message:
                "My Podcast Clips automation failed twice today on episode 12, both times at the Clips step.\nThe assistant tried it again and it failed the same way.",
              category: "automations",
            },
          },
        ]),
      });
    }
    if (path === "/approve") return route.fulfill({ json: { ok: true } });
    if (path === "/threads") return route.fulfill({ json: { threads: [] } });
    if (path.endsWith("/pending")) return route.fulfill({ json: { running: false, events: [] } });
    return route.fulfill({ json: {} });
  });
}

test("the assistant shows a help request in full and sends it only on a yes", async () => {
  await agentAsksForHelp(ana);
  await ana.goto("/automations");
  const agent = ana.getByRole("complementary", { name: "Agent" });
  if (!(await agent.isVisible())) {
    await ana.locator("header").getByRole("button", { name: "Open the agent" }).click();
  }
  await agent.getByPlaceholder("Describe an automation, or a change to this one").fill(ASK);
  await agent.getByPlaceholder("Describe an automation, or a change to this one").press("Enter");
  await expect(agent.getByText("Send this to support?")).toBeVisible({ timeout: 15_000 });
  const card = agent.locator("[data-help-request]");
  await expect(card.getByText("The Clips step fails on my podcast")).toBeVisible();
  await expect(card.getByText("Automations and runs")).toBeVisible();
  await expect(card.getByText(/failed the same way/)).toBeVisible();
  await shot(ana, "Assistant Asks Before Sending A Help Request");
  await pause(ana);
  await agent.getByRole("button", { name: "Approve" }).click();
  await expect(agent.getByText("Send this to support?")).toHaveCount(0);
  await ana.unroute("**/api/agent-controller/**");
});

test("an AI app's request reaches the inbox, filed and marked as opened by an AI app", async () => {
  const anaId = JSON.parse(
    run(
      "adapter:findOne",
      { model: "user", where: [{ field: "email", value: emailOf("ana") }] },
      "betterAuth",
    ),
  )._id as string;
  const teams = JSON.parse(run("members:teamsFor", { userId: anaId }, "betterAuth")) as {
    id: string;
  }[];
  run("support:openAs", {
    organizationId: teams[0].id,
    userId: anaId,
    category: "connections",
    subject: "Slack stopped posting new clips",
    body: "Nothing has come through to #clips since this morning.",
  });
  await operator.goto("/admin/support");
  await operator
    .getByRole("button", { name: /Slack stopped posting/ })
    .first()
    .click();
  await expect(operator.getByText("Opened by an AI app")).toBeVisible();
  await expect(operator.getByRole("combobox", { name: "Category" }).last()).toContainText(
    "Connected apps",
  );
  await shot(operator, "Support Inbox Request From An AI App");
  await pause(operator);
});
