import { afterEach, describe, expect, test, vi } from "vitest";

import { api, components, internal } from "./_generated/api";
import { handOverMessage } from "./accountDeletion";
import { addPerson, addTeam, backend } from "./test.setup";

/**
 * Deleting your own account: teams only you are on go with you, teams you share you
 * leave, and a team you are the only owner of has to be handed over or deleted first.
 */
afterEach(() => vi.useRealTimers());

async function teams() {
  const t = backend();
  const solo = await addTeam(t, "Example Studio");
  const shared = await addTeam(t, "Pine Studio");
  const owned = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [solo], "owner");
  // Maya is a member of Pine Studio, which Olu owns.
  const olu = await addPerson(t, "Olu Bello", [shared], "owner");
  await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "member",
        data: { organizationId: shared, userId: maya.id, role: "member", createdAt: Date.now() },
      },
    } as never),
  );
  return { t, solo, shared, owned, maya, olu };
}

async function addMember(
  t: ReturnType<typeof backend>,
  organizationId: string,
  userId: string,
  role: string,
) {
  await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "member",
        data: { organizationId, userId, role, createdAt: Date.now() },
      },
    } as never),
  );
}

describe("what deleting your account does to your teams", () => {
  test("a team only you are on goes with you, one you share you leave", async () => {
    const { solo, shared, maya } = await teams();
    expect(await maya.as.query(api.accountDeletion.plan, {})).toEqual({
      deleteWithYou: [{ id: solo, name: "Example Studio" }],
      leave: [{ id: shared, name: "Pine Studio" }],
      handOverFirst: [],
    });
  });

  test("the only owner of a team others are on hands it over first", async () => {
    const { t, owned, maya, olu } = await teams();
    await addMember(t, owned, maya.id, "owner");
    await addMember(t, owned, olu.id, "member");
    const plan = await maya.as.query(api.accountDeletion.plan, {});
    expect(plan?.handOverFirst).toEqual([{ id: owned, name: "Salt House" }]);
    expect(await t.mutation(internal.accountDeletion.prepare, { userId: maya.id })).toBe(
      handOverMessage([{ id: owned, name: "Salt House" }]),
    );
    // Nothing was touched.
    const left = await t.run((ctx) =>
      ctx.runQuery(components.betterAuth.deletion.teamsOf, { userId: maya.id }),
    );
    expect(left).toHaveLength(3);
  });

  test("a team with a second owner is simply left", async () => {
    const { t, owned, maya, olu } = await teams();
    await addMember(t, owned, maya.id, "owner");
    await addMember(t, owned, olu.id, "owner");
    const plan = await maya.as.query(api.accountDeletion.plan, {});
    expect(plan?.leave.map((team) => team.name)).toContain("Salt House");
    expect(plan?.handOverFirst).toEqual([]);
  });

  test("signed out, there is nothing to say", async () => {
    const t = backend();
    expect(await t.query(api.accountDeletion.plan, {})).toBeNull();
  });

  test("the message names every team to hand over", () => {
    expect(handOverMessage([{ id: "1", name: "Salt House" }])).toBe(
      "You are the only owner of Salt House. Make someone else an owner, or delete the team, before deleting your account.",
    );
    expect(
      handOverMessage([
        { id: "1", name: "A" },
        { id: "2", name: "B" },
        { id: "3", name: "C" },
      ]),
    ).toContain("of A, B and C. Make someone else an owner, or delete those teams");
  });
});

describe("just before the account goes", () => {
  test("its own team is deleted with everything in it, and it leaves the shared one", async () => {
    const { t, solo, shared, maya, olu } = await teams();
    await t.run(async (ctx) => {
      await ctx.db.insert("automationFolders", {
        organizationId: solo,
        name: "Shows",
        createdBy: maya.id,
      });
      for (const organizationId of [solo, shared]) {
        await ctx.db.insert("notificationPreferences", { organizationId, userId: maya.id });
      }
      await ctx.db.insert("notificationPreferences", { organizationId: shared, userId: olu.id });
      await ctx.db.insert("tourEnds", {
        userId: maya.id,
        tourId: "dashboard",
        how: "closed",
        endedAt: 1,
      });
    });

    expect(await t.mutation(internal.accountDeletion.prepare, { userId: maya.id })).toBeNull();
    vi.useFakeTimers();
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const name = await t.run((ctx) =>
      ctx.runQuery(components.betterAuth.deletion.teamName, { organizationId: solo }),
    );
    expect(name).toBeNull();
    // Pine Studio is still there, with Olu on it and Maya gone from it.
    const pine = await t.run((ctx) =>
      ctx.runQuery(components.betterAuth.members.contactsFor, { organizationId: shared }),
    );
    expect(pine.members.map((person) => person.name)).toEqual(["Olu Bello"]);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("automationFolders").collect()).toEqual([]);
      const preferences = await ctx.db.query("notificationPreferences").collect();
      expect(preferences.map((row) => row.userId)).toEqual([olu.id]);
      expect(await ctx.db.query("tourEnds").collect()).toEqual([]);
      const record = await ctx.db.query("teamDeletions").collect();
      expect(record).toMatchObject([
        { organizationId: solo, name: "Example Studio", reason: "account", phase: "done" },
      ]);
    });
  });

  test("the agents the person connected stop working", async () => {
    const { t, shared, maya } = await teams();
    await t.run((ctx) =>
      ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "oauthConsent",
          data: {
            clientId: "https://agent.example/client.json",
            userId: maya.id,
            referenceId: shared,
            scopes: ["openid"],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      } as never),
    );
    await t.mutation(internal.accountDeletion.prepare, { userId: maya.id });
    const agents = await t.run((ctx) =>
      ctx.runQuery(components.betterAuth.agents.forTeam, { organizationId: shared }),
    );
    expect(agents).toEqual([]);
  });
});

describe("Better Auth's delete-user route", () => {
  async function hook(answer: string | null) {
    const { createAuthOptions } = await import("./auth");
    const runMutation = vi.fn(async () => answer);
    const ctx = { runMutation, runQuery: vi.fn(), runAction: vi.fn(), scheduler: {} };
    const options = createAuthOptions(ctx as never);
    return { options, runMutation };
  }

  test("is turned on", async () => {
    const { options } = await hook(null);
    expect(options.user.deleteUser.enabled).toBe(true);
  });

  test("deals with the person's teams just before the account goes", async () => {
    const { options, runMutation } = await hook(null);
    await options.user.deleteUser.beforeDelete({ id: "user_1" } as never);
    expect(runMutation).toHaveBeenCalledWith(internal.accountDeletion.prepare, {
      userId: "user_1",
    });
  });

  test("stops with the reason when a team has to be handed over first", async () => {
    const { options } = await hook("You are the only owner of Salt House.");
    await expect(options.user.deleteUser.beforeDelete({ id: "user_1" } as never)).rejects.toThrow(
      "You are the only owner of Salt House.",
    );
  });
});
