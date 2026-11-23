import { afterEach, describe, expect, test, vi } from "vitest";

import { startConnect, type Api, type Saved } from "./connect";
import { NAME } from "./product";

const hosted: Saved = {
  address: "https://app.example.com/",
  label: "app.example.com",
  lastOpened: 2,
};
const home: Saved = {
  address: "http://mac-mini.local:3000/",
  label: "http://mac-mini.local:3000",
  lastOpened: 1,
};

function fakeApi(saved: Saved[] = [], open: Api["open"] = async () => {}): Api {
  let list = [...saved];
  return {
    saved: vi.fn(async () => list),
    open: vi.fn(open),
    forget: vi.fn(async (address: string) => (list = list.filter((s) => s.address !== address))),
  };
}

async function render(api: Api, reopenLast = false) {
  const root = document.createElement("main");
  document.body.append(root);
  await startConnect(root, api, { reopenLast });
  return root;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const $ = <T extends Element>(root: Element, selector: string) => root.querySelector<T>(selector)!;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the Connect screen", () => {
  test("uses the product name from product.json, not a fixed one", async () => {
    const root = await render(fakeApi());
    expect(NAME).toBeTruthy();
    expect(document.title).toBe(NAME);
    expect(root.textContent).not.toContain("Kontifi");
  });

  test("asks for the address on the first start", async () => {
    const root = await render(fakeApi());
    expect($(root, "h1").textContent).toBe(`Connect to your ${NAME}`);
    expect($(root, ".recent").hasAttribute("hidden")).toBe(true);
    expect(document.activeElement).toBe($(root, "#address"));
  });

  test("opens the address someone types", async () => {
    const api = fakeApi();
    const root = await render(api);
    $<HTMLInputElement>(root, "#address").value = "  app.example.com ";
    $<HTMLFormElement>(root, "form").requestSubmit();
    await flush();
    expect(api.open).toHaveBeenCalledWith("app.example.com");
    expect($(root, ".opening-text").textContent).toBe("Opening app.example.com…");
    expect($(root, ".choose").hasAttribute("hidden")).toBe(true);
  });

  test("says what to do when the box is empty, without trying", async () => {
    const api = fakeApi();
    const root = await render(api);
    $<HTMLFormElement>(root, "form").requestSubmit();
    await flush();
    expect(api.open).not.toHaveBeenCalled();
    expect($(root, ".error").textContent).toBe(`Enter the address of your ${NAME}.`);
  });

  test("shows the app's reason when an address doesn't work, and keeps what was typed", async () => {
    const api = fakeApi([], async () => {
      throw `example.com answered, but it isn't ${NAME}. Use the address you sign in to ${NAME} at.`;
    });
    const root = await render(api);
    const input = $<HTMLInputElement>(root, "#address");
    input.value = "example.com";
    $<HTMLFormElement>(root, "form").requestSubmit();
    await flush();
    expect($(root, ".error").textContent).toContain(`isn't ${NAME}`);
    expect($(root, ".error").hasAttribute("hidden")).toBe(false);
    expect(input.value).toBe("example.com");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.disabled).toBe(false);
    expect($(root, ".choose").hasAttribute("hidden")).toBe(false);
  });

  test("opens the last dashboard straight away on a normal start", async () => {
    const api = fakeApi([hosted, home]);
    await render(api, true);
    expect(api.open).toHaveBeenCalledWith(hosted.address);
  });

  test("waits for a choice after Switch in the menu", async () => {
    const api = fakeApi([hosted, home]);
    const root = await render(api, false);
    expect(api.open).not.toHaveBeenCalled();
    const rows = [...root.querySelectorAll(".recent-open")].map((b) => b.textContent);
    expect(rows).toEqual(["app.example.com", "http://mac-mini.local:3000"]);
  });

  test("falls back to the form when the last dashboard can't be reached", async () => {
    const api = fakeApi([hosted], async () => {
      throw "Couldn't reach app.example.com. Check the address and your connection.";
    });
    const root = await render(api, true);
    expect($(root, ".error").textContent).toContain("Couldn't reach");
    expect($<HTMLInputElement>(root, "#address").value).toBe("app.example.com");
  });

  test("opens a recent dashboard and forgets one", async () => {
    const api = fakeApi([hosted, home]);
    const root = await render(api);
    root.querySelectorAll<HTMLButtonElement>(".recent-forget")[1].click();
    await flush();
    expect(api.forget).toHaveBeenCalledWith(home.address);
    expect(root.querySelectorAll(".recent-open")).toHaveLength(1);
    $<HTMLButtonElement>(root, ".recent-open").click();
    await flush();
    expect(api.open).toHaveBeenCalledWith(hosted.address);
  });

  test("still opens when the saved list can't be read", async () => {
    const api = fakeApi();
    api.saved = vi.fn(async () => {
      throw new Error("no settings folder");
    });
    const root = await render(api, true);
    expect($(root, "h1").textContent).toBe(`Connect to your ${NAME}`);
  });
});
