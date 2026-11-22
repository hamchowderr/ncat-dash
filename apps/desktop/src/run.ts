import mark from "./mark.svg?raw";
import { NAME } from "./product";

/** One line of the machine check (machine.rs). */
export type Item = { id: string; status: "ok" | "warn" | "fail"; title: string; detail: string };
export type Check = { items: Item[]; ready: boolean };

/** A domain on the person's Cloudflare account (tunnel.rs). */
export type Domain = { id: string; name: string; account: string };

/** What the app has saved for the stack on this computer, without its secrets. */
export type StackSaved = {
  saved: boolean;
  addresses: Settings["addresses"];
  bucketEndpoint: string;
  bucketName: string;
  hasAdminKey: boolean;
  /** The Cloudflare Tunnel made for it, and whether the stack uses it. */
  tunnel: { domain: Domain; name: string; tunnel: string } | null;
  usesTunnel: boolean;
};

export type Settings = {
  bucket: {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    name: string;
    region: string;
    publicUrl: string;
  };
  modelKey: string;
  addresses: { dashboard: string; api: string; site: string; agent: string; toolkit: string };
  /** Reached through the Cloudflare Tunnel the app made. */
  tunnel: boolean;
};

export type Step = "pull" | "start" | "adminKey" | "setup";

/** What the Run screen asks of the app (stack.rs and machine.rs do the work). */
export type RunApi = {
  check: () => Promise<Check>;
  saved: () => Promise<StackSaved>;
  save: (settings: Settings) => Promise<void>;
  /** The domains a Cloudflare token can give addresses on. */
  domains: (token: string) => Promise<Domain[]>;
  /** Makes the tunnel and the names, and gives back the addresses. */
  tunnel: (token: string, domain: Domain, name: string) => Promise<Settings["addresses"]>;
  step: (step: Step) => Promise<void>;
  /** Opens the dashboard in the window, as Connect does. */
  open: (address: string) => Promise<void>;
};

export const STEPS: { step: Step; label: string }[] = [
  { step: "pull", label: "Download the programs (about 9 GB the first time)" },
  { step: "start", label: "Start them" },
  { step: "adminKey", label: "Make the database's key" },
  { step: "setup", label: "Set up the backend" },
];

const html = String.raw;

function message(error: unknown): string {
  if (typeof error === "string" && error) return error;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again.";
}

/** The name the addresses start with unless the person picks another. */
const DEFAULT_NAME = NAME.toLowerCase().replace(/[^a-z0-9-]/g, "") || "studio";

const TOKEN_PAGE = "https://dash.cloudflare.com/profile/api-tokens";

const MARKS = { ok: "✓", warn: "!", fail: "✕" } as const;

function field(name: string, label: string, hint = "", type = "text") {
  return html`
    <label class="field">
      <span>${label}</span>
      <input name="${name}" type="${type}" spellcheck="false" autocomplete="off" />
      ${hint ? html`<small>${hint}</small>` : ""}
    </label>
  `;
}

/**
 * Runs the whole of the product on this computer with Docker: checks the machine, takes
 * the bucket, the model key and the addresses, then starts everything and opens it.
 */
export async function startRun(
  root: HTMLElement,
  api: RunApi,
  { back }: { back: () => void },
): Promise<void> {
  document.title = NAME;
  root.innerHTML = html`
    <div class="connect run">
      <div class="brand">${mark}<span>${NAME}</span></div>
      <h1>Run ${NAME} on this computer</h1>
      <p class="lead">
        Everything runs here, in Docker. Automations only run while this computer is on and awake,
        so for a team an always-on computer, such as a Mac Mini, or a rented server is the better
        home.
      </p>

      <section class="check" aria-labelledby="check-title">
        <h2 id="check-title">This computer</h2>
        <ul class="items" aria-live="polite"></ul>
        <button type="button" class="secondary check-again">Check again</button>
      </section>

      <form class="settings" novalidate hidden aria-labelledby="settings-title">
        <h2 id="settings-title">Your bucket and keys</h2>
        <p class="hint">
          Videos are kept in your own bucket: Cloudflare R2, AWS S3, Backblaze B2 or any S3-style
          storage. Only this computer holds its keys.
        </p>
        ${field("endpoint", "Bucket endpoint", "For R2: https://&lt;account id&gt;.r2.cloudflarestorage.com")}
        ${field("name", "Bucket name")} ${field("accessKey", "Access key")}
        ${field("secretKey", "Secret key", "", "password")}
        ${field("region", "Region", "Leave empty for R2.")}
        ${field("publicUrl", "Public address (optional)", "Such as an R2 custom domain.")}
        ${field("modelKey", "Anthropic key", "The agent's model. From console.anthropic.com.", "password")}
        <h2>Addresses</h2>
        <p class="hint">
          Teammates, phones and webhooks reach this computer at https addresses on your own domain.
        </p>
        <fieldset class="ways">
          <legend>How they're made</legend>
          <label class="way">
            <input type="radio" name="way" value="cloudflare" checked />
            <span
              ><strong>Make them with Cloudflare</strong><br /><small
                >A free Cloudflare Tunnel. Nothing to open on your router.</small
              ></span
            >
          </label>
          <label class="way">
            <input type="radio" name="way" value="own" />
            <span
              ><strong>I have my own</strong><br /><small
                >A tunnel or reverse proxy you set up yourself.</small
              ></span
            >
          </label>
        </fieldset>
        <div class="cloudflare">
          ${field(
            "cfToken",
            "Cloudflare token",
            html`Make one at
              <a href="${TOKEN_PAGE}" target="_blank" rel="noreferrer">dash.cloudflare.com</a>
              with Zone: Read, DNS: Edit and Cloudflare Tunnel: Edit. ${NAME} uses it once and
              doesn't keep it.`,
            "password",
          )}
          <button type="button" class="secondary find-domains">Find my domains</button>
          <label class="field">
            <span>Domain</span>
            <select name="domain" disabled>
              <option value="">Find your domains first</option>
            </select>
          </label>
          ${field("tunnelName", "Name", "The first part of every address.")}
          <p class="hint preview" aria-live="polite"></p>
        </div>
        <div class="own" hidden>
          ${field("dashboard", "Dashboard", "Such as https://app.example.com, to port 3000")}
          ${field("api", "Convex API", "To port 3210")}
          ${field("site", "Convex HTTP actions", "To port 3211")}
          ${field("agent", "Agent server", "To port 4111")}
          ${field("toolkit", "Toolkit", "To port 8080")}
        </div>
        <p class="error" role="alert" hidden></p>
        <button type="submit" class="primary">Save and start</button>
      </form>

      <section class="start" hidden aria-labelledby="start-title">
        <h2 id="start-title">Starting ${NAME}</h2>
        <ol class="steps"></ol>
        <p class="hint awake">
          From now on ${NAME} keeps this computer awake and opens when you sign in, so automations
          keep running. Turn either off from its icon in the menu bar or taskbar. A laptop with its
          lid closed still sleeps.
        </p>
        <p class="error start-error" role="alert" hidden></p>
        <button type="button" class="primary try-again" hidden>Try again</button>
      </section>

      <button type="button" class="link back">Back</button>
    </div>
  `;

  const items = root.querySelector<HTMLElement>(".items")!;
  const checkAgain = root.querySelector<HTMLButtonElement>(".check-again")!;
  const form = root.querySelector<HTMLFormElement>(".settings")!;
  const formError = form.querySelector<HTMLElement>(".error")!;
  const save = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  const start = root.querySelector<HTMLElement>(".start")!;
  const steps = root.querySelector<HTMLElement>(".steps")!;
  const startError = root.querySelector<HTMLElement>(".start-error")!;
  const tryAgain = root.querySelector<HTMLButtonElement>(".try-again")!;
  root.querySelector<HTMLButtonElement>(".back")!.addEventListener("click", back);

  const input = (name: string) => form.querySelector<HTMLInputElement>(`[name=${name}]`)!;
  const cloudflare = form.querySelector<HTMLElement>(".cloudflare")!;
  const own = form.querySelector<HTMLElement>(".own")!;
  const findDomains = form.querySelector<HTMLButtonElement>(".find-domains")!;
  const domainSelect = form.querySelector<HTMLSelectElement>("[name=domain]")!;
  const preview = form.querySelector<HTMLElement>(".preview")!;
  let domains: Domain[] = [];
  let saved: StackSaved | null = null;
  let dashboard = "";

  const way = () =>
    form.querySelector<HTMLInputElement>("[name=way]:checked")?.value === "own"
      ? "own"
      : "cloudflare";
  function showWay() {
    cloudflare.hidden = way() !== "cloudflare";
    own.hidden = way() !== "own";
  }
  const chosenDomain = () => domains.find((domain) => domain.id === domainSelect.value);
  function showPreview() {
    const name = input("tunnelName").value.trim().toLowerCase();
    const domain = chosenDomain();
    preview.textContent =
      name && domain
        ? `${name}.${domain.name} for the dashboard, and ${name}-api, ${name}-actions, ${name}-agent and ${name}-toolkit for the rest.`
        : "";
  }
  function listDomains(list: Domain[], pick?: string) {
    domains = list;
    domainSelect.replaceChildren(
      ...list.map((domain) =>
        Object.assign(document.createElement("option"), {
          value: domain.id,
          textContent: domain.name,
        }),
      ),
    );
    domainSelect.disabled = false;
    if (pick) domainSelect.value = pick;
    showPreview();
  }
  const showError = (where: HTMLElement, text: string | null) => {
    where.textContent = text ?? "";
    where.hidden = !text;
  };

  async function check() {
    checkAgain.disabled = true;
    items.replaceChildren(Object.assign(document.createElement("li"), { textContent: "Looking…" }));
    try {
      const result = await api.check();
      items.replaceChildren(
        ...result.items.map((item) => {
          const row = document.createElement("li");
          row.className = `item ${item.status}`;
          row.dataset.id = item.id;
          row.innerHTML = html`<span class="mark" aria-hidden="true">${MARKS[item.status]}</span>
            <span><strong></strong><br /><span class="detail"></span></span>`;
          row.querySelector("strong")!.textContent = item.title;
          row.querySelector(".detail")!.textContent = item.detail;
          return row;
        }),
      );
      form.hidden = !result.ready;
    } catch (problem) {
      items.replaceChildren(
        Object.assign(document.createElement("li"), {
          className: "item fail",
          textContent: message(problem),
        }),
      );
      form.hidden = true;
    } finally {
      checkAgain.disabled = false;
    }
  }

  function settings(): Settings {
    const value = (name: string) => input(name).value.trim();
    return {
      bucket: {
        endpoint: value("endpoint"),
        accessKey: value("accessKey"),
        secretKey: value("secretKey"),
        name: value("name"),
        region: value("region"),
        publicUrl: value("publicUrl"),
      },
      modelKey: value("modelKey"),
      addresses: {
        dashboard: value("dashboard"),
        api: value("api"),
        site: value("site"),
        agent: value("agent"),
        toolkit: value("toolkit"),
      },
      tunnel: way() === "cloudflare",
    };
  }

  /** The addresses for the way chosen, making the tunnel when it's needed. */
  async function addresses(typed: Settings): Promise<Settings["addresses"] | null> {
    if (way() === "own") {
      const missing = (
        [
          ["dashboard", "the dashboard's address"],
          ["api", "the Convex API address"],
          ["site", "the Convex HTTP actions address"],
          ["agent", "the agent server's address"],
          ["toolkit", "the toolkit's address"],
        ] as const
      ).find(([name]) => !input(name).value.trim());
      if (missing) {
        showError(formError, `Enter ${missing[1]}.`);
        input(missing[0]).focus();
        return null;
      }
      return typed.addresses;
    }
    const token = input("cfToken").value.trim();
    const name = input("tunnelName").value.trim();
    const domain = chosenDomain();
    // Made before and unchanged: no token needed to start it again.
    if (
      !token &&
      saved?.usesTunnel &&
      saved.tunnel &&
      domain?.id === saved.tunnel.domain.id &&
      name.toLowerCase() === saved.tunnel.name
    ) {
      return saved.addresses;
    }
    if (!token) {
      showError(formError, "Enter your Cloudflare token.");
      input("cfToken").focus();
      return null;
    }
    if (!domain) {
      showError(formError, "Find your domains and pick one.");
      findDomains.focus();
      return null;
    }
    if (!name) {
      showError(formError, `Enter a name for the addresses, such as ${DEFAULT_NAME}.`);
      input("tunnelName").focus();
      return null;
    }
    save.textContent = "Making the addresses…";
    try {
      return await api.tunnel(token, domain, name);
    } finally {
      save.textContent = "Save and start";
    }
  }

  async function run() {
    start.hidden = false;
    tryAgain.hidden = true;
    showError(startError, null);
    steps.replaceChildren(
      ...STEPS.map(({ step, label }) => {
        const row = document.createElement("li");
        row.dataset.step = step;
        row.textContent = label;
        return row;
      }),
    );
    for (const { step } of STEPS) {
      const row = steps.querySelector<HTMLElement>(`[data-step=${step}]`)!;
      row.className = "doing";
      row.setAttribute("aria-current", "step");
      try {
        await api.step(step);
      } catch (problem) {
        row.className = "failed";
        showError(startError, message(problem));
        tryAgain.hidden = false;
        return;
      }
      row.className = "done";
      row.removeAttribute("aria-current");
    }
    await api.open(dashboard);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError(formError, null);
    const typed = settings();
    const missing = (
      [
        ["endpoint", "the bucket endpoint"],
        ["name", "the bucket name"],
        ["accessKey", "the access key"],
        ["secretKey", "the secret key"],
        ["modelKey", "the Anthropic key"],
      ] as const
    ).find(([name]) => !input(name).value.trim());
    if (missing) {
      showError(formError, `Enter ${missing[1]}.`);
      input(missing[0]).focus();
      return;
    }
    save.disabled = true;
    try {
      const made = await addresses(typed);
      if (!made) {
        save.disabled = false;
        return;
      }
      await api.save({ ...typed, addresses: made });
      dashboard = made.dashboard;
    } catch (problem) {
      showError(formError, message(problem));
      save.disabled = false;
      return;
    }
    form.hidden = true;
    await run();
  });

  findDomains.addEventListener("click", async () => {
    showError(formError, null);
    findDomains.disabled = true;
    try {
      listDomains(await api.domains(input("cfToken").value.trim()));
    } catch (problem) {
      showError(formError, message(problem));
    } finally {
      findDomains.disabled = false;
    }
  });
  domainSelect.addEventListener("change", showPreview);
  input("tunnelName").addEventListener("input", showPreview);
  for (const radio of form.querySelectorAll("[name=way]")) {
    radio.addEventListener("change", showWay);
  }
  tryAgain.addEventListener("click", () => {
    void run();
  });
  checkAgain.addEventListener("click", () => void check());

  try {
    saved = await api.saved();
  } catch {
    saved = null;
  }
  input("tunnelName").value = saved?.tunnel?.name ?? DEFAULT_NAME;
  if (saved?.tunnel) listDomains([saved.tunnel.domain], saved.tunnel.domain.id);
  if (saved?.saved) {
    input("endpoint").value = saved.bucketEndpoint;
    input("name").value = saved.bucketName;
    if (!saved.usesTunnel) {
      for (const [name, value] of Object.entries(saved.addresses)) input(name).value = value;
      form.querySelector<HTMLInputElement>("[name=way][value=own]")!.checked = true;
    }
  }
  showWay();
  await check();
}
