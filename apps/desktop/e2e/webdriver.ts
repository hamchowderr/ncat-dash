// The few WebDriver calls the desktop tests need, sent straight to tauri-driver
// (https://v2.tauri.app/develop/tests/webdriver/), so there is no test framework to install.

const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";

export class Session {
  private constructor(
    private readonly base: string,
    private readonly id: string,
  ) {}

  static async start(driver: string, application: string): Promise<Session> {
    const reply = await call(`${driver}/session`, "POST", {
      capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application } } },
    });
    return new Session(driver, reply.sessionId);
  }

  private send(path: string, method = "GET", body?: unknown) {
    return call(`${this.base}/session/${this.id}${path}`, method, body);
  }

  async find(css: string): Promise<string> {
    const reply = await this.send("/element", "POST", { using: "css selector", value: css });
    return reply.value[ELEMENT];
  }

  /** Waits for `css` to appear (and, if given, for `check` to pass on its text). */
  async waitFor(css: string, check: (text: string) => boolean = () => true, ms = 15000) {
    const until = Date.now() + ms;
    let last = "";
    while (Date.now() < until) {
      try {
        const id = await this.find(css);
        last = await this.text(id);
        if (check(last)) return id;
      } catch (problem) {
        // not there yet
        last = last || String(problem);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`${css} never matched (last text: ${JSON.stringify(last)})`);
  }

  async type(id: string, text: string) {
    await this.send(`/element/${id}/clear`, "POST", {});
    await this.send(`/element/${id}/value`, "POST", { text });
  }

  async click(id: string) {
    await this.send(`/element/${id}/click`, "POST", {});
  }

  async text(id: string): Promise<string> {
    return (await this.send(`/element/${id}/text`)).value;
  }

  async title(): Promise<string> {
    return (await this.send("/title")).value;
  }

  async url(): Promise<string> {
    return (await this.send("/url")).value;
  }

  async end() {
    await this.send("", "DELETE").catch(() => {});
  }
}

async function call(url: string, method: string, body?: unknown) {
  const reply = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await reply.json();
  if (!reply.ok || json.value?.error) {
    throw new Error(`${method} ${url}: ${JSON.stringify(json.value ?? json)}`);
  }
  return { sessionId: json.sessionId ?? json.value?.sessionId, value: json.value };
}
