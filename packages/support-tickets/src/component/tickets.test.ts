/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const ana = { requesterId: "user_ana", requesterName: "Ana", requesterEmail: "ana@example.test" };

function backend() {
  return convexTest(schema, modules);
}

describe("support tickets", () => {
  test("opening numbers tickets from 1 and keeps the first message", async () => {
    const t = backend();
    const first = await t.mutation(api.tickets.open, {
      ...ana,
      scope: "team_1",
      subject: "  Captions are late ",
      body: "My captions took an hour.",
      context: { page: "/runs/abc" },
    });
    const second = await t.mutation(api.tickets.open, { ...ana, subject: "Again", body: "Hi" });
    expect([first.number, second.number]).toEqual([1, 2]);

    const got = await t.query(api.tickets.get, { ticketId: first.ticketId });
    expect(got?.ticket).toMatchObject({
      subject: "Captions are late",
      status: "open",
      staffUnread: true,
      customerUnread: false,
      lastPublicFrom: "customer",
      context: { page: "/runs/abc" },
      messageCount: 1,
    });
    expect(got?.messages.map((m) => m.body)).toEqual(["My captions took an hour."]);
  });

  test("an empty or overlong message is refused", async () => {
    const t = backend();
    await expect(t.mutation(api.tickets.open, { ...ana, subject: " ", body: "x" })).rejects.toThrow(
      /subject/,
    );
    await expect(
      t.mutation(api.tickets.open, { ...ana, subject: "x", body: "y".repeat(10_001) }),
    ).rejects.toThrow(/too long/);
  });

  test("a staff reply is unread for the customer; private notes stay hidden from them", async () => {
    const t = backend();
    const { ticketId } = await t.mutation(api.tickets.open, { ...ana, subject: "S", body: "B" });
    await t.mutation(api.tickets.reply, {
      ticketId,
      from: "staff",
      authorId: "staff_1",
      authorName: "Support",
      body: "Looking into this ticket.",
      private: true,
    });
    let got = await t.query(api.tickets.get, { ticketId });
    expect(got?.messages).toHaveLength(1);
    expect(got?.ticket.customerUnread).toBe(false);
    expect(got?.ticket.preview).toBe("B");

    await t.mutation(api.tickets.reply, {
      ticketId,
      from: "staff",
      authorId: "staff_1",
      authorName: "Support",
      body: "Fixed now.",
    });
    got = await t.query(api.tickets.get, { ticketId });
    expect(got?.messages.map((m) => m.body)).toEqual(["B", "Fixed now."]);
    expect(got?.ticket).toMatchObject({ customerUnread: true, lastPublicFrom: "staff" });

    const withNotes = await t.query(api.tickets.get, { ticketId, withPrivate: true });
    expect(withNotes?.messages).toHaveLength(3);
    expect(await t.query(api.tickets.customerUnread, { requesterId: ana.requesterId })).toBe(1);

    await t.mutation(api.tickets.markRead, { ticketId, by: "customer" });
    expect(await t.query(api.tickets.customerUnread, { requesterId: ana.requesterId })).toBe(0);
  });

  test("customers can't write private notes", async () => {
    const t = backend();
    const { ticketId } = await t.mutation(api.tickets.open, { ...ana, subject: "S", body: "B" });
    await expect(
      t.mutation(api.tickets.reply, {
        ticketId,
        from: "customer",
        authorId: ana.requesterId,
        authorName: "Ana",
        body: "secret",
        private: true,
      }),
    ).rejects.toThrow(/Only support/);
  });

  test("closing and a customer writing again reopens it", async () => {
    const t = backend();
    const { ticketId } = await t.mutation(api.tickets.open, { ...ana, subject: "S", body: "B" });
    await t.mutation(api.tickets.markRead, { ticketId, by: "staff" });
    expect(await t.mutation(api.tickets.setStatus, { ticketId, status: "closed", by: "staff" })).toBe(
      true,
    );
    expect(await t.query(api.tickets.staffCounts, {})).toEqual({ open: 0, unread: 0 });
    expect((await t.query(api.tickets.listByStatus, { status: "closed" })).length).toBe(1);

    const { reopened } = await t.mutation(api.tickets.reply, {
      ticketId,
      from: "customer",
      authorId: ana.requesterId,
      authorName: "Ana",
      body: "Still broken",
    });
    expect(reopened).toBe(true);
    expect(await t.query(api.tickets.staffCounts, {})).toEqual({ open: 1, unread: 1 });
    const got = await t.query(api.tickets.get, { ticketId });
    expect(got?.ticket.closedAt).toBeUndefined();
  });

  test("lists by person and status, latest first, and finds by number", async () => {
    const t = backend();
    const a = await t.mutation(api.tickets.open, { ...ana, subject: "First", body: "B" });
    await t.mutation(api.tickets.open, {
      requesterId: "user_bo",
      requesterName: "Bo",
      requesterEmail: "bo@example.test",
      subject: "Bo's",
      body: "B",
    });
    await t.mutation(api.tickets.open, { ...ana, subject: "Second", body: "B" });
    const mine = await t.query(api.tickets.listByRequester, { requesterId: ana.requesterId });
    expect(mine.map((x) => x.subject)).toEqual(["Second", "First"]);
    const open = await t.query(api.tickets.listByStatus, { status: "open" });
    expect(open).toHaveLength(3);
    expect((await t.query(api.tickets.byNumber, { number: 1 }))?._id).toBe(a.ticketId);
  });

  test("removing by person or scope deletes the tickets and their messages", async () => {
    const t = backend();
    await t.mutation(api.tickets.open, { ...ana, scope: "team_1", subject: "A", body: "B" });
    await t.mutation(api.tickets.open, { ...ana, scope: "team_2", subject: "C", body: "D" });
    expect(await t.mutation(api.tickets.removeByScope, { scope: "team_1" })).toBe(1);
    expect(await t.mutation(api.tickets.removeByRequester, { requesterId: ana.requesterId })).toBe(1);
    const left = await t.run(async (ctx) => [
      ...(await ctx.db.query("tickets").collect()),
      ...(await ctx.db.query("messages").collect()),
    ]);
    expect(left).toEqual([]);
  });
});
