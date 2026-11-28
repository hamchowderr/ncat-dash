import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import { scrub } from "./factory";
import { addPerson, addTeam, backend } from "./test.setup";

// The Factory's endpoints (convex/factoryHttp.ts, docs/factory.md): it lists the support
// requests a platform admin sent it and reports each one fixed, with a token.

const TOKEN = "factory-intake-test-token";
const auth = { authorization: `Bearer ${TOKEN}` };

beforeEach(() => {
  process.env.OPERATOR_EMAILS = "support.person@example.test";
  process.env.FACTORY_INTAKE_TOKEN = TOKEN;
});

afterEach(() => {
  delete process.env.OPERATOR_EMAILS;
  delete process.env.FACTORY_INTAKE_TOKEN;
});

type Listed = {
  tickets: { id: string; title: string; [key: string]: unknown }[];
  nextCursor: string | null;
};

async function setUp() {
  const t = backend();
  const teamId = await addTeam(t, "Example Studio");
  const ana = await addPerson(t, "Ana Lima", [teamId], "admin");
  const staff = await addPerson(t, "Support Person");
  const file = async (subject: string, body = "It fails.") =>
    (
      await ana.as.mutation(api.support.open, {
        organizationId: teamId,
        category: "automations",
        subject,
        body,
        page: "/runs",
        problem: true,
      })
    ).ticketId;
  const send = (ticketId: string, summary: string) =>
    staff.as.mutation(api.support.sendToFactory, { ticketId, summary });
  const list = async (query = "", headers: Record<string, string> = auth) =>
    await t.fetch(`/factory/tickets${query}`, { headers });
  const fixed = async (id: string, body: unknown, headers: Record<string, string> = auth) =>
    await t.fetch(`/factory/tickets/${id}/fixed`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { t, teamId, ana, staff, file, send, list, fixed };
}

describe("the Factory's token", () => {
  test("a wrong or missing token gets 403 on every endpoint", async () => {
    const { file, send, list, fixed, t } = await setUp();
    const id = await file("Clips fail");
    await send(id, "Clips step fails");
    const tries: Record<string, string>[] = [
      {},
      { authorization: "Bearer not-it" },
      { authorization: TOKEN },
      { "x-takewon-token": TOKEN },
    ];
    for (const headers of tries) {
      expect((await list("", headers)).status).toBe(403);
      expect((await t.fetch(`/factory/tickets/${id}`, { headers })).status).toBe(403);
      expect((await fixed(id, { beadId: "dash-1", reason: "done" }, headers)).status).toBe(403);
    }
    // Nothing changed.
    expect(((await (await list()).json()) as Listed).tickets).toHaveLength(1);
    // A dozen calls; the first test in a file also pays for starting the backend.
  }, 30_000);

  test("with no token set on the deployment, everything is turned away", async () => {
    const { list } = await setUp();
    delete process.env.FACTORY_INTAKE_TOKEN;
    expect((await list()).status).toBe(403);
  });
});

describe("GET /factory/tickets", () => {
  test("lists only sent, open tickets, with what the Factory needs and no customer details", async () => {
    const { file, send, list, fixed } = await setUp();
    const notSent = await file("Not sent yet");
    const sent = await file(
      "Ana Lima's clips fail",
      "Hi, Ana Lima here from Example Studio (ana.lima@example.test): Weekly Clips fails.",
    );
    const done = await file("Already fixed");
    await send(sent, "Clips step fails on long videos");
    await send(done, "Uploads stall at 90%");
    expect((await fixed(done, { beadId: "dash-2", reason: "Fixed" })).status).toBe(200);

    const response = await list();
    expect(response.status).toBe(200);
    const page = (await response.json()) as Listed;
    expect(page.nextCursor).toBeNull();
    expect(page.tickets.map((each) => each.id)).toEqual([sent]);
    expect(page.tickets.map((each) => each.id)).not.toContain(notSent);
    const [ticket] = page.tickets;
    expect(ticket).toMatchObject({
      id: sent,
      title: "Clips step fails on long videos",
      category: "automations",
      page: "/runs",
      url: `http://localhost:3000/admin/support?ticket=${sent}`,
    });
    expect(ticket.id).toMatch(/^[A-Za-z0-9_.:-]+$/);
    expect(typeof ticket.team).toBe("string");
    expect(Number.isNaN(Date.parse(String(ticket.updatedAt)))).toBe(false);
    const whole = JSON.stringify(ticket);
    for (const detail of ["Ana", "Lima", "Example Studio", "ana.lima@example.test"]) {
      expect(whole).not.toContain(detail);
    }
    expect(ticket.description).toBe("Hi, [name] here from [name] ([email]): Weekly Clips fails.");
  });

  test("pages with a cursor until nextCursor is null", async () => {
    const { t, list } = await setUp();
    // More than one page: 50 a page.
    const ids: string[] = [];
    await t.run(async (ctx) => {
      const { support } = await import("./lib/support");
      for (let i = 0; i < 52; i++) {
        const { ticketId } = await support.open(ctx, {
          requester: { id: "u", name: "Someone", email: "someone@example.test" },
          subject: `Ticket ${i}`,
          body: "B",
        });
        await support.handOff(ctx, {
          ticketId,
          summary: `Summary ${i}`,
          by: { id: "s", name: "Staff" },
        });
        ids.push(ticketId);
      }
    });
    const first = (await (await list()).json()) as Listed;
    expect(first.tickets).toHaveLength(50);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await (
      await list(`?cursor=${encodeURIComponent(first.nextCursor!)}`)
    ).json()) as Listed;
    expect(second.nextCursor).toBeNull();
    expect([...first.tickets, ...second.tickets].map((each) => each.id)).toEqual(ids);
  });
});

describe("GET /factory/tickets/<id>", () => {
  test("answers a sent ticket, and 404 for one not sent, fixed or made up", async () => {
    const { t, file, send, fixed } = await setUp();
    const sent = await file("One");
    const other = await file("Two");
    await send(sent, "Clips step fails");
    const one = await t.fetch(`/factory/tickets/${sent}`, { headers: auth });
    expect(one.status).toBe(200);
    expect(await one.json()).toMatchObject({ id: sent, title: "Clips step fails" });
    expect((await t.fetch(`/factory/tickets/${other}`, { headers: auth })).status).toBe(404);
    expect((await t.fetch(`/factory/tickets/nope`, { headers: auth })).status).toBe(404);
    await fixed(sent, { beadId: "dash-1", reason: "Fixed" });
    expect((await t.fetch(`/factory/tickets/${sent}`, { headers: auth })).status).toBe(404);
  });
});

describe("POST /factory/tickets/<id>/fixed", () => {
  test("marks the ticket fixed, a repeat is harmless, and the ticket shows Fixed", async () => {
    const { ana, staff, file, send, fixed, list } = await setUp();
    const id = await file("Clips fail");
    await send(id, "Clips step fails");

    const first = await fixed(id, {
      beadId: "dash-abc",
      reason: "Clip timing fixed",
      closedAt: "2026-11-28T12:00:00.000Z",
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, repeat: false });

    const again = await fixed(id, { beadId: "dash-abc", reason: "Clip timing fixed" });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, repeat: true });

    const full = await staff.as.query(api.support.staffConversation, { ticketId: id });
    expect(full?.ticket.factory).toMatchObject({
      status: "fixed",
      beadId: "dash-abc",
      reason: "Clip timing fixed",
      fixedAt: Date.parse("2026-11-28T12:00:00.000Z"),
    });
    expect((await ana.as.query(api.support.mine, {}))[0]?.fixed).toBe(true);
    expect(((await (await list()).json()) as Listed).tickets).toEqual([]);
    // A fixed ticket can't be sent again.
    await expect(send(id, "Clips step fails again")).rejects.toThrow(/already fixed/);
  });

  test("an unknown id or one never sent gets 404; a bad body gets 400", async () => {
    const { file, fixed } = await setUp();
    const notSent = await file("Not sent");
    expect((await fixed("nope", { beadId: "dash-1", reason: "x" })).status).toBe(404);
    expect((await fixed(notSent, { beadId: "dash-1", reason: "x" })).status).toBe(404);
    expect((await fixed(notSent, { reason: "x" })).status).toBe(400);
    expect((await fixed(notSent, { beadId: "dash-1", reason: "x", closedAt: "soon" })).status).toBe(
      400,
    );
  });
});

test("scrub takes names, team and email addresses out", () => {
  expect(
    scrub("Ana Lima (ana@x.test) at Example Studio", {
      requesterName: "Ana Lima",
      context: { team: "Example Studio" },
    }),
  ).toBe("[name] ([email]) at [name]");
});
