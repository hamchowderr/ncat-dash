import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BrowserOptions,
  findPrompt,
  makeTake,
  type PassBrowser,
  pathFrom,
  pathOnSite,
  recordingTools,
  recordPath,
  rehearsalPrompt,
  stepOfAction,
  TakeProblem,
  useBrowserForTests,
  usePaceForTests,
} from "../../src/mastra/ncat/page-recording";
import { createNcatRoutes } from "../../src/mastra/ncat/routes";
import {
  describeStep,
  PAGE_HELPERS,
  type RefMap,
  refOfTarget,
  targetOfRef,
  walkSteps,
} from "../../src/mastra/ncat/walkthrough";
import { ctx, find } from "../helpers/route-harness";

/**
 * Page recordings: a storyboard line made into a video of a web page. The rehearsal's
 * clicks are written down by what a person sees (role and name), played back with a
 * pointer while Mastra records, and the video goes to the team's storage. Firecrawl is a
 * stand-in browser here, which logs what it was asked to do.
 */

const REFS: RefMap = {
  e1: { role: "link", name: "Pricing" },
  e2: { role: "button", name: "Sign up" },
  e3: { role: "link", name: "Docs" },
  e4: { role: "link", name: "Docs" },
  e5: { role: "textbox", name: "Search" },
};

type Fake = { browser: PassBrowser; log: string[]; options: BrowserOptions[] };

function fakeBrowser(
  over: { refs?: RefMap; failClick?: boolean; noRecorder?: boolean } = {},
): Fake {
  const log: string[] = [];
  const options: BrowserOptions[] = [];
  let outputDir = "";
  const refs = over.refs ?? REFS;
  const page = {
    setViewportSize: async (size: { width: number; height: number }) => {
      log.push(`viewport ${size.width}x${size.height}`);
    },
    evaluate: async (script: string) => {
      log.push(`page ${script.replace("window.__takewon && window.__takewon.", "")}`);
    },
    context: () => ({
      addInitScript: async (script: string) => {
        log.push(script === PAGE_HELPERS ? "helpers" : "other script");
      },
    }),
    url: () => "https://example.com/pricing",
  };
  const manager = {
    getPage: () => page,
    getRefMap: () => refs,
    getLocatorFromRef: async () => ({
      scrollIntoViewIfNeeded: async () => undefined,
      boundingBox: async () => ({ x: 100, y: 200, width: 80, height: 20 }),
    }),
  };
  const done = (what: string) => async (input: Record<string, unknown>) => {
    log.push(`${what} ${String(input.url ?? input.ref ?? input.key ?? "")}`.trim());
    if (what === "click" && over.failClick) return { success: false, message: "covered" };
    return { success: true };
  };
  const recorder = {
    execute: async (input: { action: string }) => {
      log.push(`record ${input.action}`);
      if (input.action === "start") return { isError: false };
      const filePath = join(outputDir, "take.avi");
      await writeFile(filePath, Buffer.alloc(1234));
      return { filePath, durationMs: 6500, frameCount: 95 };
    },
  };
  const browser = {
    goto: done("goto"),
    snapshot: async () => ({ success: true }),
    click: done("click"),
    type: done("type"),
    press: done("press"),
    select: done("select"),
    hover: done("hover"),
    back: async () => {
      log.push("back");
      return { success: true };
    },
    getTools: () => ({
      ...(over.noRecorder ? {} : { browser_record: recorder }),
      browser_click: {
        id: "browser_click",
        description: "Click",
        execute: async (input: { ref: string }) =>
          input.ref === "@e9" ? { success: false } : { success: true },
      },
      browser_snapshot: {
        id: "browser_snapshot",
        description: "Snapshot",
        execute: async () => ({ success: true }),
      },
    }),
    getManagerForThread: async () => manager,
    close: async () => {
      log.push("close");
    },
  } as unknown as PassBrowser;
  return {
    browser,
    log,
    options,
    get make() {
      return (given: BrowserOptions) => {
        options.push(given);
        outputDir = given.outputDir ?? "";
        return browser;
      };
    },
  } as Fake & { make: (given: BrowserOptions) => PassBrowser };
}

beforeEach(() => usePaceForTests(0));
afterEach(() => {
  usePaceForTests();
  useBrowserForTests();
  vi.unstubAllGlobals();
});

describe("a click path", () => {
  it("names what a step clicks by role and name, telling apart elements that share both", () => {
    expect(targetOfRef(REFS, "@e1")).toEqual({ role: "link", name: "Pricing", nth: 0 });
    expect(targetOfRef(REFS, "e4")).toEqual({ role: "link", name: "Docs", nth: 1 });
    expect(targetOfRef(REFS, "@e99")).toBeNull();
  });

  it("finds the same element again on a fresh page, or the last of them when there are fewer", () => {
    const later: RefMap = {
      a7: { role: "link", name: "docs" },
      a8: { role: "Link", name: "Docs " },
    };
    expect(refOfTarget(later, { role: "link", name: "Docs", nth: 1 })).toBe("@a8");
    expect(refOfTarget(later, { role: "link", name: "Docs", nth: 5 })).toBe("@a8");
    expect(refOfTarget(later, { role: "button", name: "Docs", nth: 0 })).toBeNull();
  });

  it("turns the browser actions that worked into steps, and leaves out the rest", () => {
    expect(stepOfAction("browser_goto", { url: "https://example.com" }, REFS)).toEqual({
      do: "goto",
      url: "https://example.com",
    });
    expect(stepOfAction("browser_click", { ref: "@e2" }, REFS)).toEqual({
      do: "click",
      target: { role: "button", name: "Sign up", nth: 0 },
    });
    expect(
      stepOfAction("browser_type", { ref: "@e5", text: "captions", clear: true }, REFS),
    ).toEqual({
      do: "type",
      target: { role: "textbox", name: "Search", nth: 0 },
      text: "captions",
      clear: true,
    });
    expect(stepOfAction("browser_scroll", { direction: "down" }, REFS)).toEqual({
      do: "scroll",
      direction: "down",
      amount: 500,
    });
    expect(stepOfAction("browser_snapshot", {}, REFS)).toBeNull();
    expect(stepOfAction("browser_click", { ref: "@e99" }, REFS)).toBeNull();
  });

  it("starts on the take's page and drops opening the same page twice", () => {
    const click = { do: "click" as const, target: { role: "link", name: "Docs", nth: 0 } };
    expect(pathFrom([click], "https://example.com")).toEqual([
      { do: "goto", url: "https://example.com" },
      click,
    ]);
    expect(
      pathFrom(
        [
          { do: "goto", url: "https://example.com" },
          { do: "goto", url: "https://example.com" },
          click,
        ],
        "https://example.com",
      ),
    ).toHaveLength(2);
  });

  it("refuses a path with nothing to show", () => {
    expect(() =>
      pathFrom([{ do: "goto", url: "https://example.com" }], "https://example.com"),
    ).toThrow(TakeProblem);
  });

  it("reads each step in words for the list under a take", () => {
    expect(describeStep({ do: "click", target: { role: "link", name: "Docs", nth: 0 } })).toBe(
      'Click "Docs"',
    );
    expect(describeStep({ do: "pause", ms: 1500 })).toBe("Wait 1.5 seconds");
    expect(walkSteps.safeParse([{ do: "jump" }]).success).toBe(false);
  });

  it("tells the model the line and the page, and to show without changing anything", () => {
    const prompt = rehearsalPrompt({
      line: "Here is where you change your plan.",
      url: "https://example.com",
      notes: "Open Billing",
    });
    expect(prompt).toContain('"Here is where you change your plan."');
    expect(prompt).toContain("Start on: https://example.com");
    expect(prompt).toContain("Also: Open Billing");
  });
});

describe("the rehearsal's browser tools", () => {
  it("write down a step only when the action worked", async () => {
    const fake = fakeBrowser();
    const steps: never[] = [];
    const tools = recordingTools(fake.browser, steps) as Record<
      string,
      { execute: (input: unknown, context: unknown) => Promise<unknown> }
    >;
    expect(Object.keys(tools).sort()).toEqual(["browser_click", "browser_snapshot"]);
    await tools.browser_snapshot.execute({}, {});
    await tools.browser_click.execute({ ref: "@e3" }, {});
    await tools.browser_click.execute({ ref: "@e9" }, {});
    expect(steps).toEqual([{ do: "click", target: { role: "link", name: "Docs", nth: 0 } }]);
  });
});

describe("recording a take", () => {
  const PATH = [
    { do: "goto" as const, url: "https://example.com" },
    { do: "click" as const, target: { role: "link", name: "Pricing", nth: 0 } },
    { do: "scroll" as const, direction: "down" as const, amount: 400 },
  ];

  it("opens the page first, records the steps with the pointer, and always closes", async () => {
    const fake = fakeBrowser() as Fake & { make: (o: BrowserOptions) => PassBrowser };
    useBrowserForTests(fake.make);
    const take = await recordPath({ aspect: "9:16", profile: "takewon-team-1" }, PATH, "/tmp");
    expect(take).toMatchObject({ durationMs: 6500, frames: 95, cut: 0 });
    expect(fake.options[0]).toMatchObject({
      aspect: "9:16",
      profile: "takewon-team-1",
      outputDir: "/tmp",
    });
    const at = (entry: string) => fake.log.indexOf(entry);
    expect(at("helpers")).toBeGreaterThan(-1);
    expect(fake.log).toContain("viewport 720x1280");
    // The page is open before the recording starts, and the click comes after it.
    expect(at("goto https://example.com")).toBeLessThan(at("record start"));
    expect(at("record start")).toBeLessThan(at("click @e1"));
    expect(fake.log.some((entry) => entry.startsWith("page glide(140, 210"))).toBe(true);
    expect(fake.log).toContain("page pulse()");
    expect(at("record stop")).toBeLessThan(at("close"));
  });

  it("stops the recording and closes the browser when a step fails", async () => {
    const fake = fakeBrowser({ failClick: true }) as Fake & {
      make: (o: BrowserOptions) => PassBrowser;
    };
    useBrowserForTests(fake.make);
    await expect(recordPath({ aspect: "16:9", profile: null }, PATH, "/tmp")).rejects.toThrow(
      /Click "Pricing"" did not work: covered/,
    );
    expect(fake.log.filter((entry) => entry === "record stop")).toHaveLength(1);
    expect(fake.log.at(-1)).toBe("close");
  });

  it("says plainly when a step's element is gone from the page", async () => {
    const fake = fakeBrowser({ refs: {} }) as Fake & { make: (o: BrowserOptions) => PassBrowser };
    useBrowserForTests(fake.make);
    await expect(recordPath({ aspect: "16:9", profile: null }, PATH, "/tmp")).rejects.toMatchObject(
      {
        code: "step_missing",
      },
    );
  });

  it("sends the video to the team's storage and answers the steps it played", async () => {
    const fake = fakeBrowser() as Fake & { make: (o: BrowserOptions) => PassBrowser };
    useBrowserForTests(fake.make);
    const put = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", put);
    const take = await makeTake(
      {
        organizationId: "team_1",
        line: "Here are the plans.",
        url: "https://example.com",
        notes: "",
        aspect: "16:9",
        profile: null,
        steps: PATH,
        uploadUrl: "https://bucket.example.com/take.avi?sig=1",
      },
      null,
    );
    expect(take).toMatchObject({ steps: PATH, rehearsed: false, size: 1234, cut: 0 });
    const [url, init] = put.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://bucket.example.com/take.avi?sig=1");
    expect(init.method).toBe("PUT");
  });
});

describe("POST /ncat/record", () => {
  const route = find(createNcatRoutes(), "/ncat/record", "POST");
  const BODY = {
    organizationId: "team_1",
    line: "Here are the plans.",
    url: "https://example.com",
    steps: [
      { do: "goto", url: "https://example.com" },
      { do: "click", target: { role: "link", name: "Pricing" } },
    ],
    uploadUrl: "https://bucket.example.com/take.avi?sig=1",
  };

  it("refuses an unsigned call and a body it cannot read", async () => {
    const unsigned = ctx({ body: BODY });
    await route.handler(unsigned.c);
    expect(unsigned.captured.status).toBe(401);
    const bad = ctx({ resourceId: "u1", body: { ...BODY, url: "not a page" } });
    await route.handler(bad.c);
    expect(bad.captured.status).toBe(400);
  });

  it("answers a take that could not be made with its reason", async () => {
    const fake = fakeBrowser({ noRecorder: true }) as Fake & {
      make: (o: BrowserOptions) => PassBrowser;
    };
    useBrowserForTests(fake.make);
    const { c, captured } = ctx({ resourceId: "u1", body: BODY });
    await route.handler(c);
    expect(captured.status).toBe(422);
    expect(captured.body).toMatchObject({ code: "recording" });
  });

  it("makes the take and answers its steps", async () => {
    const fake = fakeBrowser() as Fake & { make: (o: BrowserOptions) => PassBrowser };
    useBrowserForTests(fake.make);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const { c, captured } = ctx({ resourceId: "u1", body: BODY });
    await route.handler(c);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ rehearsed: false, durationMs: 6500 });
    expect((captured.body as { steps: unknown[] }).steps[1]).toEqual({
      do: "click",
      target: { role: "link", name: "Pricing", nth: 0 },
    });
  });
});

const SEARCH = "https://duckduckgo.com/";

describe("finding the page when a take has none", () => {
  it("starts on the site the agent opened directly", () => {
    expect(
      pathOnSite(
        [
          { do: "goto", url: "https://linear.app/" },
          { do: "click", target: { role: "link", name: "Changelog", nth: 0 } },
        ],
        ["https://linear.app/", "https://linear.app/changelog"],
      ),
    ).toEqual([
      { do: "goto", url: "https://linear.app/" },
      { do: "click", target: { role: "link", name: "Changelog", nth: 0 } },
    ]);
  });

  const CLICK = (name: string) => ({
    do: "click" as const,
    target: { role: "link", name, nth: 0 },
  });

  it("tells the model to search, prefer the site's own page, and skip pages turned down", () => {
    const prompt = findPrompt({
      line: "Linear's changelog shows the newest features.",
      notes: "",
      avoid: ["https://example.com/old"],
    });
    expect(prompt).not.toContain("Start on");
    expect(prompt).toContain("No start page");
    expect(prompt).toContain("https://example.com/old");
  });

  it("starts the take on the page the search led to, leaving the search out", () => {
    const steps = [
      { do: "goto" as const, url: SEARCH },
      {
        do: "type" as const,
        target: { role: "textbox", name: "Search", nth: 0 },
        text: "linear changelog",
        clear: false,
      },
      { do: "press" as const, key: "Enter" },
      CLICK("Changelog - Linear"),
      CLICK("Latest"),
    ];
    const pages = [
      SEARCH,
      SEARCH,
      "https://duckduckgo.com/?q=linear+changelog",
      "https://linear.app/changelog",
      "https://linear.app/changelog/latest",
    ];
    expect(pathOnSite(steps, pages)).toEqual([
      { do: "goto", url: "https://linear.app/changelog" },
      CLICK("Latest"),
    ]);
  });

  it("holds on a page that already shows it all, and finds nothing when no page was reached", () => {
    expect(
      pathOnSite(
        [{ do: "goto", url: SEARCH }, CLICK("Pricing - Stripe")],
        [SEARCH, "https://stripe.com/pricing"],
      ),
    ).toEqual([
      { do: "goto", url: "https://stripe.com/pricing" },
      { do: "pause", ms: 4000 },
    ]);
    expect(pathOnSite([], [])).toBeNull();
  });

  it("writes down where the browser is after each step it keeps", async () => {
    const fake = fakeBrowser();
    const steps: never[] = [];
    const pages: string[] = [];
    const tools = recordingTools(fake.browser, steps, pages) as Record<
      string,
      { execute: (input: unknown, context: unknown) => Promise<unknown> }
    >;
    await tools.browser_click.execute({ ref: "@e1" }, {});
    await tools.browser_click.execute({ ref: "@e9" }, {});
    expect(pages).toEqual(["https://example.com/pricing"]);
  });

  it("POST /ncat/find-page refuses an unsigned call and a body it cannot read", async () => {
    const route = find(createNcatRoutes(), "/ncat/find-page", "POST");
    const unsigned = ctx({ body: { organizationId: "team_1", line: "Plans." } });
    await route.handler(unsigned.c);
    expect(unsigned.captured.status).toBe(401);
    const bad = ctx({ resourceId: "u1", body: { organizationId: "team_1" } });
    await route.handler(bad.c);
    expect(bad.captured.status).toBe(400);
  });
});
