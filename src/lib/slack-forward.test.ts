import { afterEach, describe, expect, test, vi } from "vitest";

import { forwardSlack, SLACK_WEBHOOK_PATH } from "./slack-forward";

afterEach(() => vi.unstubAllGlobals());

describe("passing Slack's requests to the agent server", () => {
  test("sends the body and Slack's signature headers as they came, and nothing else", async () => {
    const seen: { url: string; headers: Headers; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({ url, headers: new Headers(init.headers), body: String(init.body) });
      return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
    });
    const body = '{"type":"event_callback","team_id":"T1"}';
    const answer = await forwardSlack(
      new Request("https://dash.test/api/slack/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-slack-signature": "v0=abc",
          "x-slack-request-timestamp": "1700000000",
          cookie: "session=secret",
        },
        body,
      }),
      "http://agent.test",
    );
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ ok: true });
    expect(seen[0].url).toBe(`http://agent.test${SLACK_WEBHOOK_PATH}`);
    expect(seen[0].body).toBe(body);
    expect(seen[0].headers.get("x-slack-signature")).toBe("v0=abc");
    expect(seen[0].headers.get("x-slack-request-timestamp")).toBe("1700000000");
    expect(seen[0].headers.get("cookie")).toBeNull();
  });

  test("passes on a refusal, and says so when the agent server is not there", async () => {
    vi.stubGlobal("fetch", async () => new Response("Bad Slack signature", { status: 401 }));
    const request = () =>
      new Request("https://dash.test/api/slack/events", { method: "POST", body: "{}" });
    expect((await forwardSlack(request(), "http://agent.test")).status).toBe(401);

    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const down = await forwardSlack(request(), "http://agent.test");
    expect(down.status).toBe(503);
    expect(await down.text()).toMatch(/not reachable/);
  });
});
