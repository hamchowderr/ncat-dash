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

  it("sends someone who may not decide to Takewon, and lists only six files", () => {
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
          approval: {
            approval_id: "s1",
            asked: ["Mara Diaz"],
            you_may_decide: false,
            files: ["https://files.example.com/c0.mp4"],
          },
        },
      },
    });
    expect(document.getElementById("status")!.textContent).toBe("Waiting for an approval");
    expect(steps()[1]).toBe("Review before postingWaiting for Mara Diaz to decide");
    // Someone else decides: no buttons for this person.
    expect(document.querySelector("#review button")).toBeNull();
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

  it("approves from the chat, then follows the run on", async () => {
    vi.useFakeTimers();
    const { sent, chat } = openPage();
    chat({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: {
        structuredContent: {
          run_id: "r5",
          automation: "Clips",
          status: "waiting",
          address: "https://app.takewon.com/automations/a/runs/r5",
          steps: [{ step: "Approval", status: "waiting_approval", files: 0 }],
          approval: {
            approval_id: "s5",
            asked: "anyone on the team",
            you_may_decide: true,
            files: ["https://files.example.com/team/clip-1.mp4"],
          },
        },
      },
    });
    expect(steps()).toEqual(["ApprovalWaiting for your decision"]);
    expect(document.querySelector("#review .file")!.textContent).toBe("clip-1.mp4");
    // Deciding replaces the Open in Takewon button.
    expect(document.getElementById("footer")!.hidden).toBe(true);
    const approve = [...document.querySelectorAll("#review button")].find(
      (button) => button.textContent === "Approve",
    ) as HTMLButtonElement;
    approve.click();
    const asked = sent.at(-1)!;
    expect(asked).toMatchObject({
      method: "tools/call",
      params: { name: "decide_approval", arguments: { approval_id: "s5", decision: "approve" } },
    });
    expect(approve.disabled).toBe(true);
    chat({ jsonrpc: "2.0", id: asked.id, result: { structuredContent: { decided: "approved" } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.at(-1)).toMatchObject({
      params: { name: "check_run", arguments: { run_id: "r5" } },
    });
  });

  it("says what went wrong when a decision is refused", async () => {
    const { sent, chat } = openPage();
    chat({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: {
        structuredContent: {
          run_id: "r6",
          automation: "Clips",
          status: "waiting",
          steps: [{ step: "Approval", status: "waiting_approval", files: 0 }],
          approval: { approval_id: "s6", asked: [], you_may_decide: true, files: [] },
        },
      },
    });
    (document.querySelectorAll("#review button")[1] as HTMLButtonElement).click();
    const asked = sent.at(-1)!;
    expect(asked.params).toMatchObject({ arguments: { decision: "send_back" } });
    chat({
      jsonrpc: "2.0",
      id: asked.id,
      result: {
        isError: true,
        content: [{ type: "text", text: "Someone has already decided this." }],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector("#review .said")!.textContent).toBe(
      "Someone has already decided this.",
    );
    expect((document.querySelectorAll("#review button")[0] as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("lists every approval waiting, with buttons only where this person decides", async () => {
    const { sent, chat } = openPage();
    chat({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: {
        structuredContent: {
          approvals: [
            {
              approval_id: "a1",
              automation: "Podcast clips",
              step: "Approval",
              asked: "anyone on the team",
              you_may_decide: true,
              waiting_since: new Date().toISOString(),
              files: ["https://f.example.com/1.mp4", "https://f.example.com/2.mp4"],
              address: "https://app.takewon.com/automations/a/runs/r1",
            },
            {
              approval_id: "a2",
              automation: "Client ads",
              step: "Client review",
              asked: ["Mara Diaz"],
              you_may_decide: false,
              waiting_since: new Date().toISOString(),
              files: [],
              address: "https://app.takewon.com/automations/b/runs/r2",
            },
          ],
        },
      },
    });
    expect(document.getElementById("run")!.hidden).toBe(true);
    const blocks = [...document.querySelectorAll("#list .approval")];
    expect(blocks).toHaveLength(2);
    expect(blocks[0].textContent).toContain("Asks you");
    expect(blocks[1].textContent).toContain("Asks Mara Diaz");
    expect(blocks[1].querySelector("button")).toBeNull();
    expect(blocks[1].querySelector("a.button")!.textContent).toBe("Open in Takewon");

    (blocks[0].querySelector("button") as HTMLButtonElement).click();
    const asked = sent.at(-1)!;
    expect(asked.params).toMatchObject({
      name: "decide_approval",
      arguments: { approval_id: "a1" },
    });
    chat({ jsonrpc: "2.0", id: asked.id, result: { structuredContent: { decided: "approved" } } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(blocks[0].textContent).toContain("Approved");
    expect(blocks[0].querySelector("button")).toBeNull();
  });
});
