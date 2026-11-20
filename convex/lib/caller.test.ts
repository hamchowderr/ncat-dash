import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import { components } from "../_generated/api";
import { addPerson, addTeam, backend } from "../test.setup";
import { getCaller } from "./caller";

const convexDir = join(__dirname, "..");

/** Modules that really need Better Auth itself: sign-in, its HTTP routes, and the bots that call its API. */
const MAY_IMPORT_AUTH = new Set([
  "auth.ts",
  "http.ts",
  "slack.ts",
  "discord.ts",
  "microsoftTeamsChat.ts",
  "blocks.ts",
  "betterAuth/auth.ts",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "_generated" || name === "node_modules") return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("getCaller", () => {
  test("ordinary modules do not import Better Auth, so each call stays fast", () => {
    const offenders = sourceFiles(convexDir)
      .map((path) => relative(convexDir, path).replaceAll("\\", "/"))
      .filter((path) => !MAY_IMPORT_AUTH.has(path))
      .filter((path) =>
        /from\s+["'](\.\.?\/)+auth["']/.test(readFileSync(join(convexDir, path), "utf8")),
      );
    expect(offenders).toEqual([]);
  });

  test("returns the signed-in person", async () => {
    const t = backend();
    const team = await addTeam(t, "North");
    const person = await addPerson(t, "Ada", [team], "owner");
    const caller = await person.as.run((ctx) => getCaller(ctx));
    expect(caller?._id).toBe(person.id);
  });

  test("returns nothing when nobody is signed in", async () => {
    const t = backend();
    expect(await t.run(async (ctx) => (await getCaller(ctx)) ?? null)).toBeNull();
  });

  test("returns nothing once the session has expired", async () => {
    const t = backend();
    const team = await addTeam(t, "North");
    const person = await addPerson(t, "Ada", [team], "owner");
    await t.run(async (ctx) => {
      await ctx.runMutation(components.betterAuth.adapter.updateMany, {
        input: {
          model: "session",
          where: [{ field: "userId", value: person.id }],
          update: { expiresAt: Date.now() - 1000 },
        },
        paginationOpts: { numItems: 10, cursor: null },
      });
    });
    expect(await person.as.run(async (ctx) => (await getCaller(ctx)) ?? null)).toBeNull();
  });

  test("returns nothing when the session belongs to someone else", async () => {
    const t = backend();
    const team = await addTeam(t, "North");
    const ada = await addPerson(t, "Ada", [team], "owner");
    const bob = await addPerson(t, "Bob", [team], "member");
    const sessionId = await t.run(async (ctx) => {
      const session = await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "session",
        where: [{ field: "userId", value: bob.id }],
      });
      return (session as { _id: string })._id;
    });
    const mixed = t.withIdentity({ subject: ada.id, sessionId });
    expect(await mixed.run(async (ctx) => (await getCaller(ctx)) ?? null)).toBeNull();
  });
});
