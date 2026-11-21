import { beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { type ChatAlert, type ChatSender, type ChatTarget, SENDERS } from "./lib/chatAlerts";
import { addDays, daysBetween, isDay, rightsMessage, sayHowSoon } from "./lib/creatorRights";
import { alertHref, wants } from "./lib/notifications";
import { addPerson, addTeam, backend } from "./test.setup";

/** A stand-in chat app every member has linked; it writes down what it sends. */
function standIn() {
  const sent: { alert: ChatAlert; target: ChatTarget }[] = [];
  const sender: ChatSender = {
    app: "slack",
    isLinked: async () => true,
    targets: async (_ctx, _organizationId, userIds) =>
      userIds.map((userId) => ({ userId, address: `dm-${userId}` })),
    send: async (_ctx, alert, target) => {
      sent.push({ alert, target });
      return { ref: `${target.address}:${sent.length}`, text: alert.title };
    },
  };
  SENDERS.splice(0, SENDERS.length, sender);
  return sent;
}

beforeEach(() => {
  SENDERS.length = 0;
  vi.useFakeTimers();
});

// Saturday, November 21, 2026, at noon UTC.
const NOW = Date.parse("2026-11-21T12:00:00Z");

async function agency() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  const dev = await addPerson(t, "Dev Patel", [team], "member");
  const otherTeam = await addTeam(t, "Other Team");
  const outsider = await addPerson(t, "Someone Else", [otherTeam]);
  return { t, team, maya, dev, otherTeam, outsider };
}

async function alertsOf(t: ReturnType<typeof backend>) {
  return await t.run((ctx) => ctx.db.query("alerts").collect());
}

describe("creator usage rights dates", () => {
  test("only real calendar days are accepted", () => {
    expect(isDay("2026-11-28")).toBe(true);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("28/11/2026")).toBe(false);
    expect(addDays("2026-11-28", 7)).toBe("2026-12-05");
    expect(daysBetween("2026-11-21", "2026-11-28")).toBe(7);
    expect(sayHowSoon(0)).toBe("today");
    expect(sayHowSoon(1)).toBe("tomorrow");
    expect(rightsMessage("2026-11-28", "2026-11-21")).toBe(
      "The last day you may use their footage is in 7 days, on Saturday, November 28. Take down ads with their clips by then, or agree new dates with them.",
    );
  });

  test("anyone on the team keeps them; names are unique; outsiders see nothing", async () => {
    const { team, dev, outsider } = await agency();
    await dev.as.mutation(api.creatorRights.save, {
      organizationId: team,
      creator: "  Ana   Ruiz ",
      endsOn: "2027-01-31",
      note: "Paid on Meta",
    });
    await dev.as.mutation(api.creatorRights.save, {
      organizationId: team,
      creator: "Ben Cole",
      endsOn: "2026-12-15",
    });
    const list = await dev.as.query(api.creatorRights.list, { organizationId: team });
    // Soonest first.
    expect(list.creators.map((row) => [row.creator, row.endsOn, row.note])).toEqual([
      ["Ben Cole", "2026-12-15", ""],
      ["Ana Ruiz", "2027-01-31", "Paid on Meta"],
    ]);
    await expect(
      dev.as.mutation(api.creatorRights.save, {
        organizationId: team,
        creator: "ana ruiz",
        endsOn: "2027-03-01",
      }),
    ).rejects.toThrow(/already has an end date/);
    await expect(
      dev.as.mutation(api.creatorRights.save, {
        organizationId: team,
        creator: "Cy",
        endsOn: "2027-02-30",
      }),
    ).rejects.toThrow(/last day/);
    await expect(
      outsider.as.query(api.creatorRights.list, { organizationId: team }),
    ).rejects.toThrow(/not on this team/);
    await expect(
      outsider.as.mutation(api.creatorRights.remove, {
        organizationId: team,
        id: list.creators[0].id,
      }),
    ).rejects.toThrow(/not on this team/);

    await dev.as.mutation(api.creatorRights.remove, {
      organizationId: team,
      id: list.creators[0].id,
    });
    const after = await dev.as.query(api.creatorRights.list, { organizationId: team });
    expect(after.creators.map((row) => row.creator)).toEqual(["Ana Ruiz"]);
  });

  test("offers the creator folder names that started runs and have no date yet", async () => {
    const { t, team, maya } = await agency();
    await t.run(async (ctx) => {
      const automationId = await ctx.db.insert("automations", {
        organizationId: team,
        name: "UGC Ad Variants",
        enabled: true,
        trigger: { kind: "manual" },
        nodes: [],
        edges: [],
        hookToken: "token",
        nextRunAt: null,
        createdBy: maya.id,
        updatedAt: Date.now(),
      });
      for (const creator of ["Ana Ruiz", "Ben Cole", "Ana Ruiz"]) {
        await ctx.db.insert("runs", {
          organizationId: team,
          automationId,
          automationName: "UGC Ad Variants",
          status: "done",
          triggerKind: "folder",
          trigger: { creator, hooks: [] },
          nodes: [],
          edges: [],
          error: null,
          startedBy: null,
          finishedAt: null,
        });
      }
    });
    await maya.as.mutation(api.creatorRights.save, {
      organizationId: team,
      creator: "Ben Cole",
      endsOn: "2027-01-01",
    });
    const list = await maya.as.query(api.creatorRights.list, { organizationId: team });
    expect(list.seen).toEqual(["Ana Ruiz"]);
  });
});

describe("a week before rights end", () => {
  test("the whole team hears once: Inbox, and the chat apps they linked", async () => {
    const { t, team, maya, dev } = await agency();
    const sent = standIn();
    await dev.as.mutation(api.creatorRights.save, {
      organizationId: team,
      creator: "Ana Ruiz",
      endsOn: "2026-11-28",
    });
    // Further off than a week, and already over: nothing.
    await dev.as.mutation(api.creatorRights.save, {
      organizationId: team,
      creator: "Ben Cole",
      endsOn: "2026-11-29",
    });
    await dev.as.mutation(api.creatorRights.save, {
      organizationId: team,
      creator: "Cy Park",
      endsOn: "2026-11-20",
    });

    expect(await t.mutation(internal.creatorRights.checkEnding, { now: NOW })).toBe(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const alerts = await alertsOf(t);
    expect(alerts).toEqual([
      expect.objectContaining({
        organizationId: team,
        kind: "rights_ending",
        automationName: "Ana Ruiz",
        message: expect.stringContaining("in 7 days, on Saturday, November 28"),
      }),
    ]);
    expect(alertHref(alerts[0])).toBe("/settings/creators");
    // Both members, in the chat app, with a link to Settings > Creators.
    expect(sent.map((one) => one.target.userId).sort()).toEqual([dev.id, maya.id].sort());
    expect(sent[0].alert.title).toBe("Usage rights for Ana Ruiz end soon");
    expect(sent[0].alert.link).toContain("/settings/creators");
    // In Inbox for everyone.
    const inbox = await maya.as.query(api.alerts.list, { organizationId: team });
    expect(inbox.alerts.map((alert) => alert.kind)).toEqual(["rights_ending"]);

    // The next day: not again.
    expect(
      await t.mutation(internal.creatorRights.checkEnding, { now: NOW + 24 * 3600 * 1000 }),
    ).toBe(1); // Ben Cole is a week out now.
    expect((await alertsOf(t)).map((alert) => alert.automationName)).toEqual([
      "Ana Ruiz",
      "Ben Cole",
    ]);
    expect(
      await t.mutation(internal.creatorRights.checkEnding, { now: NOW + 2 * 24 * 3600 * 1000 }),
    ).toBe(0);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("a new end date is warned about again; a note change is not", async () => {
    const { t, team, dev } = await agency();
    standIn();
    const id = await dev.as.mutation(api.creatorRights.save, {
      organizationId: team,
      creator: "Ana Ruiz",
      endsOn: "2026-11-25",
    });
    await t.mutation(internal.creatorRights.checkEnding, { now: NOW });
    let list = await dev.as.query(api.creatorRights.list, { organizationId: team });
    expect(list.creators[0].alerted).toBe(true);

    await dev.as.mutation(api.creatorRights.save, {
      organizationId: team,
      id,
      creator: "Ana Ruiz",
      endsOn: "2026-11-25",
      note: "Renewal asked for",
    });
    expect(await t.mutation(internal.creatorRights.checkEnding, { now: NOW })).toBe(0);

    await dev.as.mutation(api.creatorRights.save, {
      organizationId: team,
      id,
      creator: "Ana Ruiz",
      endsOn: "2026-11-27",
    });
    list = await dev.as.query(api.creatorRights.list, { organizationId: team });
    expect(list.creators[0].alerted).toBe(false);
    expect(await t.mutation(internal.creatorRights.checkEnding, { now: NOW })).toBe(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("is on under Inbox, by email and in chat apps unless someone switches it off", async () => {
    for (const channel of ["bell", "email", "slack", "discord", "teams", "telegram"] as const) {
      expect(wants(null, "rights_ending", channel)).toBe(true);
    }
    const { t, team, maya, dev } = await agency();
    const sent = standIn();
    await maya.as.mutation(api.notifications.set, {
      organizationId: team,
      kind: "rights_ending",
      channel: "slack",
      enabled: false,
    });
    await dev.as.mutation(api.creatorRights.save, {
      organizationId: team,
      creator: "Ana Ruiz",
      endsOn: "2026-11-21",
    });
    await t.mutation(internal.creatorRights.checkEnding, { now: NOW });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sent.map((one) => one.target.userId)).toEqual([dev.id]);
    expect((await alertsOf(t))[0].message).toContain("is today");
  });
});
