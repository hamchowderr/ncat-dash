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
  // Each page's listener is taken off after its test, so pages don't hear each other.
  const listen = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation(((type: string, fn: EventListener) => {
    listeners.push(fn);
    listen(type, fn);
  }) as typeof window.addEventListener);
  new Function(script)();
  const chat = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data }));
  return { sent, chat };
}

const steps = () => [...document.querySelectorAll("#steps li")].map((li) => li.textContent);
const files = () => [...document.querySelectorAll("#files .file")].map((span) => span.textContent);

const listeners: EventListener[] = [];

afterEach(() => {
  for (const fn of listeners.splice(0)) window.removeEventListener("message", fn);
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
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
    expect(steps()).toEqual(["Trim video", "Add captionsThe toolkit could not read the file."]);
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
          address: "https://app.takewon.com/automations/a/runs/r2",
          steps: [{ step: "Clips for a platform", status: "done", files: 3 }],
          files: [
            "https://files.example.com/team/clip%201.mp4",
            "https://files.example.com/team/clip-2.mp4?sig=x",
            "https://files.example.com/team/clip-3.mp4",
          ],
        },
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(document.getElementById("status")!.textContent).toBe("Done");
    // Once done, the steps give way to what the run made.
    expect(steps()).toEqual([]);
    expect(files()).toEqual(["clip 1.mp4", "clip-2.mp4", "clip-3.mp4"]);

    const calls = sent.filter((m) => m.params?.name === "check_run").length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent.filter((m) => m.params?.name === "check_run").length).toBe(calls);
  });

  it("opens a finished file and the run through the chat", () => {
    const { sent, chat } = openPage();
    chat({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: {
        structuredContent: {
          run_id: "r3",
          automation: "Clips",
          status: "done",
          address: "https://app.takewon.com/automations/a/runs/r3",
          steps: [],
          files: ["https://files.example.com/team/clip.mp4"],
        },
      },
    });
    (document.querySelector("#files a") as HTMLAnchorElement).click();
    expect(sent.at(-1)).toMatchObject({
      method: "ui/open-link",
      params: { url: "https://files.example.com/team/clip.mp4" },
    });
    const open = document.getElementById("open") as HTMLAnchorElement;
    expect(open.textContent).toBe("Open in Takewon");
    open.click();
    expect(sent.at(-1)).toMatchObject({
      method: "ui/open-link",
      params: { url: "https://app.takewon.com/automations/a/runs/r3" },
    });
  });

  it("asks for a review when the run waits at an approval, and lists only six files", () => {
    const { chat } = openPage();
    chat({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: {
        structuredContent: {
          run_id: "r4",
          automation: "Clips",
          status: "waiting",
          address: "https://app.takewon.com/automations/a/runs/r4",
          steps: [
            { step: "Cut clips", status: "done", files: 8 },
            { step: "Review before posting", status: "waiting_approval", files: 0 },
          ],
          files: Array.from({ length: 8 }, (_, i) => `https://files.example.com/c${i}.mp4`),
        },
      },
    });
    expect(document.getElementById("status")!.textContent).toBe("Waiting for an approval");
    expect(steps()[1]).toBe("Review before postingWaiting for someone to approve it in Takewon");
    expect(document.getElementById("open")!.textContent).toBe("Review in Takewon");
    expect(files()).toHaveLength(6);
    expect(document.querySelector("#files .more")!.textContent).toBe("And 2 more in Takewon");
  });

  it("takes the chat's theme and colours", async () => {
    const { sent, chat } = openPage();
    chat({
      jsonrpc: "2.0",
      id: sent[0].id,
      result: {
        hostContext: {
          theme: "dark",
          styles: { variables: { "--color-text-primary": "#fafafa", "bad key": "red" } },
        },
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    const root = document.documentElement;
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.style.getPropertyValue("--color-text-primary")).toBe("#fafafa");
    expect(root.style.getPropertyValue("bad key")).toBe("");
  });
});
