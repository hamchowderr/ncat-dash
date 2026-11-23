import { afterEach, describe, expect, test, vi } from "vitest";

import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { TEAM_BLOCKED_MESSAGE, USER_BLOCKED_MESSAGE } from "./lib/access";
import { UNKNOWN_NETWORK } from "./lib/clientIp";
import { emailKey, isThrowawayEmail } from "./lib/emailKey";
import { waitLabel } from "./lib/limits";
import { startRun } from "./lib/runner";
import { TRIAL_ENDED_MESSAGE } from "./lib/trial";
import { addPerson, addTeam, backend } from "./test.setup";

// Keeping the free trial fair: a trial is one person's (not one per email or team), the
// operator can block a team or a person, and the things that cost money (sign-ups, new
// teams, agent replies, MCP calls) have limits a real person never meets.
const DAY = 24 * 60 * 60 * 1000;

afterEach(() => {
  delete process.env.NCAT_EDITION;
  delete process.env.TRIAL_DAYS;
  delete process.env.TRIALS_PER_NETWORK;
  delete process.env.BLOCKED_EMAIL_DOMAINS;
  vi.useRealTimers();
});

async function setUp(edition: "hosted" | "self-hosted" = "hosted") {
  process.env.NCAT_EDITION = edition;
  const t = backend();
  const team = await addTeam(t, "Salt House");
  const maya = await addPerson(t, "Maya Ortiz", [team], "owner");
  const automation = await t.run((ctx) =>
    ctx.db.insert("automations", {
      organizationId: team,
      name: "Clips",
      enabled: false,
      trigger: { kind: "manual" },
      nodes: [
        { id: "cut", kind: "step", stepId: "video-thumbnail", input: {}, position: { x: 0, y: 0 } },
      ],
      edges: [],
      hookToken: "token-clips",
      nextRunAt: null,
      createdBy: maya.id,
      updatedAt: Date.now(),
    }),
  );
  const start = (startedBy: string | null = maya.id) =>
    t.run(async (ctx) =>
      startRun(
        ctx,
        (await ctx.db.get(automation as Id<"automations">))!,
        "manual",
        { file_url: "https://files.example/a.mp4" },
        startedBy,
      ),
    );
  return { t, team, maya, start };
}

describe("one mailbox, however it is written", () => {
  test("dots and +tags in Gmail, and capitals anywhere, are the same person", () => {
    expect(emailKey("Maya.Ortiz+trial2@GoogleMail.com")).toBe("mayaortiz@gmail.com");
    expect(emailKey("m.a.y.a@gmail.com")).toBe("maya@gmail.com");
    expect(emailKey("Maya+x@Studio.Example")).toBe("maya@studio.example");
    // Dots matter outside Gmail.
    expect(emailKey("maya.ortiz@studio.example")).toBe("maya.ortiz@studio.example");
    expect(emailKey("not an email")).toBeNull();
  });

  test("throwaway email services are recognised, and the operator can add more", () => {
    expect(isThrowawayEmail("someone@mailinator.com")).toBe(true);
    expect(isThrowawayEmail("someone@sub.mailinator.com")).toBe(true);
    expect(isThrowawayEmail("maya@gmail.com")).toBe(false);
    expect(isThrowawayEmail("maya@studio.example")).toBe(false);
    expect(isThrowawayEmail("x@spam.example", { BLOCKED_EMAIL_DOMAINS: "spam.example, junk.test" })).toBe(true);
  });
});

describe("a trial is a person's, not a team's", () => {
  async function trialOf(t: ReturnType<typeof backend>, organizationId: string) {
    return await t.run((ctx) =>
      ctx.db
        .query("teamTrials")
        .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
        .unique(),
    );
  }

  test("a second team by the same mailbox shares what is left, and says so", async () => {
    const { t, maya } = await setUp();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T10:00:00Z"));
    await t.mutation(internal.trial.begin, {
      organizationId: "team_a",
      ownerId: maya.id,
      ownerEmail: "maya.ortiz@gmail.com",
    });
    vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
    await t.mutation(internal.trial.begin, {
      organizationId: "team_b",
      ownerId: "another-account",
      ownerEmail: "MayaOrtiz+again@gmail.com",
    });
    const first = (await trialOf(t, "team_a"))!;
    const second = (await trialOf(t, "team_b"))!;
    expect(second.endsAt).toBe(first.endsAt);
    expect(second.repeatOf).toBe("email");
  });

  test("someone whose earlier team bought starts a new team fresh", async () => {
    const { t } = await setUp();
    await t.mutation(internal.trial.begin, { organizationId: "team_a", ownerEmail: "maya@studio.example" });
    await t.mutation(internal.trial.markPaid, { organizationId: "team_a" });
    await t.mutation(internal.trial.begin, { organizationId: "team_b", ownerEmail: "maya@studio.example" });
    const second = (await trialOf(t, "team_b"))!;
    expect(second.repeatOf).toBeUndefined();
    expect(second.endsAt - second.startedAt).toBe(3 * DAY);
  });

  test("after two trials from one network in 30 days, the next starts already over", async () => {
    const { t } = await setUp();
    for (const [i, network] of ["net_home", "net_home", "net_home", "net_other"].entries()) {
      await t.run((ctx) =>
        ctx.db.insert("signUps", {
          userId: `user_${i}`,
          emailKey: `person${i}@studio.example`,
          networkKey: network,
          at: Date.now(),
        }),
      );
      await t.mutation(internal.trial.begin, { organizationId: `team_${i}`, ownerId: `user_${i}` });
    }
    expect((await trialOf(t, "team_0"))!.repeatOf).toBeUndefined();
    expect((await trialOf(t, "team_1"))!.repeatOf).toBeUndefined();
    const third = (await trialOf(t, "team_2"))!;
    expect(third.repeatOf).toBe("network");
    expect(third.endsAt).toBe(third.startedAt);
    // Another network is unaffected.
    expect((await trialOf(t, "team_3"))!.repeatOf).toBeUndefined();
  });

  test("an unknown network is never counted against anyone", async () => {
    const { t } = await setUp();
    for (let i = 0; i < 4; i++) {
      await t.run((ctx) =>
        ctx.db.insert("signUps", {
          userId: `user_${i}`,
          emailKey: `person${i}@studio.example`,
          networkKey: UNKNOWN_NETWORK,
          at: Date.now(),
        }),
      );
      await t.mutation(internal.trial.begin, { organizationId: `team_${i}`, ownerId: `user_${i}` });
      expect((await trialOf(t, `team_${i}`))!.repeatOf).toBeUndefined();
    }
  });

  test("the team's status says it had no fresh days", async () => {
    const { t, team, maya } = await setUp();
    // Their first team's trial ended yesterday.
    await t.run((ctx) =>
      ctx.db.insert("teamTrials", {
        organizationId: "team_a",
        startedAt: Date.now() - 4 * DAY,
        endsAt: Date.now() - DAY,
        emailKey: "maya@studio.example",
      }),
    );
    await t.mutation(internal.trial.begin, { organizationId: team, ownerEmail: "maya@studio.example" });
    const status = await maya.as.query(api.trial.status, { organizationId: team });
    expect(status).toMatchObject({ kind: "ended", repeat: true });
  });

  test("where a person signed up is noted on the hosted edition only", async () => {
    const { t } = await setUp("self-hosted");
    await t.mutation(internal.access.recordSignUp, {
      userId: "u1",
      email: "maya@studio.example",
      networkKey: "net_home",
    });
    expect(await t.run((ctx) => ctx.db.query("signUps").collect())).toEqual([]);
    process.env.NCAT_EDITION = "hosted";
    await t.mutation(internal.access.recordSignUp, {
      userId: "u1",
      email: "Maya+x@Studio.Example",
      networkKey: "net_home",
    });
    expect(await t.run((ctx) => ctx.db.query("signUps").collect())).toMatchObject([
      { userId: "u1", emailKey: "maya@studio.example", networkKey: "net_home" },
    ]);
  });
});

describe("the operator blocks a team", () => {
  test("nothing new runs and the agent and MCP say why; unblocking undoes it", async () => {
    const { t, team, maya, start } = await setUp("self-hosted");
    expect(await t.mutation(internal.blocks.blockTeam, { organizationId: team, reason: "Spam" })).toBe(
      true,
    );
    // Blocking twice changes nothing.
    expect(await t.mutation(internal.blocks.blockTeam, { organizationId: team })).toBe(false);
    expect(await start()).toEqual({ ok: false, message: TEAM_BLOCKED_MESSAGE });
    expect(await maya.as.mutation(api.access.agentTurn, { organizationId: team })).toEqual({
      ok: false,
      reason: "team_blocked",
      message: TEAM_BLOCKED_MESSAGE,
    });
    expect(
      await t.mutation(internal.access.channelTurn, { organizationId: team, userId: maya.id }),
    ).toMatchObject({ ok: false, reason: "team_blocked" });
    expect(
      await t.mutation(internal.access.mcpCall, { organizationId: team, userId: maya.id }),
    ).toMatchObject({ ok: false, reason: "team_blocked" });
    expect(await maya.as.query(api.access.mine, { organizationId: team })).toMatchObject({
      reason: "team_blocked",
    });
    expect(await t.query(internal.blocks.list, {})).toMatchObject([
      { kind: "team", targetId: team, reason: "Spam" },
    ]);

    expect(await t.mutation(internal.blocks.unblockTeam, { organizationId: team })).toBe(true);
    expect((await start()).ok).toBe(true);
    expect(await maya.as.query(api.access.mine, { organizationId: team })).toBeNull();
  });

  test("only the team's own people can ask about it", async () => {
    const { t, team } = await setUp();
    const outsider = await addPerson(t, "Someone Else", [await addTeam(t, "Other Team")]);
    await expect(outsider.as.query(api.access.mine, { organizationId: team })).rejects.toThrow(
      /not on this team/,
    );
    await expect(outsider.as.mutation(api.access.agentTurn, { organizationId: team })).rejects.toThrow(
      /not on this team/,
    );
  });
});

describe("the operator blocks a person", () => {
  test("by email: they are signed out everywhere, refused, and can be let back", async () => {
    const { t, team, maya, start } = await setUp("self-hosted");
    const blocked = await t.action(internal.blocks.blockUser, { email: "Maya.Ortiz@example.test" });
    expect(blocked).toBe(maya.id);
    const sessions = await t.run((ctx) =>
      ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "session",
        where: [{ field: "userId", value: maya.id }],
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    );
    expect(sessions.page).toEqual([]);
    expect(await t.query(internal.access.userBlocked, { userId: maya.id })).toBe(true);
    expect(
      await t.mutation(internal.access.channelTurn, { organizationId: team, userId: maya.id }),
    ).toEqual({ ok: false, reason: "user_blocked", message: USER_BLOCKED_MESSAGE });
    expect(await start(maya.id)).toEqual({ ok: false, message: USER_BLOCKED_MESSAGE });
    // The team's own automations still run for everyone else.
    expect((await start(null)).ok).toBe(true);

    expect(await t.action(internal.blocks.unblockUser, { userId: maya.id })).toBe(maya.id);
    expect(await t.query(internal.access.userBlocked, { userId: maya.id })).toBe(false);
  });

  test("someone unknown is reported as not found", async () => {
    const { t } = await setUp();
    expect(await t.action(internal.blocks.blockUser, { email: "nobody@example.test" })).toBeNull();
  });

  test("a blocked person can't sign in again", async () => {
    const { t, maya } = await setUp("self-hosted");
    await t.mutation(internal.blocks.put, { kind: "user", targetId: maya.id });
    const { createAuthOptions } = await import("./auth");
    const options = createAuthOptions({
      runQuery: (_ref: unknown, args: { userId: string }) =>
        t.query(internal.access.userBlocked, args),
      runMutation: vi.fn(),
      runAction: vi.fn(),
      scheduler: { runAfter: vi.fn() },
    } as never);
    const before = options.databaseHooks.session.create.before;
    await expect(before({ userId: maya.id } as never)).rejects.toThrow(/paused/);
    await expect(before({ userId: "someone-else" } as never)).resolves.toBeUndefined();
  });
});

describe("a trial that is over", () => {
  test("refuses agent replies in Slack and Discord too", async () => {
    const { t, team, maya } = await setUp();
    await t.run((ctx) =>
      ctx.db.insert("teamTrials", { organizationId: team, startedAt: 0, endsAt: 1 }),
    );
    expect(
      await t.mutation(internal.access.channelTurn, { organizationId: team, userId: maya.id }),
    ).toEqual({ ok: false, reason: "trial_ended", message: TRIAL_ENDED_MESSAGE });
  });
});

describe("limits a real person never meets", () => {
  test("agent replies: a burst of 15 per person, then a wait with when to try again", async () => {
    const { t, team, maya } = await setUp();
    for (let i = 0; i < 15; i++) {
      expect(await maya.as.mutation(api.access.agentTurn, { organizationId: team })).toEqual({
        ok: true,
      });
    }
    const over = await maya.as.mutation(api.access.agentTurn, { organizationId: team });
    expect(over).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(over.ok === false && over.message).toMatch(/Try again in about \d+ minutes?/);
    // Someone else on the team still gets answers.
    const lee = await addPerson(t, "Lee Park", [team]);
    expect(await lee.as.mutation(api.access.agentTurn, { organizationId: team })).toEqual({ ok: true });
  });

  test("sign-ups: five an hour from one network, ten shared by unknown ones", async () => {
    const { t } = await setUp();
    for (let i = 0; i < 5; i++) {
      expect(await t.mutation(internal.access.takeSignUp, { networkKey: "net_home" })).toBeNull();
    }
    expect(await t.mutation(internal.access.takeSignUp, { networkKey: "net_home" })).toMatch(
      /Too many accounts/,
    );
    expect(await t.mutation(internal.access.takeSignUp, { networkKey: "net_other" })).toBeNull();
    for (let i = 0; i < 10; i++) {
      expect(await t.mutation(internal.access.takeSignUp, { networkKey: UNKNOWN_NETWORK })).toBeNull();
    }
    expect(await t.mutation(internal.access.takeSignUp, { networkKey: UNKNOWN_NETWORK })).toMatch(
      /Too many accounts/,
    );
  });

  test("sign-ups and new teams are not limited on a self-hosted copy", async () => {
    const { t } = await setUp("self-hosted");
    for (let i = 0; i < 8; i++) {
      expect(await t.mutation(internal.access.takeSignUp, { networkKey: "net_home" })).toBeNull();
      expect(await t.mutation(internal.access.takeNewTeam, { userId: "u1" })).toBeNull();
    }
  });

  test("new teams: three a day per person", async () => {
    const { t } = await setUp();
    for (let i = 0; i < 3; i++) {
      expect(await t.mutation(internal.access.takeNewTeam, { userId: "u1" })).toBeNull();
    }
    expect(await t.mutation(internal.access.takeNewTeam, { userId: "u1" })).toMatch(
      /several teams today/,
    );
    expect(await t.mutation(internal.access.takeNewTeam, { userId: "u2" })).toBeNull();
  });

  test("MCP: a burst of 60 calls per key, then a wait", async () => {
    const { t, team, maya } = await setUp();
    for (let i = 0; i < 60; i++) {
      expect(
        await t.mutation(internal.access.mcpCall, { organizationId: team, userId: maya.id }),
      ).toEqual({ ok: true });
    }
    expect(
      await t.mutation(internal.access.mcpCall, { organizationId: team, userId: maya.id }),
    ).toMatchObject({ ok: false, reason: "rate_limited" });
  });

  test("waits read in plain words", () => {
    expect(waitLabel(10_000)).toBe("in about 1 minute");
    expect(waitLabel(5 * 60_000)).toBe("in about 5 minutes");
    expect(waitLabel(60 * 60_000)).toBe("in about an hour");
    expect(waitLabel(3 * 60 * 60_000)).toBe("in about 3 hours");
  });
});

describe("signing up on the hosted edition", () => {
  function hooks(runMutation: (ref: unknown, args: unknown) => unknown) {
    return import("./auth").then(({ createAuthOptions }) =>
      createAuthOptions({
        runQuery: vi.fn(),
        runMutation,
        runAction: vi.fn(),
        scheduler: { runAfter: vi.fn() },
      } as never),
    );
  }

  test("a throwaway email service is refused before anything else", async () => {
    process.env.NCAT_EDITION = "hosted";
    const runMutation = vi.fn();
    const options = await hooks(runMutation);
    await expect(
      options.databaseHooks.user.create.before({ email: "x@mailinator.com" } as never, null),
    ).rejects.toThrow(/Throwaway email/);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("a burst of sign-ups is refused with when to try again", async () => {
    process.env.NCAT_EDITION = "hosted";
    const options = await hooks(async () => "Too many accounts have been made from here.");
    await expect(
      options.databaseHooks.user.create.before({ email: "maya@studio.example" } as never, null),
    ).rejects.toThrow(/Too many accounts/);
  });

  test("nothing is checked on a self-hosted copy", async () => {
    process.env.NCAT_EDITION = "self-hosted";
    const runMutation = vi.fn();
    const options = await hooks(runMutation);
    await options.databaseHooks.user.create.before({ email: "x@mailinator.com" } as never, null);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("email confirmation is on by itself once the hosted edition can send email", async () => {
    const { requireEmailVerification } = await import("./lib/signInOptions");
    process.env.NCAT_EDITION = "hosted";
    expect(requireEmailVerification({})).toBe(false);
    expect(requireEmailVerification({ TOSEND_API_KEY: "k", EMAIL_FROM: "a@b.example" })).toBe(true);
    expect(
      requireEmailVerification({
        TOSEND_API_KEY: "k",
        EMAIL_FROM: "a@b.example",
        REQUIRE_EMAIL_VERIFICATION: "false",
      }),
    ).toBe(false);
    process.env.NCAT_EDITION = "self-hosted";
    expect(requireEmailVerification({ TOSEND_API_KEY: "k", EMAIL_FROM: "a@b.example" })).toBe(false);
    expect(requireEmailVerification({ REQUIRE_EMAIL_VERIFICATION: "true" })).toBe(true);
  });
});

describe("the agent's own schedules", () => {
  async function agentToken(secret: string) {
    const { createHmac } = await import("node:crypto");
    const b64 = (value: string) => Buffer.from(value).toString("base64url");
    const iat = Math.floor(Date.now() / 1000);
    const body = `${b64(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64(
      JSON.stringify({ sub: "agent-server", aud: "ncat-dashboard", iat, exp: iat + 300 }),
    )}`;
    return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
  }

  test("a fire is refused once the trial is over or the team is blocked, and only the agent server may ask", async () => {
    const { t, team, maya } = await setUp();
    process.env.MASTRA_JWT_SECRET = "the-agent-shared-secret-of-at-least-32-chars";
    try {
      const ask = async (token: string | null) =>
        await t.fetch("/agent/scheduled-turn", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ organizationId: team, userId: maya.id }),
        });
      expect((await ask(null)).status).toBe(401);
      const token = await agentToken(process.env.MASTRA_JWT_SECRET);
      expect(await (await ask(token)).json()).toEqual({ ok: true });

      await t.mutation(internal.blocks.blockTeam, { organizationId: team });
      expect(await (await ask(token)).json()).toMatchObject({ ok: false, reason: "team_blocked" });
      await t.mutation(internal.blocks.unblockTeam, { organizationId: team });

      await t.run((ctx) =>
        ctx.db.insert("teamTrials", { organizationId: team, startedAt: 0, endsAt: 1 }),
      );
      expect(await (await ask(token)).json()).toMatchObject({ ok: false, reason: "trial_ended" });
    } finally {
      delete process.env.MASTRA_JWT_SECRET;
    }
  });

  test("fires come out of the team's allowance", async () => {
    const { t, team } = await setUp();
    let last: { ok: boolean } = { ok: true };
    for (let i = 0; i < 41; i++) {
      last = await t.mutation(internal.access.scheduledTurn, { organizationId: team });
    }
    expect(last).toMatchObject({ ok: false, reason: "rate_limited" });
  });
});
