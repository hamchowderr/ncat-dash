import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { SECURITY_HEADERS } from "./security-headers";

const header = (key: string) => SECURITY_HEADERS.find((each) => each.key === key)?.value;

describe("security headers", () => {
  it("every page and route sends them", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([{ source: "/:path*", headers: SECURITY_HEADERS }]);
  });

  it("no other site can frame the dashboard", () => {
    expect(header("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(header("X-Frame-Options")).toBe("DENY");
  });

  it("share links in the address never reach other sites", () => {
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("the microphone still works for speaking to the agent", () => {
    expect(header("Permissions-Policy")).toContain("microphone=(self)");
  });
});
