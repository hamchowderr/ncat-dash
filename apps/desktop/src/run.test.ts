import { afterEach, describe, expect, test, vi } from "vitest";

import { startConnect } from "./connect";
import { NAME } from "./product";
import {
  startRun,
  STEPS,
  type Check,
  type Domain,
  type RunApi,
  type StackSaved,
  type Step,
  whenBackedUp,
} from "./run";

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
  lastBackup: null,
  backupsFolder: "/Users/me/Documents/Backups",
  tunnel: null,
  usesTunnel: false,
};
const DOMAIN: Domain = { id: "zone1", name: "example.com", account: "acct1" };
const MADE = {
  dashboard: "https://studio.example.com",
  api: "https://studio-api.example.com",
  site: "https://studio-actions.example.com",
  agent: "https://studio-agent.example.com",
  toolkit: "https://studio-toolkit.example.com",
};

function fakeApi(over: Partial<RunApi> = {}) {
  const ran: Step[] = [];
  const api: RunApi = {
    check: vi.fn(async () => READY),
    saved: vi.fn(async () => NOTHING),
    save: vi.fn(async () => {}),
    domains: vi.fn(async () => [DOMAIN, { id: "zone2", name: "other.org", account: "acct1" }]),
    tunnel: vi.fn(async () => MADE),
    backUp: vi.fn(async () => "/Users/me/Documents/Backups/2026-11-22 0518"),
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

/** The bucket and keys, and (unless `cloudflare`) addresses of the person's own. */
function fill(root: Element, { cloudflare = false } = {}) {
  if (!cloudflare) choose(root, "own");
  const values: Record<string, string> = {
    endpoint: "https://acct.r2.cloudflarestorage.com",
    name: "videos",
    accessKey: "access",
    secretKey: "secret",
    modelKey: "sk-ant-key",
  };
  if (!cloudflare) Object.assign(values, OWN);
  for (const [name, value] of Object.entries(values)) {
    $<HTMLInputElement>(root, `[name=${name}]`).value = value;
  }
}

function choose(root: Element, way: "own" | "cloudflare") {
  const radio = $<HTMLInputElement>(root, `[name=way][value=${way}]`);
  radio.checked = true;
  radio.dispatchEvent(new Event("change"));
}

const OWN: Record<string, string> = {
  dashboard: "https://app.example.com",
  api: "https://api.example.com",
  site: "https://site.example.com",
  agent: "https://agent.example.com",
  toolkit: "https://toolkit.example.com",
};

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
        tunnel: false,
      }),
    );
    expect(ran).toEqual(STEPS.map(({ step }) => step));
    expect([...root.querySelectorAll(".steps li.done")]).toHaveLength(STEPS.length);
    expect($(root, ".start .awake").textContent).toContain("keeps this computer awake");
    expect($(root, ".start .awake").textContent).toContain("lid closed still sleeps");
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
      hasAdminKey: false,
      lastBackup: null,
      backupsFolder: "",
      tunnel: null,
      usesTunnel: false,
    };
    const { root } = await render(fakeApi({ saved: async () => saved }).api);
    expect($<HTMLInputElement>(root, "[name=way][value=own]").checked).toBe(true);
    expect($<HTMLElement>(root, ".own").hidden).toBe(false);
    expect($<HTMLInputElement>(root, "[name=name]").value).toBe("videos");
    expect($<HTMLInputElement>(root, "[name=agent]").value).toBe("https://agent.example.com");
    expect($<HTMLInputElement>(root, "[name=secretKey]").value).toBe("");
  });

  test("makes the addresses with Cloudflare unless told otherwise", async () => {
    const { root } = await render(fakeApi().api);
    expect($<HTMLInputElement>(root, "[name=way][value=cloudflare]").checked).toBe(true);
    expect($<HTMLElement>(root, ".cloudflare").hidden).toBe(false);
    expect($<HTMLElement>(root, ".own").hidden).toBe(true);
    expect($<HTMLInputElement>(root, "[name=tunnelName]").value).toBe(NAME.toLowerCase());
    const link = $<HTMLAnchorElement>(root, ".cloudflare a");
    expect(link.href).toBe("https://dash.cloudflare.com/profile/api-tokens");
    expect(link.target).toBe("_blank");
    expect(root.textContent).toContain("doesn't keep it");
    expect(root.textContent).toContain("https://<account id>.r2.cloudflarestorage.com");

    choose(root, "own");
    expect($<HTMLElement>(root, ".cloudflare").hidden).toBe(true);
    expect($<HTMLElement>(root, ".own").hidden).toBe(false);
  });

  test("finds the domains, makes the tunnel, then saves and starts with its addresses", async () => {
    const { api, ran } = fakeApi();
    const { root } = await render(api);
    fill(root, { cloudflare: true });
    $<HTMLInputElement>(root, "[name=cfToken]").value = " cf-token ";
    $<HTMLButtonElement>(root, ".find-domains").click();
    await vi.waitFor(() =>
      expect($<HTMLSelectElement>(root, "[name=domain]").disabled).toBe(false),
    );
    expect(api.domains).toHaveBeenCalledWith("cf-token");
    expect([...root.querySelectorAll("[name=domain] option")].map((o) => o.textContent)).toEqual([
      "example.com",
      "other.org",
    ]);
    const name = $<HTMLInputElement>(root, "[name=tunnelName]");
    name.value = "Studio";
    name.dispatchEvent(new Event("input"));
    expect($(root, ".preview").textContent).toContain("studio.example.com for the dashboard");

    $<HTMLFormElement>(root, ".settings").requestSubmit();
    await vi.waitFor(() => expect(api.open).toHaveBeenCalledWith(MADE.dashboard));
    expect(api.tunnel).toHaveBeenCalledWith("cf-token", DOMAIN, "Studio");
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ addresses: MADE, tunnel: true }),
    );
    expect(ran).toEqual(STEPS.map(({ step }) => step));
  });

  test("asks for the token and a domain before making anything", async () => {
    const { api } = fakeApi();
    const { root } = await render(api);
    fill(root, { cloudflare: true });
    $<HTMLFormElement>(root, ".settings").requestSubmit();
    await flush();
    expect($(root, ".settings .error").textContent).toBe("Enter your Cloudflare token.");
    expect(document.activeElement).toBe($(root, "[name=cfToken]"));

    $<HTMLInputElement>(root, "[name=cfToken]").value = "cf-token";
    $<HTMLFormElement>(root, ".settings").requestSubmit();
    await flush();
    expect($(root, ".settings .error").textContent).toBe("Find your domains and pick one.");
    expect(api.tunnel).not.toHaveBeenCalled();
    expect(api.save).not.toHaveBeenCalled();
  });

  test("says what Cloudflare said, and saves nothing when the tunnel can't be made", async () => {
    const { api } = fakeApi({
      tunnel: vi.fn(async () => {
        throw "studio.example.com already points somewhere else. Pick another name.";
      }),
    });
    const { root } = await render(api);
    fill(root, { cloudflare: true });
    $<HTMLInputElement>(root, "[name=cfToken]").value = "cf-token";
    $<HTMLButtonElement>(root, ".find-domains").click();
    await vi.waitFor(() =>
      expect($<HTMLSelectElement>(root, "[name=domain]").disabled).toBe(false),
    );
    $<HTMLFormElement>(root, ".settings").requestSubmit();
    await vi.waitFor(() =>
      expect($(root, ".settings .error").textContent).toContain("already points somewhere else"),
    );
    expect(api.save).not.toHaveBeenCalled();
    expect($<HTMLButtonElement>(root, ".settings button[type=submit]").disabled).toBe(false);
  });

  test("shows why the domains couldn't be found", async () => {
    const { api } = fakeApi({
      domains: vi.fn(async () => {
        throw "Cloudflare didn't allow that with this token.";
      }),
    });
    const { root } = await render(api);
    $<HTMLButtonElement>(root, ".find-domains").click();
    await vi.waitFor(() =>
      expect($(root, ".settings .error").textContent).toContain("didn't allow that"),
    );
  });

  test("starts a tunnel made before again without a new token", async () => {
    const saved: StackSaved = {
      ...NOTHING,
      saved: true,
      addresses: MADE,
      bucketEndpoint: "https://acct.r2.cloudflarestorage.com",
      bucketName: "videos",
      tunnel: { domain: DOMAIN, name: "studio", tunnel: "t1" },
      usesTunnel: true,
    };
    const { api } = fakeApi({ saved: async () => saved });
    const { root } = await render(api);
    expect($<HTMLInputElement>(root, "[name=way][value=cloudflare]").checked).toBe(true);
    expect($<HTMLSelectElement>(root, "[name=domain]").value).toBe("zone1");
    expect($<HTMLInputElement>(root, "[name=tunnelName]").value).toBe("studio");
    expect($<HTMLInputElement>(root, "[name=dashboard]").value).toBe("");
    fill(root, { cloudflare: true });
    $<HTMLFormElement>(root, ".settings").requestSubmit();
    await vi.waitFor(() => expect(api.open).toHaveBeenCalledWith(MADE.dashboard));
    expect(api.tunnel).not.toHaveBeenCalled();
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ addresses: MADE, tunnel: true }),
    );
  });

  test("a copy running here offers opening, updating and backing up, its settings on asking", async () => {
    const saved: StackSaved = {
      ...NOTHING,
      saved: true,
      addresses: MADE,
      hasAdminKey: true,
      lastBackup: "2026-11-21 0300",
      tunnel: { domain: DOMAIN, name: "studio", tunnel: "t1" },
      usesTunnel: true,
    };
    const { api, ran } = fakeApi({ saved: async () => saved });
    const { root } = await render(api);
    expect($<HTMLElement>(root, ".here").hidden).toBe(false);
    expect($<HTMLFormElement>(root, ".settings").hidden).toBe(true);
    const status = $(root, ".here-status").textContent!;
    expect(status).toContain(`runs here at ${MADE.dashboard}`);
    expect(status).toContain("/Users/me/Documents/Backups");
    expect(status).not.toContain("none yet");

    $<HTMLButtonElement>(root, ".open-here").click();
    expect(api.open).toHaveBeenCalledWith(MADE.dashboard);

    $<HTMLButtonElement>(root, ".back-up").click();
    await vi.waitFor(() =>
      expect($(root, ".backup-result").textContent).toBe(
        "Backed up to /Users/me/Documents/Backups/2026-11-22 0518.",
      ),
    );

    $<HTMLButtonElement>(root, ".change").click();
    await vi.waitFor(() => expect($<HTMLFormElement>(root, ".settings").hidden).toBe(false));

    $<HTMLButtonElement>(root, ".update").click();
    await vi.waitFor(() => expect(api.open).toHaveBeenCalledTimes(2));
    expect(api.save).not.toHaveBeenCalled();
    expect(ran).toEqual(STEPS.map(({ step }) => step));
  });

  test("says why a backup failed", async () => {
    const { api } = fakeApi({
      saved: async () => ({ ...NOTHING, saved: true, addresses: MADE, hasAdminKey: true }),
      backUp: vi.fn(async () => {
        throw "The backup stopped with: Docker isn't running";
      }),
    });
    const { root } = await render(api);
    expect($(root, ".here-status").textContent).toContain("Last backup: none yet.");
    $<HTMLButtonElement>(root, ".back-up").click();
    await vi.waitFor(() =>
      expect($(root, ".backup-result").textContent).toContain("Docker isn't running"),
    );
    expect($(root, ".backup-result").className).toContain("error");
  });

  test("shows a backup's time in the person's own time", () => {
    const shown = whenBackedUp("2026-11-22 0518");
    expect(shown).toBe(
      new Date("2026-11-22T05:18:00Z").toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    );
    expect(whenBackedUp("odd")).toBe("odd");
  });

  test("goes back to Connect", async () => {
    const { root, back } = await render(fakeApi().api);
    $<HTMLButtonElement>(root, ".back").click();
    expect(back).toHaveBeenCalled();
  });
});
