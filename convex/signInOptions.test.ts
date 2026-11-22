import { afterEach, describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import { requireEmailVerification, socialProviders } from "./lib/signInOptions";
import { backend } from "./test.setup";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("signing in with Google", () => {
  test("is offered only once both keys are set", () => {
    expect(socialProviders({})).toEqual({});
    expect(socialProviders({ GOOGLE_CLIENT_ID: "id" })).toEqual({});
    expect(socialProviders({ GOOGLE_CLIENT_ID: " id ", GOOGLE_CLIENT_SECRET: "secret" })).toEqual({
      google: { clientId: "id", clientSecret: "secret", prompt: "select_account" },
    });
  });
});

describe("confirming an email address", () => {
  test("is asked for when the owner says so, and never without a way to send email", () => {
    expect(requireEmailVerification({ REQUIRE_EMAIL_VERIFICATION: "true" })).toBe(true);
    expect(requireEmailVerification({ REQUIRE_EMAIL_VERIFICATION: "false" })).toBe(false);
    expect(requireEmailVerification({})).toBe(false);
  });
});

describe("what the sign-in screens are told", () => {
  test("say whether Google, password resets and confirming an address are on", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.TOSEND_API_KEY;
    delete process.env.EMAIL_FROM;
    const t = backend();
    expect(await t.query(api.settings.get, {})).toMatchObject({
      signInWith: { google: false },
      emailConfigured: false,
      emailVerification: false,
    });

    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.TOSEND_API_KEY = "key";
    process.env.EMAIL_FROM = "hello@example.test";
    process.env.REQUIRE_EMAIL_VERIFICATION = "true";
    expect(await t.query(api.settings.get, {})).toMatchObject({
      signInWith: { google: true },
      emailConfigured: true,
      emailVerification: true,
    });
  });
});
