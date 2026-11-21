import mark from "./mark.svg?raw";
import { NAME } from "./product";

/** A dashboard address this computer has opened before (from the app's saved list). */
export type Saved = { address: string; label: string; lastOpened: number };

/** What the Connect screen asks of the app. The app checks and opens; this page only asks. */
export type Api = {
  saved: () => Promise<Saved[]>;
  /** Resolves once the window is on its way to that address; rejects with a sentence for the person. */
  open: (address: string) => Promise<void>;
  forget: (address: string) => Promise<Saved[]>;
};

const html = String.raw;

function message(error: unknown): string {
  if (typeof error === "string" && error) return error;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again.";
}

/**
 * The first screen of the desktop app: pick which dashboard to open. On a normal start it
 * opens the last one straight away; after "Switch …" in the menu it waits for a choice.
 */
export async function startConnect(
  root: HTMLElement,
  api: Api,
  { reopenLast }: { reopenLast: boolean },
): Promise<void> {
  document.title = NAME;
  root.innerHTML = html`
    <div class="connect">
      <div class="brand">${mark}<span>${NAME}</span></div>
      <section class="opening" hidden aria-live="polite">
        <p class="opening-text"></p>
      </section>
      <section class="choose">
        <h1>Connect to your ${NAME}</h1>
        <p class="lead">
          Enter the address you sign in to ${NAME} at. It can be our hosted ${NAME} or one on your
          own server.
        </p>
        <form class="address-form" novalidate>
          <label for="address" class="sr-only">${NAME} address</label>
          <input
            id="address"
            name="address"
            type="text"
            inputmode="url"
            autocomplete="url"
            spellcheck="false"
            placeholder="app.example.com"
            required
          />
          <button type="submit">Connect</button>
        </form>
        <p class="error" role="alert" hidden></p>
        <div class="recent" hidden>
          <h2>Recent</h2>
          <ul></ul>
        </div>
      </section>
    </div>
  `;

  const choose = root.querySelector<HTMLElement>(".choose")!;
  const opening = root.querySelector<HTMLElement>(".opening")!;
  const openingText = root.querySelector<HTMLElement>(".opening-text")!;
  const form = root.querySelector<HTMLFormElement>(".address-form")!;
  const input = root.querySelector<HTMLInputElement>("#address")!;
  const button = form.querySelector<HTMLButtonElement>("button")!;
  const error = root.querySelector<HTMLElement>(".error")!;
  const recent = root.querySelector<HTMLElement>(".recent")!;
  const list = recent.querySelector("ul")!;

  const showError = (text: string | null) => {
    error.textContent = text ?? "";
    error.hidden = !text;
    input.setAttribute("aria-invalid", text ? "true" : "false");
  };

  const renderSaved = (saved: Saved[]) => {
    recent.hidden = saved.length === 0;
    list.replaceChildren(
      ...saved.map((entry) => {
        const row = document.createElement("li");
        const openButton = document.createElement("button");
        openButton.type = "button";
        openButton.className = "recent-open";
        openButton.textContent = entry.label;
        openButton.addEventListener("click", () => void open(entry.address, entry.label));
        const forgetButton = document.createElement("button");
        forgetButton.type = "button";
        forgetButton.className = "recent-forget";
        forgetButton.textContent = "Forget";
        forgetButton.setAttribute("aria-label", `Forget ${entry.label}`);
        forgetButton.addEventListener("click", async () => {
          try {
            renderSaved(await api.forget(entry.address));
          } catch (problem) {
            showError(message(problem));
          }
        });
        row.append(openButton, forgetButton);
        return row;
      }),
    );
  };

  const setBusy = (busy: boolean, label?: string) => {
    button.disabled = busy;
    input.disabled = busy;
    button.textContent = busy ? "Connecting…" : "Connect";
    opening.hidden = !busy;
    choose.hidden = busy;
    openingText.textContent = busy && label ? `Opening ${label}…` : "";
  };

  async function open(address: string, label: string) {
    showError(null);
    setBusy(true, label);
    try {
      await api.open(address);
    } catch (problem) {
      setBusy(false);
      input.value = label;
      showError(message(problem));
      input.focus();
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const typed = input.value.trim();
    if (!typed) {
      showError(`Enter the address of your ${NAME}.`);
      input.focus();
      return;
    }
    void open(typed, typed);
  });

  let saved: Saved[] = [];
  try {
    saved = await api.saved();
  } catch {
    saved = [];
  }
  renderSaved(saved);

  if (reopenLast && saved[0]) {
    await open(saved[0].address, saved[0].label);
  } else {
    input.focus();
  }
}
