import { afterEach, describe, expect, test, vi } from "vitest";

import { GET as authorizationServer } from "@/app/.well-known/oauth-authorization-server/api/auth/route";
import { GET as openIdConfiguration } from "@/app/.well-known/openid-configuration/api/auth/route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the sign-in server's metadata at the issuer's well-known addresses", () => {
  test("passes on the documents the backend serves", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://backend.example/");
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        asked.push(url);
        return Response.json({ issuer: "https://app.example/api/auth" });
      }),
    );
    for (const answer of [await authorizationServer(), await openIdConfiguration()]) {
      expect(answer.status).toBe(200);
      expect(answer.headers.get("access-control-allow-origin")).toBe("*");
      expect(await answer.json()).toEqual({ issuer: "https://app.example/api/auth" });
    }
    expect(asked).toEqual([
      "https://backend.example/.well-known/oauth-authorization-server",
      "https://backend.example/api/auth/.well-known/openid-configuration",
    ]);
  });
});
