import { afterEach, describe, expect, test, vi } from "vitest";
import { isPrivateHost, outboundProblem, privateAddressesBlocked } from "./lib/outbound";

/**
 * Addresses a team types that the backend calls itself (lib/outbound.ts). On a copy
 * strangers sign up to, nothing inside the server's own network may be reached; a copy
 * whose people all belong to its owner may send to its own n8n.
 */

afterEach(() => vi.unstubAllEnvs());

describe("private addresses", () => {
  test.each([
    "localhost",
    "127.0.0.1",
    "10.0.0.5",
    "172.17.0.1",
    "192.168.1.20",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "[::1]",
    "[fd00::1]",
    "[::ffff:127.0.0.1]",
    "convex",
    "coolify",
    "n8n",
    "toolkit.internal",
    "router.lan",
    "printer.local",
    "10.0.0.1.nip.io",
    "app-127-0-0-1.sslip.io",
  ])("%s is private", (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  test.each([
    "n8n.example.com",
    "8.8.8.8",
    "191.101.15.236",
    "takewon-api.191.101.15.236.sslip.io",
    "[2606:4700::1]",
  ])("%s is public", (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });

  test("WHATWG URLs turn other ways of writing an address into the usual one", () => {
    // 2130706433 and 0x7f000001 are 127.0.0.1.
    expect(isPrivateHost(new URL("http://2130706433/").hostname)).toBe(true);
    expect(isPrivateHost(new URL("http://0x7f000001/").hostname)).toBe(true);
  });
});

describe("when private addresses are refused", () => {
  test("on a self-hosted copy that lends no toolkit, they are allowed", () => {
    vi.stubEnv("NCAT_EDITION", "");
    vi.stubEnv("HOSTED_TOOLKIT_URL", "");
    vi.stubEnv("OUTBOUND_PRIVATE", "");
    expect(privateAddressesBlocked()).toBe(false);
    expect(outboundProblem("http://n8n:5678/webhook/x")).toBeNull();
  });

  test("on the hosted edition, and on a copy that lends its toolkit, they are refused", () => {
    vi.stubEnv("NCAT_EDITION", "hosted");
    expect(outboundProblem("http://n8n:5678/webhook/x")).toMatch(/private network/);
    vi.stubEnv("NCAT_EDITION", "");
    vi.stubEnv("HOSTED_TOOLKIT_URL", "https://toolkit.example.com");
    expect(outboundProblem("http://169.254.169.254/latest/meta-data")).toMatch(/private network/);
    expect(outboundProblem("https://hooks.example.com/x")).toBeNull();
  });

  test("OUTBOUND_PRIVATE decides when set", () => {
    vi.stubEnv("NCAT_EDITION", "hosted");
    vi.stubEnv("OUTBOUND_PRIVATE", "allow");
    expect(outboundProblem("http://10.0.0.5/")).toBeNull();
    vi.stubEnv("NCAT_EDITION", "");
    vi.stubEnv("OUTBOUND_PRIVATE", "block");
    expect(outboundProblem("http://10.0.0.5/")).toMatch(/private network/);
  });

  test("the toolkit the owner lends is always allowed", () => {
    vi.stubEnv("OUTBOUND_PRIVATE", "block");
    expect(outboundProblem("http://toolkit:8080", ["http://toolkit:8080"])).toBeNull();
  });

  test("only web addresses, without a name and password", () => {
    expect(outboundProblem("file:///etc/passwd")).toMatch(/http/);
    expect(outboundProblem("https://me:secret@hooks.example.com/")).toMatch(/password/);
    expect(outboundProblem("not an address")).toMatch(/full web address/);
  });
});
