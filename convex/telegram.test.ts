import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { startRun } from "./lib/runner";
import { addPerson, addTeam, backend } from "./test.setup";

// The agent and alerts in Telegram: linking people and groups with a one-time code,
// who the agent works for, alerts with Approve and Send back, and the alert changing
// once it is decided.

type Call = { method: string; body: Record<string, unknown> };
let calls: Call[] = [];
/** The bot as Telegram describes it: privacy mode, and its place in each group. */
let bot: { privacyOff: boolean; adminIn: string[] } = { privacyOff: false, adminIn: [] };
const SECRET = "agent-secret-for-tests";

beforeEach(() => {
  vi.useFakeTimers();
  process.env.TELEGRAM_BOT_TOKEN = "123:secret";
  process.env.TELEGRAM_BOT_USERNAME = "SaltHouseBot";
  process.env.TELEGRAM_API_URL = "https://telegram.stand-in";
  process.env.MASTRA_JWT_SECRET = SECRET;
  calls = [];
  bot = { privacyOff: false, adminIn: [] };
  let next = 100;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const address = String(url);
      if (!address.startsWith("https://telegram.stand-in/bot123:secret/")) {
        throw new Error(`Unexpected fetch ${address}`);
      }
      const method = address.split("/").pop() ?? "";
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (method === "getMe") {
        return Response.json({
          ok: true,
          result: { id: 42, username: "SaltHouseBot", can_read_all_group_messages: bot.privacyOff },
        });
      }
      if (method === "getChatMember") {
        const admin = bot.adminIn.includes(String(body.chat_id));
        return Response.json({ ok: true, result: { status: admin ? "administrator" : "member" } });
      }
      calls.push({ method, body });
      return Response.json({ ok: true, result: { message_id: next++ } });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_USERNAME;
  delete process.env.TELEGRAM_API_URL;
  delete process.env.MASTRA_JWT_SECRET;
});

function agentToken() {
  const b = (value: string) => Buffer.from(value).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const body = `${b(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b(
    JSON.stringify({ sub: "agent-server", iat, exp: iat + 300 }),
  )}`;
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}

/** An owner adds the bot to a group the way Telegram does it: /start reaches the agent server. */
async function addGroupThroughBot(setup: Awaited<ReturnType<typeof team>>, chatId: string) {
  const url = await setup.olu.as.mutation(api.telegram.startLink, {
    organizationId: setup.teamId,
    kind: "group",
  });
  const code = new URL(url).searchParams.get("startgroup")!;
  const answer = await setup.t.fetch("/telegram/link", {
    method: "POST",
    headers: { authorization: `Bearer ${agentToken()}`, "content-type": "application/json" },
    body: JSON.stringify({
      code,
      chatId,
      telegramUserId: "5550009",
      isGroup: "true",
      chatTitle: "Edit team",
      telegramName: "Olu",
    }),
  });
  expect(answer.status).toBe(200);
}

async function team() {
  const t = backend();
  const teamId = await addTeam(t, "Salt House");
  const olu = await addPerson(t, "Olu Bello", [teamId], "owner");
  const ana = await addPerson(t, "Ana Reyes", [teamId]);
  return { t, teamId, olu, ana };
}

/** Makes a code in Settings as `person` and sends it to the bot as Telegram user `from`. */
async function linkAs(
  setup: Awaited<ReturnType<typeof team>>,
  person: { as: Awaited<ReturnType<typeof team>>["olu"]["as"] },
  from: string,
  kind: "person" | "group" = "person",
  chat?: { id: string; title: string },
) {
  const url = await person.as.mutation(api.telegram.startLink, {
    organizationId: setup.teamId,
    kind,
  });
  const code = new URL(url).searchParams.get(kind === "group" ? "startgroup" : "start")!;
  return await setup.t.mutation(internal.telegram.link, {
    code,
    telegramUserId: from,
    chatId: chat?.id ?? from,
    isGroup: Boolean(chat),
    ...(chat ? { chatTitle: chat.title } : {}),
    telegramName: "Someone",
  });
}

describe("linking Telegram from Settings", () => {
  test("opens the bot with a one-time code, which links the person who made it", async () => {
    const setup = await team();
    const { t, teamId, ana } = setup;
    const url = await ana.as.mutation(api.telegram.startLink, {
      organizationId: teamId,
      kind: "person",
    });
    expect(url).toMatch(/^https:\/\/t\.me\/SaltHouseBot\?start=[0-9a-f]{32}$/);
    const code = new URL(url).searchParams.get("start")!;
    const first = await t.mutation(internal.telegram.link, {
      code,
      telegramUserId: "5550001",
      chatId: "5550001",
      isGroup: false,
      telegramName: "Ana R",
      username: "ana",
    });
    expect(first).toEqual({ result: "linked", teamName: "Salt House" });
    const shown = await ana.as.query(api.telegram.forTeam, { organizationId: teamId });
    expect(shown).toMatchObject({
      ready: true,
      botUsername: "SaltHouseBot",
      canEdit: false,
      me: { telegramName: "Ana R", username: "ana" },
      linkedCount: 1,
    });
    // A code works once.
    const again = await t.mutation(internal.telegram.link, {
      code,
      telegramUserId: "5550002",
      chatId: "5550002",
      isGroup: false,
      telegramName: "Someone else",
    });
    expect(again.result).toBe("expired");
  });

  test("a code older than 15 minutes no longer works", async () => {
    const setup = await team();
    const url = await setup.ana.as.mutation(api.telegram.startLink, {
      organizationId: setup.teamId,
      kind: "person",
    });
    vi.advanceTimersByTime(16 * 60_000);
    const late = await setup.t.mutation(internal.telegram.link, {
      code: new URL(url).searchParams.get("start")!,
      telegramUserId: "5550001",
      chatId: "5550001",
      isGroup: false,
      telegramName: "Ana",
    });
    expect(late.result).toBe("expired");
  });

  test("an owner adds the bot to a group; the group code only works in a group", async () => {
    const setup = await team();
    const { olu, ana, teamId } = setup;
    await expect(
      ana.as.mutation(api.telegram.startLink, { organizationId: teamId, kind: "group" }),
    ).rejects.toThrow();
    expect((await linkAs(setup, olu, "5550009", "group")).result).toBe("use_in_group");
    const added = await linkAs(setup, olu, "5550009", "group", {
      id: "-100777",
      title: "Edit team",
    });
    expect(added.result).toBe("added");
    const shown = await olu.as.query(api.telegram.forTeam, { organizationId: teamId });
    expect(shown?.groups).toEqual([
      expect.objectContaining({ chatId: "-100777", title: "Edit team", addedBy: "Olu Bello" }),
    ]);
    // Adding the group links the owner's own Telegram too.
    expect(shown?.me).not.toBeNull();
    await olu.as.mutation(api.telegram.removeGroup, { organizationId: teamId, chatId: "-100777" });
    expect((await olu.as.query(api.telegram.forTeam, { organizationId: teamId }))?.groups).toEqual(
      [],
    );
  });

  test("a person code sent in a group links nothing", async () => {
    const setup = await team();
    const answer = await linkAs(setup, setup.ana, "5550001", "person", {
      id: "-100777",
      title: "Edit team",
    });
    expect(answer.result).toBe("use_in_private");
  });

  test("without a bot set up, Settings says so and no code is made", async () => {
    const setup = await team();
    delete process.env.TELEGRAM_BOT_TOKEN;
    const shown = await setup.ana.as.query(api.telegram.forTeam, { organizationId: setup.teamId });
    expect(shown?.ready).toBe(false);
    await expect(
      setup.ana.as.mutation(api.telegram.startLink, {
        organizationId: setup.teamId,
        kind: "person",
      }),
    ).rejects.toThrow("Telegram is not set up on this dashboard yet.");
  });
});

describe("tagging the agent in a group", () => {
  // Telegram starts every bot in privacy mode: in a group it then only gets commands and
  // replies to its own messages, never a plain message that tags it.
  test("with privacy mode on, Settings learns tagging won't reach it there", async () => {
    const setup = await team();
    await addGroupThroughBot(setup, "-100777");
    expect(
      await setup.olu.as.action(api.telegram.groupHearing, { organizationId: setup.teamId }),
    ).toEqual([{ chatId: "-100777", hears: false, privacyOff: false }]);
  });

  test("privacy mode turned off later only counts once the bot is added to the group again", async () => {
    const setup = await team();
    await addGroupThroughBot(setup, "-100777");
    bot.privacyOff = true;
    const before = await setup.ana.as.action(api.telegram.groupHearing, {
      organizationId: setup.teamId,
    });
    expect(before).toEqual([{ chatId: "-100777", hears: false, privacyOff: true }]);
    await addGroupThroughBot(setup, "-100777");
    const after = await setup.ana.as.action(api.telegram.groupHearing, {
      organizationId: setup.teamId,
    });
    expect(after).toEqual([{ chatId: "-100777", hears: true, privacyOff: true }]);
  });

  test("a bot that joins with privacy mode off, or is an admin of the group, hears it", async () => {
    const setup = await team();
    bot.privacyOff = true;
    await addGroupThroughBot(setup, "-100777");
    bot.privacyOff = false;
    bot.adminIn = ["-100888"];
    await addGroupThroughBot(setup, "-100888");
    const found = await setup.olu.as.action(api.telegram.groupHearing, {
      organizationId: setup.teamId,
    });
    expect(found).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chatId: "-100777", hears: true }),
        expect.objectContaining({ chatId: "-100888", hears: true }),
      ]),
    );
  });

  test("someone outside the team can't ask about its groups", async () => {
    const setup = await team();
    await addGroupThroughBot(setup, "-100777");
    const otherTeam = await addTeam(setup.t, "Elsewhere");
    const stranger = await addPerson(setup.t, "Sam Stone", [otherTeam]);
    await expect(
      stranger.as.action(api.telegram.groupHearing, { organizationId: setup.teamId }),
    ).rejects.toThrow();
  });
});

describe("who the agent works for in Telegram", () => {
  test("a linked person in a direct chat; a stranger and an unknown group are told no", async () => {
    const setup = await team();
    await linkAs(setup, setup.ana, "5550001");
    const ana = await setup.t.action(internal.telegram.person, {
      chatId: "5550001",
      telegramUserId: "5550001",
      isGroup: false,
    });
    expect(ana).toMatchObject({ ok: true, name: "Ana Reyes", organizationId: setup.teamId });
    expect(
      await setup.t.action(internal.telegram.person, {
        chatId: "5550002",
        telegramUserId: "5550002",
        isGroup: false,
      }),
    ).toEqual({ ok: false, reason: "not_linked" });
    expect(
      await setup.t.action(internal.telegram.person, {
        chatId: "-100999",
        telegramUserId: "5550001",
        isGroup: true,
      }),
    ).toEqual({ ok: false, reason: "not_connected" });
  });
});

describe("alerts in Telegram", () => {
  /** An automation that is one Approval step, and a run waiting on it. */
  async function waiting(setup: Awaited<ReturnType<typeof team>>) {
    return await setup.t.run(async (ctx) => {
      const automationId = await ctx.db.insert("automations", {
        organizationId: setup.teamId,
        name: "Weekly clips",
        enabled: true,
        trigger: { kind: "webhook" },
        nodes: [{ id: "approval", kind: "approval", input: {}, position: { x: 0, y: 0 } }],
        edges: [],
        hookToken: "token",
        nextRunAt: null,
        createdBy: setup.olu.id,
        updatedAt: Date.now(),
      });
      const automation = await ctx.db.get(automationId);
      const started = await startRun(
        ctx,
        automation!,
        "webhook",
        { file_url: "https://files.example/interview.mp4" },
        null,
      );
      if (!started.ok) throw new Error(started.message);
      const step = await ctx.db
        .query("runSteps")
        .withIndex("by_run", (q) => q.eq("runId", started.runId))
        .unique();
      return step!._id;
    });
  }

  test("an approval goes to each linked person with buttons, and changes once decided", async () => {
    const setup = await team();
    await linkAs(setup, setup.ana, "5550001");
    const runStepId = await waiting(setup);
    await setup.t.finishAllScheduledFunctions(vi.runAllTimers);

    const sent = calls.filter((call) => call.method === "sendMessage");
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({
      chat_id: "5550001",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Approve", callback_data: `ncat_approve:${runStepId}` },
            { text: "Send back", callback_data: `ncat_send_back:${runStepId}` },
          ],
        ],
      },
    });
    // The test dashboard's address is local, so it goes in the text, not as a button.
    expect(String(sent[0].body.text)).toMatch(
      /^Weekly clips is waiting for your approval \(Approval\)\n\n.+\n\nOpen the run: http:\/\/localhost:3000\/automations\//,
    );

    // Ana presses Approve in Telegram.
    const answer = await setup.t.mutation(internal.telegram.decide, {
      runStepId,
      telegramUserId: "5550001",
      decision: "approve",
    });
    expect(answer).toEqual({ ok: true, message: "Approved." });
    await setup.t.finishAllScheduledFunctions(vi.runAllTimers);
    const edited = calls.filter((call) => call.method === "editMessageText");
    expect(edited).toHaveLength(1);
    expect(edited[0].body).toMatchObject({ chat_id: "5550001", message_id: 100 });
    expect(String(edited[0].body.text)).toMatch(/\n\nApproved by Ana Reyes\.$/);
    expect(edited[0].body.reply_markup).toBeUndefined();
  });

  test("a press from a Telegram not linked to the team decides nothing", async () => {
    const setup = await team();
    const runStepId = await waiting(setup);
    const answer = await setup.t.mutation(internal.telegram.decide, {
      runStepId,
      telegramUserId: "5550404",
      decision: "approve",
    });
    expect(answer.ok).toBe(false);
    expect(answer.message).toMatch(/not linked to this team/);
    const unknown = await setup.t.mutation(internal.telegram.decide, {
      runStepId: "not-an-id",
      telegramUserId: "5550404",
      decision: "approve",
    });
    expect(unknown).toEqual({ ok: false, message: "This approval no longer exists." });
  });

  test("someone who switched Telegram off for a kind, or unlinked, gets none", async () => {
    const setup = await team();
    await linkAs(setup, setup.ana, "5550001");
    await linkAs(setup, setup.olu, "5550002");
    await setup.ana.as.mutation(api.notifications.set, {
      organizationId: setup.teamId,
      kind: "approval_waiting",
      channel: "telegram",
      enabled: false,
    });
    await setup.olu.as.mutation(api.telegram.unlinkMe, { organizationId: setup.teamId });
    await waiting(setup);
    await setup.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls.filter((call) => call.method === "sendMessage")).toEqual([]);
  });
});
