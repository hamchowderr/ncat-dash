import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import { authAttemptKind } from "./auth";
import { UNKNOWN_NETWORK } from "./lib/clientIp";
import { backend } from "./test.setup";

/** Password sign-ins and emails sent on request are limited (access.takeAuthAttempt). */

const signIn = (networkKey: string, email?: string) => ({
  kind: "signIn" as const,
  networkKey,
  ...(email ? { email } : {}),
});

describe("limits on signing in", () => {
  test("cover password sign-ins and the emails anyone can ask for, nothing else", () => {
    expect(authAttemptKind("/sign-in/email")).toBe("signIn");
    expect(authAttemptKind("/request-password-reset")).toBe("email");
    expect(authAttemptKind("/forget-password")).toBe("email");
    expect(authAttemptKind("/send-verification-email")).toBe("email");
    expect(authAttemptKind("/get-session")).toBeNull();
    expect(authAttemptKind("/sign-out")).toBeNull();
    expect(authAttemptKind(undefined)).toBeNull();
  });

  test("one network gets ten quick tries, then waits; another network is unaffected", async () => {
    const t = backend();
    for (let i = 0; i < 10; i++) {
      expect(
        await t.mutation(internal.access.takeAuthAttempt, signIn("net_home", `p${i}@example.test`)),
      ).toBeNull();
    }
    expect(
      await t.mutation(internal.access.takeAuthAttempt, signIn("net_home", "next@example.test")),
    ).toMatch(/Too many sign-in attempts. Try again in about \d+ minutes?/);
    expect(
      await t.mutation(internal.access.takeAuthAttempt, signIn("net_cafe", "next@example.test")),
    ).toBeNull();
  });

  test("one account gets ten quick tries from anywhere, counted however the address is written", async () => {
    const t = backend();
    for (let i = 0; i < 10; i++) {
      const email = i % 2 ? "Jordan.Lee+x@gmail.com" : "jordanlee@gmail.com";
      expect(
        await t.mutation(internal.access.takeAuthAttempt, signIn(`net_${i}`, email)),
      ).toBeNull();
    }
    expect(
      await t.mutation(internal.access.takeAuthAttempt, signIn("net_new", "JORDANLEE@gmail.com")),
    ).toMatch(/Too many sign-in attempts/);
    expect(
      await t.mutation(internal.access.takeAuthAttempt, signIn("net_new", "maya@example.test")),
    ).toBeNull();
  });

  test("calls without the dashboard's signed address share one larger allowance", async () => {
    const t = backend();
    for (let i = 0; i < 20; i++) {
      expect(
        await t.mutation(internal.access.takeAuthAttempt, signIn(UNKNOWN_NETWORK, `u${i}@x.test`)),
      ).toBeNull();
    }
    expect(
      await t.mutation(internal.access.takeAuthAttempt, signIn(UNKNOWN_NETWORK, "u@x.test")),
    ).toMatch(/Too many sign-in attempts/);
  });

  test("an address gets three reset or confirmation emails in a burst, a network five", async () => {
    const t = backend();
    const email = (networkKey: string, to: string) =>
      t.mutation(internal.access.takeAuthAttempt, { kind: "email", networkKey, email: to });
    for (let i = 0; i < 3; i++) expect(await email(`net_${i}`, "maya@example.test")).toBeNull();
    expect(await email("net_9", "maya@example.test")).toMatch(/Too many emails/);

    for (let i = 0; i < 5; i++) expect(await email("net_home", `p${i}@example.test`)).toBeNull();
    expect(await email("net_home", "another@example.test")).toMatch(/Too many emails/);
  });
});

describe("the sign-in route", () => {
  test("turns away an eleventh wrong password in a row with 429", async () => {
    process.env.SITE_URL ??= "http://localhost:3000";
    process.env.BETTER_AUTH_SECRET ??= "a-test-secret-that-is-long-enough-1234";
    const t = backend();
    const attempt = () =>
      t.fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: process.env.SITE_URL! },
        body: JSON.stringify({ email: "maya@example.test", password: "not-the-password" }),
      });
    for (let i = 0; i < 10; i++) expect((await attempt()).status).not.toBe(429);
    const refused = await attempt();
    expect(refused.status).toBe(429);
    expect(await refused.text()).toMatch(/Too many sign-in attempts/);
  });
});

describe("the sign-in cookie", () => {
  test("is HttpOnly, SameSite=Lax and Secure on an https address", async () => {
    process.env.BETTER_AUTH_SECRET ??= "a-test-secret-that-is-long-enough-1234";
    const t = backend();
    process.env.SITE_URL = "https://app.example.test";
    try {
      const answer = await t.fetch("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.example.test" },
        body: JSON.stringify({
          name: "Maya Ortiz",
          email: "maya@example.test",
          password: "a-long-enough-password",
        }),
      });
      const cookie = answer.headers.get("set-cookie") ?? "";
      expect(answer.status).toBe(200);
      expect(cookie).toMatch(/__Secure-better-auth\.session_token=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Secure/);
    } finally {
      process.env.SITE_URL = "http://localhost:3000";
    }
  });
});
