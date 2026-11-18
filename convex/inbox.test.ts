import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { SHOWN } from "./alerts";
import { addPerson, addTeam, backend } from "./test.setup";

/** A team of two and `count` mentions for Ana, oldest first. */
async function inbox(count: number) {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const ana = await addPerson(t, "Ana Reyes", [team]);
  const ben = await addPerson(t, "Ben Cho", [team]);
  await t.run(async (ctx) => {
    for (let index = 0; index < count; index++) {
      await ctx.db.insert("alerts", {
        organizationId: team,
        kind: "mention",
        recipients: [ana.id],
        automationName: `Review ${index}`,
        message: `note ${index}`,
        retries: 0,
        from: "Ben Cho",
        seenBy: [],
      });
    }
  });
  return { t, team, ana, ben };
}

describe("the Inbox", () => {
  test("keeps the latest hundred, newest first, with how many are new", async () => {
    const { team, ana } = await inbox(SHOWN + 20);
    const listed = await ana.as.query(api.alerts.list, { organizationId: team });
    expect(SHOWN).toBe(100);
    expect(listed.alerts).toHaveLength(SHOWN);
    expect(listed.unseen).toBe(SHOWN);
    expect(listed.alerts[0].automationName).toBe(`Review ${SHOWN + 19}`);
    expect(listed.alerts[0].href).toBe("/");
  });

  test("marking all as seen covers everything the Inbox lists", async () => {
    const { team, ana } = await inbox(SHOWN + 20);
    await ana.as.mutation(api.alerts.markSeen, { organizationId: team });
    const listed = await ana.as.query(api.alerts.list, { organizationId: team });
    expect(listed.unseen).toBe(0);
    expect(listed.alerts.every((alert) => alert.seen)).toBe(true);
  });

  test("marking one as seen leaves the rest new, and is only for the person who did it", async () => {
    const { t, team, ana, ben } = await inbox(3);
    const [latest] = (await ana.as.query(api.alerts.list, { organizationId: team })).alerts;
    await ana.as.mutation(api.alerts.markSeen, { organizationId: team, alertId: latest._id });
    const listed = await ana.as.query(api.alerts.list, { organizationId: team });
    expect(listed.unseen).toBe(2);
    expect(listed.alerts.map((alert) => alert.seen)).toEqual([true, false, false]);
    // Ben was never sent these, so his Inbox stays empty.
    expect((await ben.as.query(api.alerts.list, { organizationId: team })).alerts).toEqual([]);
    const seenBy = await t.run(async (ctx) => (await ctx.db.get(latest._id))?.seenBy);
    expect(seenBy).toEqual([ana.id]);
  });
});
