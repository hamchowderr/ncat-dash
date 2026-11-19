// @vitest-environment node
import { describe, expect, test } from "vitest";

import { UNKNOWN_NETWORK, networkKey } from "../../convex/lib/clientIp";
import { CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER, clientIpOf, withClientIp } from "./client-ip";

// The dashboard tells Convex where a sign-up came from, signed, so the sign-up limits can
// count per network and a made-up address is worth nothing.
const SECRET = "test-secret";

const from = (headers: Record<string, string>) =>
  new Request("https://dash.example/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email: "maya@example.com" }),
    headers: { "content-type": "application/json", ...headers },
  });

describe("where a sign-up came from", () => {
  test("reads the address the proxy in front saw", () => {
    expect(clientIpOf(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIpOf(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe(
      "203.0.113.9",
    );
    expect(clientIpOf(new Headers())).toBeNull();
  });

  test("Convex trusts an address the dashboard signed, and keeps the body", async () => {
    const passed = withClientIp(from({ "x-real-ip": "203.0.113.9" }), SECRET);
    expect(passed.headers.get(CLIENT_IP_HEADER)).toBe("203.0.113.9");
    expect(await passed.json()).toEqual({ email: "maya@example.com" });
    const key = await networkKey(passed.headers, SECRET);
    expect(key).toMatch(/^net_[0-9a-f]{32}$/);
    // The address itself is never what's kept.
    expect(key).not.toContain("203");
  });

  test("an address the visitor made up is dropped, and an unsigned one is unknown", async () => {
    const forged = from({
      "x-real-ip": "203.0.113.9",
      [CLIENT_IP_HEADER]: "198.51.100.1",
      [CLIENT_IP_SIGNATURE_HEADER]: "made-up",
    });
    const passed = withClientIp(forged, SECRET);
    expect(passed.headers.get(CLIENT_IP_HEADER)).toBe("203.0.113.9");
    expect(await networkKey(forged.headers, SECRET)).toBe(UNKNOWN_NETWORK);
    expect(await networkKey(passed.headers, "another-secret")).toBe(UNKNOWN_NETWORK);
  });

  test("without the shared secret nothing is added", () => {
    const passed = withClientIp(from({ "x-real-ip": "203.0.113.9" }), undefined);
    expect(passed.headers.get(CLIENT_IP_HEADER)).toBeNull();
  });

  test("addresses in one home or office share a network", async () => {
    const key = (ip: string) =>
      networkKey(withClientIp(from({ "x-real-ip": ip }), SECRET).headers, SECRET);
    expect(await key("2001:db8:1:2::10")).toBe(await key("2001:db8:1:2:aaaa::1"));
    expect(await key("2001:db8:1:2::10")).not.toBe(await key("2001:db8:1:3::10"));
    expect(await key("203.0.113.9")).not.toBe(await key("203.0.113.10"));
  });
});
