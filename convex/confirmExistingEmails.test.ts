import { describe, expect, test } from "vitest";

import { components, internal } from "./_generated/api";
import { addPerson, addTeam, backend } from "./test.setup";

describe("confirming everyone who already has an account", () => {
  test("marks unconfirmed accounts confirmed, so turning confirmation on locks nobody out", async () => {
    const t = backend();
    const team = await addTeam(t, "North");
    const ada = await addPerson(t, "Ada", [team], "owner");
    await t.run((ctx) =>
      ctx.runMutation(components.betterAuth.adapter.updateMany, {
        input: {
          model: "user",
          where: [{ field: "_id", value: ada.id }],
          update: { emailVerified: false },
        },
        paginationOpts: { numItems: 10, cursor: null },
      }),
    );
    const before = await t.run((ctx) =>
      ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "_id", value: ada.id }],
      }),
    );
    expect(before?.emailVerified).toBe(false);
    let cursor: string | null = null;
    for (;;) {
      const page: { done: boolean; cursor: string | null } = await t.mutation(
        internal.access.confirmExistingEmails,
        { cursor },
      );
      if (page.done) break;
      cursor = page.cursor;
    }
    const user = await t.run((ctx) =>
      ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "_id", value: ada.id }],
      }),
    );
    expect(user?.emailVerified).toBe(true);
  });
});
