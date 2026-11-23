import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { emptyTranscript } from "./events";
import { reduceAgentControllerEvent } from "./reduce";
import { optimisticUserMessage, useAgentControllerChat } from "./use-agent-controller-chat";

/**
 * A sent message shows at once, as in any chat app, and the server's own copy (echoed a few
 * seconds later when the run starts) takes its place instead of showing it twice.
 */
describe("the message you send", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is replaced in place by the server's copy, never shown twice", () => {
    const local = optimisticUserMessage("List my automations");
    let s = { ...emptyTranscript(), messages: [local] };
    s = reduceAgentControllerEvent(s, {
      type: "message_start",
      message: {
        id: "srv-1",
        role: "user",
        content: [{ type: "text", text: "List my automations" }],
      },
    });
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]).toMatchObject({ id: "srv-1", role: "user" });
    expect(s.messages[0]?.optimistic).toBeUndefined();

    // The reply that follows is added after it, and a later echo of the same id updates it.
    s = reduceAgentControllerEvent(s, {
      type: "message_start",
      message: { id: "a-1", role: "assistant", content: [{ type: "text", text: "You have 2." }] },
    });
    s = reduceAgentControllerEvent(s, {
      type: "message_end",
      message: {
        id: "srv-1",
        role: "user",
        content: [{ type: "text", text: "List my automations" }],
      },
    });
    expect(s.messages.map((m) => m.id)).toEqual(["srv-1", "a-1"]);
  });

  it("an earlier message from the server is never swallowed when nothing is waiting", () => {
    let s = emptyTranscript();
    s = reduceAgentControllerEvent(s, {
      type: "message_start",
      message: { id: "u-1", role: "user", content: [{ type: "text", text: "hi" }] },
    });
    s = reduceAgentControllerEvent(s, {
      type: "message_start",
      message: { id: "u-2", role: "user", content: [{ type: "text", text: "again" }] },
    });
    expect(s.messages.map((m) => m.id)).toEqual(["u-1", "u-2"]);
  });

  it("carries attached files", () => {
    const m = optimisticUserMessage("", [
      { url: "data:image/png;base64,AA", mediaType: "image/png", filename: "a.png" },
    ]);
    expect(m.content).toEqual([
      { type: "file", data: "data:image/png;base64,AA", mediaType: "image/png", filename: "a.png" },
    ]);
  });

  function stubFetch(stream: (url: string) => Response | Promise<Response>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/stream")) return stream(url);
        return Response.json({});
      }),
    );
  }

  it("shows before the server has answered at all", async () => {
    // The server takes its time: the request stays pending.
    stubFetch(() => new Promise<Response>(() => {}));
    const { result } = renderHook(() => useAgentControllerChat());
    act(() => {
      void result.current.sendMessage("Clips from each new recording");
    });
    expect(result.current.transcript.messages).toHaveLength(1);
    expect(result.current.transcript.messages[0]).toMatchObject({
      role: "user",
      optimistic: true,
      content: [{ type: "text", text: "Clips from each new recording" }],
    });
    expect(result.current.status).toBe("streaming");
  });

  it("is taken back when the server refuses it, with the reason shown", async () => {
    stubFetch(() => Response.json({ error: "Your trial has ended." }, { status: 402 }));
    const { result } = renderHook(() => useAgentControllerChat());
    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await result.current.sendMessage("hello");
    });
    expect(accepted).toBe(false);
    expect(result.current.transcript.messages).toHaveLength(0);
    expect(result.current.transcript.error).toBe("Your trial has ended.");
  });

  it("gives way to the server's copy once the turn streams", async () => {
    const frames = [
      { type: "__thread__", threadId: "t-1" },
      {
        type: "message_start",
        message: { id: "srv-1", role: "user", content: [{ type: "text", text: "hello" }] },
      },
      {
        type: "message_start",
        message: { id: "a-1", role: "assistant", content: [{ type: "text", text: "Hi!" }] },
      },
    ];
    const body = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("");
    stubFetch(
      () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const { result } = renderHook(() => useAgentControllerChat());
    await act(async () => {
      await result.current.sendMessage("hello");
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.transcript.messages.map((m) => m.id)).toEqual(["srv-1", "a-1"]);
  });
});
