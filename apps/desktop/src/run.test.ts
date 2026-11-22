import { afterEach, describe, expect, test, vi } from "vitest";

import { startConnect } from "./connect";
import { NAME } from "./product";
import { startRun, STEPS, type Check, type RunApi, type StackSaved, type Step } from "./run";

const READY: Check = {
  ready: true,
  items: [
    { id: "cores", status: "ok", title: "8 processor cores", detail: "Enough." },
    { id: "docker", status: "ok", title: "Docker 29.1.0 with Compose 2.40.0", detail: "Running." },
  ],
};
const NO_DOCKER: Check = {
  ready: false,
  items: [
    { id: "cores", status: "warn", title: "2 processor cores", detail: "Slow." },
    { id: "docker", status: "fail", title: "Docker isn't running", detail: "Open Docker Desktop." },
  ],
};
const NOTHING: StackSaved = {
  saved: false,
  addresses: { dashboard: "", api: "", site: "", agent: "", toolkit: "" },
  bucketEndpoint: "",
  bucketName: "",
  hasAdminKey: false,
};

function fakeApi(over: Partial<RunApi> = {}) {
  const ran: Step[] = [];
  const api: RunApi = {
    check: vi.fn(async () => READY),
    saved: vi.fn(async () => NOTHING),
    save: vi.fn(async () => {}),
    step: vi.fn(async (step: Step) => {
      ran.push(step);
    }),
    open: vi.fn(async () => {}),
    ...over,
  };
  return { api, ran };
}

async function render(api: RunApi, back = vi.fn()) {
  const root = document.createElement("main");
  document.body.append(root);
  await startRun(root, api, { back });
  return { root, back };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const $ = <T extends Element>(root: Element, selector: string) => root.querySelector<T>(selector)!;

function fill(root: Element) {
  const values: Record<string, string> = {
    endpoint: "https://acct.r2.cloudflarestorage.com",
    name: "videos",
    accessKey: "access",
    secretKey: "secret",
    modelKey: "sk-ant-key",
    dashboard: "https://app.example.com",
    api: "https://api.example.com",
    site: "https://site.example.com",
    agent: "https://agent.example.com",
    toolkit: "https://toolkit.example.com",
  };
  for (const [name, value] of Object.entries(values)) {
    $<HTMLInputElement>(root, `[name=${name}]`).value = value;
  }
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("running it on this computer", () => {
  test("is offered from the Connect screen", async () => {
    const root = document.createElement("main");
    document.body.append(root);
    const onRun = vi.fn();
    await startConnect(
      root,
      { saved: async () => [], open: async () => {}, forget: async () => [] },
      { reopenLast: false, onRun },
    );
    const offer = $<HTMLElement>(root, ".run-here");
    expect(offer.hidden).toBe(false);
    $<HTMLButtonElement>(root, ".run-here-button").click();
    expect(onRun).toHaveBeenCalled();
  });

  test("says what it needs and never promises it runs without a computer that stays on", async () => {
    const { root } = await render(fakeApi().api);
    expect($(root, "h1").textContent).toBe(`Run ${NAME} on this computer`);
    expect(root.textContent).toContain("only run while this computer is on");
    expect(root.textContent).not.toMatch(/no server required/i);
  });

  test("shows what is missing and holds the settings back until it's fixed", async () => {
    const check = vi.fn(async () => NO_DOCKER);
    const { root } = await render(fakeApi({ check }).api);
    expect($(root, "[data-id=docker]").textContent).toContain("Open Docker Desktop.");
    expect($(root, "[data-id=docker]").className).toContain("fail");
    expect($<HTMLFormElement>(root, ".settings").hidden).toBe(true);

    check.mockResolvedValue(READY);
    $<HTMLButtonElement>(root, ".check-again").click();
    await flush();
    expect($<HTMLFormElement>(root, ".settings").hidden).toBe(false);
  });

  test("asks for each setting it lacks", async () => {
    const { api } = fakeApi();
    const { root } = await render(api);
    fill(root);
    $<HTMLInputElement>(root, "[name=secretKey]").value = " ";
    $<HTMLFormElement>(root, ".settings").requestSubmit();
    await flush();
    expect($(root, ".settings .error").textContent).toBe("Enter the secret key.");
    expect(document.activeElement).toBe($(root, "[name=secretKey]"));
    expect(api.save).not.toHaveBeenCalled();
  });

  test("saves, starts each piece in order, then opens the dashboard", async () => {
    const { api, ran } = fakeApi();
    const { root } = await render(api);
    fill(root);
    $<HTMLFormElement>(root, ".settings").requestSubmit();
    await vi.waitFor(() => expect(api.open).toHaveBeenCalledWith("https://app.example.com"));
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: expect.objectContaining({ name: "videos", region: "" }),
        modelKey: "sk-ant-key",
        addresses: expect.objectContaining({ toolkit: "https://toolkit.example.com" }),
      }),
    );
    expect(ran).toEqual(STEPS.map(({ step }) => step));
    expect([...root.querySelectorAll(".steps li.done")]).toHaveLength(STEPS.length);
  });

  test("a step that fails says why, and trying again goes on", async () => {
    let failing = true;
    const { api, ran } = fakeApi({
      step: vi.fn(async (step: Step) => {
        ran.push(step);
        if (step === "start" && failing) throw "Docker stopped with: port 3000 is already in use";
      }),
    });
    const { root } = await render(api);
    fill(root);
    $<HTMLFormElement>(root, ".settings").requestSubmit();
    await vi.waitFor(() =>
      expect($(root, ".start-error").textContent).toContain("port 3000 is already in use"),
    );
    expect($(root, "[data-step=start]").className).toBe("failed");
    expect(api.open).not.toHaveBeenCalled();

    failing = false;
    $<HTMLButtonElement>(root, ".try-again").click();
    await vi.waitFor(() => expect(api.open).toHaveBeenCalled());
  });

  test("fills in what was saved before, but never the keys", async () => {
    const saved: StackSaved = {
      saved: true,
      addresses: {
        dashboard: "https://app.example.com",
        api: "https://api.example.com",
        site: "https://site.example.com",
        agent: "https://agent.example.com",
        toolkit: "https://toolkit.example.com",
      },
      bucketEndpoint: "https://acct.r2.cloudflarestorage.com",
      bucketName: "videos",
      hasAdminKey: true,
    };
    const { root } = await render(fakeApi({ saved: async () => saved }).api);
    expect($<HTMLInputElement>(root, "[name=name]").value).toBe("videos");
    expect($<HTMLInputElement>(root, "[name=agent]").value).toBe("https://agent.example.com");
    expect($<HTMLInputElement>(root, "[name=secretKey]").value).toBe("");
  });

  test("goes back to Connect", async () => {
    const { root, back } = await render(fakeApi().api);
    $<HTMLButtonElement>(root, ".back").click();
    expect(back).toHaveBeenCalled();
  });
});
