import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";

type Backend = ReturnType<typeof backend>;

beforeEach(() => {
  process.env.OPERATOR_EMAILS = "support.person@example.test";
});

afterEach(() => {
  delete process.env.OPERATOR_EMAILS;
});

/** The emails waiting to go out, as [to, subject]. */
async function emails(t: Backend): Promise<[string, string][]> {
  const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return scheduled
    .filter((job) => job.name.startsWith("email:send"))
    .map((job) => {
      const args = job.args[0] as { to: string; subject: string };
      return [args.to, args.subject];
    });
}

async function setUp() {
  const t = backend();
  const teamId = await addTeam(t, "Example Studio");
  const ana = await addPerson(t, "Ana Lima", [teamId]);
  const bo = await addPerson(t, "Bo", [teamId]);
  const staff = await addPerson(t, "Support Person");
  return { t, teamId, ana, bo, staff };
}

describe("support tickets in the app", () => {
  test("a customer asks for help; support gets an email and sees it with its context", async () => {
    const { t, teamId, ana, staff } = await setUp();
    const { ticketId, number } = await ana.as.mutation(api.support.open, {
      organizationId: teamId,
      subject: "Captions are out of sync",
      body: "The captions on my last clip are a second late.",
      page: "/runs",
      browser: "Firefox on Windows",
    });
    expect(number).toBe(1);

    expect(await emails(t)).toEqual([
      ["support.person@example.test", "New help request #1: Captions are out of sync"],
    ]);

    const mine = await ana.as.query(api.support.mine, {});
    expect(mine).toMatchObject([{ id: ticketId, status: "open", answered: false, unread: false }]);

    const inbox = await staff.as.query(api.support.inbox, { status: "open" });
    expect(inbox.counts).toEqual({ open: 1, unread: 1 });
    expect(inbox.tickets[0]).toMatchObject({
      requesterName: "Ana Lima",
      team: "Example Studio",
      waitingOnUs: true,
      unread: true,
    });
    const full = await staff.as.query(api.support.staffConversation, { ticketId });
    expect(full?.context).toMatchObject({
      team: "Example Studio",
      page: "/runs",
      browser: "Firefox on Windows",
    });
    expect(await staff.as.query(api.support.staffUnread, {})).toBe(1);
  });

  test("an answer is emailed to the customer; a private note is neither shown nor sent", async () => {
    const { t, teamId, ana, staff } = await setUp();
    const { ticketId } = await ana.as.mutation(api.support.open, {
      organizationId: teamId,
      subject: "Billing",
      body: "Where is my invoice?",
    });
    await staff.as.mutation(api.support.answer, {
      ticketId,
      body: "Checked Stripe: the invoice is there.",
      private: true,
    });
    await staff.as.mutation(api.support.answer, {
      ticketId,
      body: "It's in Settings, Billing.\nThe newest is at the top.",
    });

    const sent = await emails(t);
    expect(sent.at(-1)).toEqual(["ana.lima@example.test", "Re: Billing [#1]"]);
    expect(sent).toHaveLength(2);

    const seen = await ana.as.query(api.support.conversation, { ticketId });
    expect(seen?.messages.map((m) => [m.from, m.authorName, m.body])).toEqual([
      ["customer", "Ana Lima", "Where is my invoice?"],
      ["staff", "Support", "It's in Settings, Billing.\nThe newest is at the top."],
    ]);
    expect(seen?.ticket).toMatchObject({ answered: true, unread: true });
    expect(await ana.as.query(api.support.unread, {})).toBe(1);
    await ana.as.mutation(api.support.markRead, { ticketId });
    expect(await ana.as.query(api.support.unread, {})).toBe(0);

    const full = await staff.as.query(api.support.staffConversation, { ticketId });
    expect(full?.messages.filter((m) => m.private).map((m) => m.body)).toEqual([
      "Checked Stripe: the invoice is there.",
    ]);
    // Answering counts as reading it.
    expect(full?.ticket.unread).toBe(false);
  });

  test("nobody else sees or writes on someone's request, even on the same team", async () => {
    const { t, teamId, ana, bo } = await setUp();
    const { ticketId } = await ana.as.mutation(api.support.open, {
      organizationId: teamId,
      subject: "Private",
      body: "About my account",
    });
    expect(await bo.as.query(api.support.conversation, { ticketId })).toBeNull();
    expect(await bo.as.query(api.support.mine, {})).toEqual([]);
    await expect(bo.as.mutation(api.support.reply, { ticketId, body: "hi" })).rejects.toThrow(
      /gone/,
    );
    await expect(bo.as.mutation(api.support.close, { ticketId })).rejects.toThrow(/gone/);
    expect(await t.query(api.support.conversation, { ticketId })).toBeNull();
    expect(await ana.as.query(api.support.conversation, { ticketId: "not-an-id" })).toBeNull();
  });

  test("only the operator reaches the Support inbox", async () => {
    const { teamId, ana, bo } = await setUp();
    const { ticketId } = await ana.as.mutation(api.support.open, {
      organizationId: teamId,
      subject: "S",
      body: "B",
    });
    await expect(bo.as.query(api.support.inbox, { status: "open" })).rejects.toThrow(/operator/);
    await expect(bo.as.query(api.support.staffConversation, { ticketId })).rejects.toThrow(
      /operator/,
    );
    await expect(
      ana.as.mutation(api.support.answer, { ticketId, body: "I answer myself" }),
    ).rejects.toThrow(/operator/);
    await expect(
      ana.as.mutation(api.support.setStatus, { ticketId, status: "closed" }),
    ).rejects.toThrow(/operator/);
    expect(await bo.as.query(api.support.staffUnread, {})).toBe(0);
  });

  test("you can only ask from a team you are on", async () => {
    const { t, ana } = await setUp();
    const otherTeam = await addTeam(t, "Other Team");
    await expect(
      ana.as.mutation(api.support.open, { organizationId: otherTeam, subject: "S", body: "B" }),
    ).rejects.toThrow(/not on this team/);
  });

  test("closing, and writing again opens it and tells support", async () => {
    const { t, teamId, ana, staff } = await setUp();
    const { ticketId } = await ana.as.mutation(api.support.open, {
      organizationId: teamId,
      subject: "Export",
      body: "How do I export?",
    });
    await staff.as.mutation(api.support.setStatus, { ticketId, status: "closed" });
    expect((await staff.as.query(api.support.inbox, { status: "closed" })).tickets).toHaveLength(1);
    expect((await ana.as.query(api.support.mine, {}))[0]?.status).toBe("closed");

    await ana.as.mutation(api.support.reply, { ticketId, body: "One more thing" });
    expect((await ana.as.query(api.support.mine, {}))[0]?.status).toBe("open");
    expect((await emails(t)).at(-1)).toEqual([
      "support.person@example.test",
      "Ana Lima wrote again on #1: Export",
    ]);

    await ana.as.mutation(api.support.close, { ticketId });
    expect((await ana.as.query(api.support.mine, {}))[0]?.status).toBe("closed");
  });

  test("too many messages at once are refused", async () => {
    const { teamId, ana } = await setUp();
    const ask = () =>
      ana.as.mutation(api.support.open, { organizationId: teamId, subject: "S", body: "B" });
    for (let i = 0; i < 10; i += 1) await ask();
    await expect(ask()).rejects.toThrow(/a lot of messages/);
  });

  test("deleting an account deletes the requests it asked", async () => {
    const { t, teamId, ana, staff } = await setUp();
    await ana.as.mutation(api.support.open, { organizationId: teamId, subject: "S", body: "B" });
    expect(await t.mutation(internal.accountDeletion.prepare, { userId: ana.id })).toBeNull();
    expect((await staff.as.query(api.support.inbox, { status: "open" })).tickets).toEqual([]);
  });

  test("deleting a team deletes the requests asked from it", async () => {
    const { t, teamId, ana, staff } = await setUp();
    await ana.as.mutation(api.support.open, { organizationId: teamId, subject: "S", body: "B" });
    await t.mutation(internal.teamDeletion.begin, {
      organizationId: teamId,
      name: "Example Studio",
      by: ana.id,
      reason: "team",
    });
    expect((await staff.as.query(api.support.inbox, { status: "open" })).tickets).toEqual([]);
  });
});
