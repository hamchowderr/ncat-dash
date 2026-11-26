import { afterEach, describe, expect, test } from "vitest";
import { api, components } from "./_generated/api";
import { addPerson, backend } from "./test.setup";

afterEach(() => {
  delete process.env.OPERATOR_EMAILS;
});

describe("operator.me", () => {
  test("is true only for a confirmed address in OPERATOR_EMAILS", async () => {
    const t = backend();
    process.env.OPERATOR_EMAILS = " Owner@Example.test , other@example.test";
    const owner = await addPerson(t, "Owner");
    const customer = await addPerson(t, "Customer");
    expect(await owner.as.query(api.operator.me, {})).toBe(true);
    expect(await customer.as.query(api.operator.me, {})).toBe(false);
    expect(await t.query(api.operator.me, {})).toBe(false);
  });

  test("an unconfirmed sign-up with the operator's address is not the operator", async () => {
    const t = backend();
    process.env.OPERATOR_EMAILS = "owner@example.test";
    const owner = await addPerson(t, "Owner");
    await t.run((ctx) =>
      ctx.runMutation(components.betterAuth.adapter.updateMany, {
        input: {
          model: "user",
          where: [{ field: "_id", value: owner.id }],
          update: { emailVerified: false },
        },
        paginationOpts: { numItems: 10, cursor: null },
      }),
    );
    expect(await owner.as.query(api.operator.me, {})).toBe(false);
  });

  test("nobody is the operator when OPERATOR_EMAILS is unset", async () => {
    const t = backend();
    const owner = await addPerson(t, "Owner");
    expect(await owner.as.query(api.operator.me, {})).toBe(false);
  });
});
