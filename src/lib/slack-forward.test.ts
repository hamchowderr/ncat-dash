import { afterEach, describe, expect, test, vi } from "vitest";

import {
  forwardSlack,
  isThreadReply,
  SLACK_WEBHOOK_PATH,
  urlCheckChallenge,
} from "./slack-forward";

afterEach(() => vi.unstubAllGlobals());

describe("passing Slack's requests to the agent server", () => {
  test("answers Slack's address check at once, without waking the agent server", async () => {
    const agent = vi.fn();
    vi.stubGlobal("fetch", agent);
    const answer = await forwardSlack(
      new Request("https://dash.test/api/slack/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "t", type: "url_verification", challenge: "abc123" }),
      }),
      "http://agent.test",
    );
    expect(await answer.json()).toEqual({ challenge: "abc123" });
    expect(agent).not.toHaveBeenCalled();
    expect(urlCheckChallenge('{"type":"event_callback","challenge":"x"}')).toBeNull();
    expect(urlCheckChallenge("not json")).toBeNull();
  });

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

  test("also brings a reply in a thread to the dashboard's backend, for review threads", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push(`${url} ${new Headers(init.headers).get("x-slack-signature")}`);
      return new Response("", { status: 200 });
    });
    const reply = JSON.stringify({
      type: "event_callback",
      team_id: "T1",
      event: { type: "message", user: "U1", text: "On it", ts: "2.0", thread_ts: "1.0" },
    });
    const send = (body: string) =>
      forwardSlack(
        new Request("https://dash.test/api/slack/events", {
          method: "POST",
          headers: { "x-slack-signature": "v0=abc" },
          body,
        }),
        "http://agent.test",
        "http://convex.test/",
      );
    await send(reply);
    expect(seen.sort()).toEqual([
      `http://agent.test${SLACK_WEBHOOK_PATH} v0=abc`,
      "http://convex.test/slack/events v0=abc",
    ]);
    seen.length = 0;
    await send(JSON.stringify({ type: "event_callback", event: { type: "app_mention" } }));
    expect(seen).toEqual([`http://agent.test${SLACK_WEBHOOK_PATH} v0=abc`]);
  });

  test("knows a reply in a thread from everything else", () => {
    const event = (fields: Record<string, unknown>) =>
      JSON.stringify({ type: "event_callback", event: { type: "message", ts: "2.0", ...fields } });
    expect(isThreadReply(event({ thread_ts: "1.0" }))).toBe(true);
    expect(isThreadReply(event({}))).toBe(false);
    expect(isThreadReply(event({ thread_ts: "2.0" }))).toBe(false);
    expect(isThreadReply(event({ thread_ts: "1.0", bot_id: "B1" }))).toBe(false);
    expect(isThreadReply(event({ thread_ts: "1.0", subtype: "message_changed" }))).toBe(false);
    expect(isThreadReply("payload=%7B%7D")).toBe(false);
  });
});
