import { beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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
const DAY = 24 * 3600 * 1000;

async function agency() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  const dev = await addPerson(t, "Dev Patel", [team], "member");
  const otherTeam = await addTeam(t, "Other Team");
  const outsider = await addPerson(t, "Someone Else", [otherTeam]);
  const acme = await maya.as.mutation(api.clients.create, { organizationId: team, name: "Acme" });
  const bright = await maya.as.mutation(api.clients.create, {
    organizationId: team,
    name: "Bright Co",
  });
  const elsewhere = await outsider.as.mutation(api.clients.create, {
    organizationId: otherTeam,
    name: "Theirs",
  });
  return { t, team, maya, dev, otherTeam, outsider, acme, bright, elsewhere };
}

async function alertsOf(t: ReturnType<typeof backend>) {
  return await t.run((ctx) => ctx.db.query("alerts").collect());
}

describe("usage rights dates", () => {
  test("only real calendar days count, and the alert says when and what for", () => {
    expect(isDay("2026-11-28")).toBe(true);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("28/11/2026")).toBe(false);
    expect(addDays("2026-11-28", 7)).toBe("2026-12-05");
    expect(daysBetween("2026-11-21", "2026-11-28")).toBe(7);
    expect(sayHowSoon(0)).toBe("today");
    expect(sayHowSoon(1)).toBe("tomorrow");
    expect(rightsMessage("2026-11-28", "2026-11-21", "paid")).toBe(
      "The last day you may use their footage is in 7 days, on Saturday, November 28. Take down ads and posts with their clips by then, or agree new dates with them. Paid ads.",
    );
    expect(rightsMessage("2026-11-21", "2026-11-21", "organic")).toContain(
      "is today. Take down posts",
    );
  });
});

describe("creators and their deals", () => {
  test("anyone on the team keeps creators, with a deal per client; outsiders see nothing", async () => {
    const { team, dev, outsider, acme, bright, elsewhere } = await agency();
    const ana = await dev.as.mutation(api.creators.create, {
      organizationId: team,
      name: "  Ana   Ruiz ",
    });
    await expect(
      dev.as.mutation(api.creators.create, { organizationId: team, name: "ana ruiz" }),
    ).rejects.toThrow(/already here/);

    await dev.as.mutation(api.creators.saveDeal, {
      creatorId: ana,
      clientId: bright,
      endsOn: "2027-03-01",
      usage: "paid",
    });
    await dev.as.mutation(api.creators.saveDeal, {
      creatorId: ana,
      clientId: acme,
      endsOn: "2026-12-15",
      usage: "both",
      note: "Whitelisted on Meta",
    });
    await expect(
      dev.as.mutation(api.creators.saveDeal, {
        creatorId: ana,
        endsOn: "2027-02-30",
        usage: "organic",
      }),
    ).rejects.toThrow(/last day/);
    await expect(
      dev.as.mutation(api.creators.saveDeal, {
        creatorId: ana,
        clientId: elsewhere,
        endsOn: "2027-01-01",
        usage: "organic",
      }),
    ).rejects.toThrow(/not on this team/);

    const page = await dev.as.query(api.creators.get, { creatorId: ana });
    expect(page?.name).toBe("Ana Ruiz");
    // Soonest first.
    expect(page?.deals.map((deal) => [deal.client, deal.endsOn, deal.usage, deal.note])).toEqual([
      ["Acme", "2026-12-15", "both", "Whitelisted on Meta"],
      ["Bright Co", "2027-03-01", "paid", ""],
    ]);
    expect(page?.clients.map((client) => client.name)).toEqual(["Acme", "Bright Co"]);

    const list = await dev.as.query(api.creators.list, { organizationId: team });
    expect(list.creators).toEqual([
      expect.objectContaining({
        name: "Ana Ruiz",
        deals: 2,
        next: { endsOn: "2026-12-15", client: "Acme" },
      }),
    ]);

    expect(await outsider.as.query(api.creators.get, { creatorId: ana })).toBeNull();
    await expect(outsider.as.query(api.creators.list, { organizationId: team })).rejects.toThrow(
      /not on this team/,
    );
    await expect(outsider.as.mutation(api.creators.remove, { creatorId: ana })).rejects.toThrow(
      /not on this team/,
    );

    await dev.as.mutation(api.creators.removeDeal, { dealId: page!.deals[1]._id });
    expect((await dev.as.query(api.creators.get, { creatorId: ana }))?.deals).toHaveLength(1);
  });

  test("a deleted client's deals stay, with its name kept in the note", async () => {
    const { t, team, maya, acme } = await agency();
    const ana = await maya.as.mutation(api.creators.create, { organizationId: team, name: "Ana" });
    await maya.as.mutation(api.creators.saveDeal, {
      creatorId: ana,
      clientId: acme,
      endsOn: "2027-01-10",
      usage: "paid",
      note: "Spark Ads",
    });
    await maya.as.mutation(api.clients.remove, { clientId: acme });
    const page = await maya.as.query(api.creators.get, { creatorId: ana });
    expect(page?.deals.map((deal) => [deal.client, deal.note])).toEqual([
      [null, "For Acme. Spark Ads"],
    ]);
    // Removing the creator takes their deals with them.
    await maya.as.mutation(api.creators.remove, { creatorId: ana });
    expect(await t.run((ctx) => ctx.db.query("creatorRights").collect())).toEqual([]);
  });

  test("offers the creator folder names that started runs and are not added yet, and lists their runs", async () => {
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
      for (const creator of ["Ana Ruiz", "Ben Cole", "ana ruiz"]) {
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
    const ben = await maya.as.mutation(api.creators.create, {
      organizationId: team,
      name: "Ben Cole",
    });
    expect((await maya.as.query(api.creators.list, { organizationId: team })).seen).toEqual([
      "Ana Ruiz",
    ]);
    const page = await maya.as.query(api.creators.get, { creatorId: ben });
    expect(page?.runs.map((run) => run.automationName)).toEqual(["UGC Ad Variants"]);
  });
});

describe("a week before a deal ends", () => {
  async function withDeals() {
    const setup = await agency();
    const { team, dev, acme } = setup;
    const ana = await dev.as.mutation(api.creators.create, {
      organizationId: team,
      name: "Ana Ruiz",
    });
    const ben = await dev.as.mutation(api.creators.create, {
      organizationId: team,
      name: "Ben Cole",
    });
    const deal = await dev.as.mutation(api.creators.saveDeal, {
      creatorId: ana,
      clientId: acme,
      endsOn: "2026-11-28",
      usage: "paid",
    });
    // Further off than a week, and already over: nothing yet.
    await dev.as.mutation(api.creators.saveDeal, {
      creatorId: ben,
      endsOn: "2026-11-29",
      usage: "organic",
    });
    await dev.as.mutation(api.creators.saveDeal, {
      creatorId: ben,
      endsOn: "2026-11-20",
      usage: "both",
    });
    return { ...setup, ana, ben, deal: deal as Id<"creatorRights"> };
  }

  test("the whole team hears once, in Inbox and the chat apps they linked, about that deal", async () => {
    const { t, team, maya, dev, ana } = await withDeals();
    const sent = standIn();

    expect(await t.mutation(internal.creators.checkEnding, { now: NOW })).toBe(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const alerts = await alertsOf(t);
    expect(alerts).toEqual([
      expect.objectContaining({
        organizationId: team,
        kind: "rights_ending",
        creatorId: ana,
        automationName: "Ana Ruiz",
        stepName: "Acme",
        message: expect.stringContaining("in 7 days, on Saturday, November 28"),
      }),
    ]);
    expect(alertHref(alerts[0])).toBe(`/creators/${ana}`);
    expect(sent.map((one) => one.target.userId).sort()).toEqual([dev.id, maya.id].sort());
    expect(sent[0].alert.title).toBe("Ana Ruiz's rights for Acme end soon");
    expect(sent[0].alert.link).toContain(`/creators/${ana}`);
    const inbox = await maya.as.query(api.alerts.list, { organizationId: team });
    expect(inbox.alerts.map((alert) => alert.kind)).toEqual(["rights_ending"]);

    // The next day Ben's deal is a week out; Ana's is not told again.
    expect(await t.mutation(internal.creators.checkEnding, { now: NOW + DAY })).toBe(1);
    expect(await t.mutation(internal.creators.checkEnding, { now: NOW + 2 * DAY })).toBe(0);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const second = (await alertsOf(t))[1];
    expect([second.automationName, second.stepName]).toEqual(["Ben Cole", undefined]);
    expect(sent.at(-1)?.alert.title).toBe("Usage rights for Ben Cole end soon");
  });

  test("a new end date is warned about again; a note change is not", async () => {
    const { t, dev, ana, acme, deal } = await withDeals();
    standIn();
    await t.mutation(internal.creators.checkEnding, { now: NOW });
    let page = await dev.as.query(api.creators.get, { creatorId: ana });
    expect(page?.deals[0].alerted).toBe(true);

    const same = { creatorId: ana, dealId: deal, clientId: acme, usage: "paid" as const };
    await dev.as.mutation(api.creators.saveDeal, {
      ...same,
      endsOn: "2026-11-28",
      note: "Asked to renew",
    });
    // Ben's deal (Nov 29) is outside the week on this day too.
    expect(await t.mutation(internal.creators.checkEnding, { now: NOW })).toBe(0);

    await dev.as.mutation(api.creators.saveDeal, { ...same, endsOn: "2026-11-27" });
    page = await dev.as.query(api.creators.get, { creatorId: ana });
    expect(page?.deals[0].alerted).toBe(false);
    expect(await t.mutation(internal.creators.checkEnding, { now: NOW })).toBe(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("is on everywhere unless a person switches it off", async () => {
    for (const channel of ["bell", "email", "slack", "discord", "teams", "telegram"] as const) {
      expect(wants(null, "rights_ending", channel)).toBe(true);
    }
    const { t, team, maya, dev } = await withDeals();
    const sent = standIn();
    await maya.as.mutation(api.notifications.set, {
      organizationId: team,
      kind: "rights_ending",
      channel: "slack",
      enabled: false,
    });
    await t.mutation(internal.creators.checkEnding, { now: NOW });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sent.map((one) => one.target.userId)).toEqual([dev.id]);
  });
});
