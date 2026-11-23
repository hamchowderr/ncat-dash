import { describe, expect, it } from "vitest";
import { signIn } from "../src/takewon";

describe("signIn", () => {
  it("signs in from the dashboard's address and swaps the session cookie for a Convex token", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      if (url.endsWith("/sign-in/email")) {
        const headers = new Headers();
        headers.append("Set-Cookie", "better-auth.session_token=abc.def; Path=/; HttpOnly");
        headers.append("Set-Cookie", "better-auth.other=1; Path=/");
        return new Response("{}", { status: 200, headers });
      }
      return Response.json({ token: "jwt-123" });
    }) as typeof globalThis.fetch;
    const token = await signIn({
      siteUrl: "https://site.example/",
      dashboardUrl: "https://takewon.example/home",
      email: "a@b.c",
      password: "pw",
      fetch,
    });
    expect(token).toBe("jwt-123");
    expect(seen[0].url).toBe("https://site.example/api/auth/sign-in/email");
    expect(new Headers(seen[0].init!.headers).get("Origin")).toBe("https://takewon.example");
    expect(JSON.parse(String(seen[0].init!.body))).toEqual({ email: "a@b.c", password: "pw" });
    expect(seen[1].url).toBe("https://site.example/api/auth/convex/token");
    expect(new Headers(seen[1].init!.headers).get("Cookie")).toBe(
      "better-auth.session_token=abc.def; better-auth.other=1",
    );
  });

  it("says when sign-in is refused or no token comes back", async () => {
    const refused = (async () => new Response("Invalid password", { status: 401 })) as typeof fetch;
    await expect(
      signIn({
        siteUrl: "https://s",
        dashboardUrl: "https://d",
        email: "e",
        password: "p",
        fetch: refused,
      }),
    ).rejects.toThrow("Sign-in was refused (401): Invalid password");
    const noToken = (async (url: string) =>
      url.endsWith("/token")
        ? Response.json({}, { status: 401 })
        : new Response("{}")) as typeof fetch;
    await expect(
      signIn({
        siteUrl: "https://s",
        dashboardUrl: "https://d",
        email: "e",
        password: "p",
        fetch: noToken,
      }),
    ).rejects.toThrow("no Convex token came back (401)");
  });
});
