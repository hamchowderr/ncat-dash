import { afterEach, describe, expect, test, vi } from "vitest";

import {
  forwardSlack,
  isAlertAction,
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

describe("alert buttons pressed in Slack", () => {
  const press = (actionId: string) =>
    new URLSearchParams({
      payload: JSON.stringify({
        type: "block_actions",
        team: { id: "T1" },
        user: { id: "U1" },
        actions: [{ action_id: actionId, value: "alert1" }],
      }),
    }).toString();

  test("knows our Approve and Send back presses from the agent's own buttons", () => {
    expect(isAlertAction(press("ncat_alert_approve"))).toBe(true);
    expect(isAlertAction(press("ncat_alert_send_back"))).toBe(true);
    expect(isAlertAction(press("tool_approve:call_1"))).toBe(false);
    expect(isAlertAction('{"type":"event_callback"}')).toBe(false);
    expect(isAlertAction("payload=not-json")).toBe(false);
  });

  test("go to the dashboard's backend only, with Slack's signature", async () => {
    const seen: { url: string; headers: Headers; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({ url, headers: new Headers(init.headers), body: String(init.body) });
      return new Response(null, { status: 200 });
    });
    const body = press("ncat_alert_approve");
    const handedOn: Promise<unknown>[] = [];
    const answer = await forwardSlack(
      new Request("https://dash.test/api/slack/events", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-slack-signature": "v0=abc",
          "x-slack-request-timestamp": "1700000000",
        },
        body,
      }),
      "http://agent.test",
      "https://convex.test/",
      (work) => handedOn.push(work),
    );
    expect(answer.status).toBe(200);
    await Promise.all(handedOn);
    expect(seen.map((one) => one.url)).toEqual(["https://convex.test/slack/actions"]);
    expect(seen[0].body).toBe(body);
    expect(seen[0].headers.get("x-slack-signature")).toBe("v0=abc");
  });

  test("Slack hears back at once, even while the backend is slow to answer", async () => {
    let answerBackend: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => (answerBackend = resolve)));
    const handedOn: Promise<unknown>[] = [];
    const answer = await forwardSlack(
      new Request("https://dash.test/api/slack/events", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: press("ncat_alert_send_back"),
      }),
      "http://agent.test",
      "https://convex.test",
      (work) => handedOn.push(work),
    );
    expect(answer.status).toBe(200);
    expect(handedOn).toHaveLength(1);
    answerBackend(new Response(null, { status: 500 }));
    await expect(handedOn[0]).resolves.toBeDefined();
  });

  test("the agent's own buttons still go to the agent server", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return new Response("", { status: 200 });
    });
    await forwardSlack(
      new Request("https://dash.test/api/slack/events", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: press("tool_approve:call_1"),
      }),
      "http://agent.test",
      "https://convex.test",
    );
    expect(urls).toEqual([`http://agent.test${SLACK_WEBHOOK_PATH}`]);
  });
});
