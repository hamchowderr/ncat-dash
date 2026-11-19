import { APPS } from "@convex/lib/mcpContent";
import { afterEach, describe, expect, it, vi } from "vitest";

// The run page an agent's chat shows (MCP Apps), run as it is: its script talks to the
// chat over postMessage, so the test plays the chat.

type Sent = { jsonrpc: string; id?: number; method?: string; params?: Record<string, unknown> };

function openPage() {
  const html = APPS[0].text;
  document.body.innerHTML = /<body>([\s\S]*)<script>/.exec(html)![1];
  const sent: Sent[] = [];
  vi.spyOn(window.parent, "postMessage").mockImplementation((message: unknown) => {
    sent.push(message as Sent);
  });
  const script = /<script>([\s\S]*)<\/script>/.exec(html)![1];
  new Function(script)();
  const chat = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data }));
  return { sent, chat };
}

const steps = () => [...document.querySelectorAll("#steps li")].map((li) => li.textContent);

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("run page", () => {
  it("says hello to the chat, then shows the run it is handed", async () => {
    const { sent, chat } = openPage();
    expect(sent[0]).toMatchObject({
      method: "ui/initialize",
      params: { protocolVersion: "2026-01-26" },
    });
    chat({ jsonrpc: "2.0", id: sent[0].id, result: {} });
    await Promise.resolve();
    await Promise.resolve();
    expect(sent.some((m) => m.method === "ui/notifications/initialized")).toBe(true);

    const run = {
      run_id: "r1",
      automation: "Podcast captions",
      status: "failed",
      steps: [
        { step: "Trim video", status: "done", files: 1 },
        { step: "Add captions", status: "failed", error: "The toolkit could not read the file." },
      ],
      files: [],
    };
    chat({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: { structuredContent: run },
    });
    expect(document.getElementById("title")!.textContent).toBe("Podcast captions");
    expect(document.getElementById("status")!.textContent).toBe("Failed");
    expect(steps()).toEqual([
      "Trim video1 file",
      "Add captionsThe toolkit could not read the file.Failed",
    ]);
    expect(sent.at(-1)).toMatchObject({ method: "ui/notifications/size-changed" });
  });

  it("shows the run starting, then asks check_run until it ends", async () => {
    vi.useFakeTimers();
    const { sent, chat } = openPage();
    chat({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: { structuredContent: { run_id: "r2", automation: "Clips", status: "running" } },
    });
    expect(steps()).toEqual(["Starting the first step"]);

    await vi.advanceTimersByTimeAsync(1500);
    const asked = sent.find((m) => m.params?.name === "check_run")!;
    expect(asked).toMatchObject({ method: "tools/call", params: { arguments: { run_id: "r2" } } });

    chat({
      jsonrpc: "2.0",
      id: asked.id,
      result: {
        structuredContent: {
          run_id: "r2",
          automation: "Clips",
          status: "done",
          steps: [{ step: "Clips for a platform", status: "done", files: 3 }],
          files: ["a", "b", "c"],
        },
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(document.getElementById("status")!.textContent).toBe("Done");
    expect(document.getElementById("files")!.textContent).toBe("3 finished files");

    const calls = sent.filter((m) => m.params?.name === "check_run").length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent.filter((m) => m.params?.name === "check_run").length).toBe(calls);
  });
});
