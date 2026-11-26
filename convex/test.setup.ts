/// <reference types="vite/client" />
import presence from "@convex-dev/presence/test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import workpool from "@convex-dev/workpool/test";
import supportTickets from "convex-support-tickets/test";
import { convexTest } from "convex-test";
import { components } from "./_generated/api";
import authSchema from "./betterAuth/schema";
import schema from "./schema";

// Every function file, without tests and other dotted files (foo.test.ts).
const modules = import.meta.glob(["./**/*.*s", "!./**/*.*.*s"]);
const authModules = import.meta.glob(["./betterAuth/**/*.*s", "!./betterAuth/**/*.*.*s"]);

/** A fresh in-memory backend with the auth, presence, rate limiter, support tickets and workpool components. */
export function backend() {
  process.env.SITE_URL = "http://localhost:3000";
  process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret";
  // Every deployment has its own address; jobs sent to a toolkit give it for the webhook.
  process.env.CONVEX_SITE_URL ??= "https://dash.example";
  const t = convexTest(schema, modules);
  t.registerComponent("betterAuth", authSchema, authModules);
  presence.register(t, "presence");
  rateLimiter.register(t, "rateLimiter");
  supportTickets.register(t, "supportTickets");
  for (const name of ["outboundPool", "toolkitPool", "backgroundPool", "chatPool", "recordingPool"])
    workpool.register(t, name);
  return t;
}

type Backend = ReturnType<typeof backend>;

/** Makes a team and returns its id. */
export async function addTeam(t: Backend, name: string): Promise<string> {
  const team = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "organization",
        data: { name, slug: name.toLowerCase().replace(/\W+/g, "-"), createdAt: Date.now() },
      },
    }),
  );
  return team._id as string;
}

/**
 * Makes a signed-in person, on the given teams, and returns their id and a handle
 * that calls functions as them.
 */
export async function addPerson(t: Backend, name: string, teams: string[] = [], role = "member") {
  const now = Date.now();
  const { userId, sessionId } = await t.run(async (ctx) => {
    const create = (model: string, data: Record<string, unknown>) =>
      ctx.runMutation(components.betterAuth.adapter.create, {
        // The adapter's own types list every table's fields; these rows are plain.
        input: { model, data } as never,
      });
    const user = await create("user", {
      name,
      email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    const session = await create("session", {
      userId: user._id,
      token: `token-${user._id}`,
      expiresAt: now + 3_600_000,
      createdAt: now,
      updatedAt: now,
    });
    for (const organizationId of teams) {
      await create("member", { organizationId, userId: user._id, role, createdAt: now });
    }
    return { userId: user._id as string, sessionId: session._id as string };
  });
  return { id: userId, as: t.withIdentity({ subject: userId, sessionId }) };
}
