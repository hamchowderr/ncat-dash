import { describe, expect, test } from "vitest";

import { asBrowserRedirect } from "./auth-redirect";

const AUTHORIZE = "http://localhost:3000/api/auth/oauth2/authorize?client_id=c1";
const NAVIGATE = {
  "sec-fetch-mode": "navigate",
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
};
const answer = (body: unknown, init: ResponseInit = {}) => Response.json(body, init);

describe("auth links opened in a browser", () => {
  test("a browser opening the agent sign-in link is sent to the page, not shown JSON", async () => {
    const response = await asBrowserRedirect(
      new Request(AUTHORIZE, { headers: NAVIGATE }),
      answer(
        { redirect: true, url: "/connect/team?client_id=c1&sig=abc" },
        { headers: { "set-cookie": "a=1; Path=/" } },
      ),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/connect/team?client_id=c1&sig=abc",
    );
    expect(response.headers.get("set-cookie")).toBe("a=1; Path=/");
  });

  test("a redirect back to the agent keeps its own address", async () => {
    const response = await asBrowserRedirect(
      new Request(AUTHORIZE, { headers: NAVIGATE }),
      answer({ redirect: true, url: "https://claude.ai/cb?error=invalid_scope" }),
    );
    expect(response.headers.get("location")).toBe("https://claude.ai/cb?error=invalid_scope");
  });

  test("the screen's own fetches still get the JSON answer", async () => {
    const fetches: Record<string, string>[] = [
      { "sec-fetch-mode": "cors" },
      { accept: "application/json" },
    ];
    for (const headers of fetches) {
      const original = answer({ redirect: true, url: "/connect" });
      const response = await asBrowserRedirect(new Request(AUTHORIZE, { headers }), original);
      expect(response).toBe(original);
    }
  });

  test("other answers pass through untouched", async () => {
    const request = new Request(AUTHORIZE, { headers: NAVIGATE });
    for (const original of [
      answer({ user: { id: "u1" } }),
      answer({ redirect: true, url: "/x" }, { status: 400 }),
      new Response("<p>hi</p>", { headers: { "content-type": "text/html" } }),
      new Response(null, { status: 302, headers: { location: "/connect" } }),
    ]) {
      expect(await asBrowserRedirect(request, original)).toBe(original);
    }
    const post = answer({ redirect: true, url: "/x" });
    expect(await asBrowserRedirect(new Request(AUTHORIZE, { method: "POST" }), post)).toBe(post);
  });
});
