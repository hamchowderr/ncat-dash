import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";

const CLIP = "https://files.example/opening_hello.mp4";

async function room() {
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team]);
  const dev = await addPerson(t, "Dev Patel", [team]);
  const sam = await addPerson(t, "Sam Lee", [team]);
  const reviewId = await maya.as.mutation(api.reviews.create, {
    organizationId: team,
    title: "Weekly clips",
    urls: [CLIP],
  });
  const review = await maya.as.query(api.reviews.get, { reviewId });
  const clip = review!.clips[0];
  const say = (person: typeof maya, body: string, parentId?: never) =>
    person.as.mutation(api.reviews.comment, {
      clipId: clip._id,
      body,
      time: 4,
      version: 1,
      parentId,
    });
  const alerts = () => t.run((ctx) => ctx.db.query("alerts").collect());
  return { t, team, maya, dev, sam, reviewId, clip, say, alerts };
}

describe("a mention in a review", () => {
  test("tells only the people named, under the bell, linked to the thread", async () => {
    const { team, maya, dev, sam, reviewId, clip, say, alerts } = await room();
    const commentId = await say(maya, "@Dev Patel can you tighten the cut at 0:04?");
    const [alert] = await alerts();
    expect(alert).toMatchObject({
      kind: "mention",
      recipients: [dev.id],
      from: "Maya Ortiz",
      automationName: "Weekly clips",
      message: "@Dev Patel can you tighten the cut at 0:04?",
    });

    const devs = await dev.as.query(api.alerts.list, { organizationId: team });
    expect(devs.alerts[0].href).toBe(`/review/${reviewId}?clip=${clip._id}&comment=${commentId}`);
    expect((await sam.as.query(api.alerts.list, { organizationId: team })).alerts).toEqual([]);
    expect((await maya.as.query(api.alerts.list, { organizationId: team })).alerts).toEqual([]);
  });

  test("in a reply links to the start of the thread", async () => {
    const { maya, dev, say, alerts, reviewId, clip } = await room();
    const root = await say(maya, "Opening feels slow.");
    await dev.as.mutation(api.reviews.comment, {
      clipId: clip._id,
      body: "Agreed, @Maya Ortiz, I will trim it.",
      time: 0,
      version: 1,
      parentId: root,
    });
    const [alert] = await alerts();
    expect(alert).toMatchObject({ recipients: [maya.id], reviewId, commentId: root });
  });

  test("of yourself, of the agent, or of nobody tells nobody", async () => {
    const { maya, say, alerts } = await room();
    await say(maya, "Note to self, @Maya Ortiz: check the music.");
    await say(maya, "Nothing to see here.");
    await say(maya, "@Agent is the pacing ok?");
    const mentions = (await alerts()).filter((alert) => alert.kind === "mention");
    expect(mentions).toEqual([]);
  });

  test("is emailed unless the person switched mention emails off", async () => {
    const { t, team, maya, dev, sam, say, alerts } = await room();
    await sam.as.mutation(api.notifications.set, {
      organizationId: team,
      kind: "mention",
      channel: "email",
      enabled: false,
    });
    await say(maya, "@Dev Patel and @Sam Lee, thoughts?");
    const [alert] = await alerts();
    expect(alert.recipients?.sort()).toEqual([dev.id, sam.id].sort());
    const found = await t.query(internal.email.alertRecipients, { alertId: alert._id });
    expect(found?.recipients).toEqual(["dev.patel@example.test"]);
  });

  test("switched off for the bell is not shown to that person", async () => {
    const { team, maya, dev, say } = await room();
    await dev.as.mutation(api.notifications.set, {
      organizationId: team,
      kind: "mention",
      channel: "bell",
      enabled: false,
    });
    await say(maya, "@Dev Patel look at this.");
    expect((await dev.as.query(api.alerts.list, { organizationId: team })).alerts).toEqual([]);
  });
});
