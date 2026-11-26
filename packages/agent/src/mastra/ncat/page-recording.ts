import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FirecrawlBrowser } from "@mastra/browser-firecrawl";
import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { env } from "../../lib/env";
import { onTeamKey, TEAM_KEY } from "./team-key";
import {
  type Aspect,
  describeStep,
  PACE,
  PAGE_HELPERS,
  type RefMap,
  refOfTarget,
  type Target,
  targetOfRef,
  VIEWPORTS,
  type WalkStep,
  walkStep,
  MAX_STEPS,
} from "./walkthrough";

/**
 * # Recording a storyboard line as a video of a web page
 *
 * Two passes, each in its own Firecrawl browser session (the hosted browser the agent
 * already uses, see lib/firecrawl-browser.ts):
 *
 * 1. **Rehearsal.** A model reads the line, opens the page and clicks through it until it
 *    shows what the line says. Nothing is recorded. Every action that worked is kept as a
 *    step of the take's click path (./walkthrough.ts).
 * 2. **Take.** The steps are played back with Mastra's browser recording on (the alpha
 *    `browser_record` tool of `@mastra/core`, turned on by the provider's `recording`
 *    option). A pointer glides to each thing before it is clicked. The video is a
 *    Motion-JPEG `.avi` without sound, which the dashboard has the toolkit turn into MP4.
 *
 * Recording the rehearsal itself would keep every pause while the model thinks. Playing
 * the steps back gives an even video, and the same steps can be played again later to
 * record the take again after the page changes, with no model and no AI spend.
 *
 * Mastra keeps one recording at a time per server process, and Firecrawl bills each open
 * session by the minute, so one take is made at a time here (`busy`), and the dashboard
 * queues them one at a time too. Sessions are always closed when a pass ends.
 *
 * Signed-in pages: a team's saved sign-in is a Firecrawl profile (./sign-ins.ts). Both
 * passes open it read-only (`saveChanges: false`), so a recording never changes it and
 * never waits on another session saving it.
 */

/** Mastra's own hard cap on one recording. */
export const MAX_TAKE_MS = 120_000;
/** Stop playing steps a little before the cap, so the last one is never cut mid-way. */
const PLAY_BUDGET_MS = 110_000;
/** One frame in every few the browser draws: about 15 a second, under Mastra's 2,000-frame buffer for two minutes. */
const EVERY_NTH_FRAME = 4;
/** The most model steps a rehearsal may take. */
const REHEARSAL_MAX_STEPS = 45;
/** Firecrawl session caps for a pass, in seconds. */
const SESSION_TTL = 600;
const SESSION_IDLE_TTL = 120;
const THREAD = "page-recording";

export const takeRequest = z.object({
  organizationId: z.string().min(1).max(200),
  /** What is said over the recording: what the page should show. */
  line: z.string().min(1).max(2000),
  /** Where the recording starts. */
  url: z.string().url().max(2000),
  /** Anything else the person said about what to show. */
  notes: z.string().max(2000).default(""),
  aspect: z.enum(["16:9", "9:16", "1:1", "4:5"]).default("16:9"),
  /** The team's saved sign-in to open the pages with, a Firecrawl profile name. */
  profile: z.string().min(1).max(120).nullish(),
  /** The click path from an earlier take. Left out: the agent works one out first. */
  steps: z.array(walkStep).min(1).max(MAX_STEPS).nullish(),
  /** Where to send the video: a signed PUT link into the team's storage. */
  uploadUrl: z.string().url().max(8000),
});
export type TakeRequest = z.infer<typeof takeRequest>;

export type TakeResult = {
  steps: WalkStep[];
  /** True when the steps were worked out for this take, false when an earlier take's were played. */
  rehearsed: boolean;
  durationMs: number;
  frames: number;
  size: number;
  /** Steps left unplayed because the two minutes ran out. */
  cut: number;
};

/** A take that could not be made, with a reason a person can act on. */
export class TakeProblem extends Error {
  constructor(
    message: string,
    readonly code: "busy" | "no_browser" | "no_path" | "step_missing" | "recording" | "upload",
  ) {
    super(message);
  }
}

// --- The browser -------------------------------------------------------------------

/** What a pass needs from the browser: FirecrawlBrowser has it all; tests stand in for it. */
export type PassBrowser = Pick<
  FirecrawlBrowser,
  | "goto"
  | "snapshot"
  | "click"
  | "type"
  | "press"
  | "select"
  | "hover"
  | "back"
  | "getTools"
  | "getManagerForThread"
  | "close"
>;

export type BrowserOptions = {
  aspect: Aspect;
  profile: string | null;
  /** Set for the take: where Mastra writes the recording. */
  outputDir?: string;
};

function firecrawlBrowser({ aspect, profile, outputDir }: BrowserOptions): PassBrowser {
  if (!env.FIRECRAWL_API_KEY) {
    throw new TakeProblem(
      "Page recordings need a Firecrawl key on the agent server (FIRECRAWL_API_KEY).",
      "no_browser",
    );
  }
  const size = VIEWPORTS[aspect];
  return new FirecrawlBrowser({
    apiKey: env.FIRECRAWL_API_KEY,
    apiUrl: env.FIRECRAWL_API_URL,
    scope: "thread",
    viewport: size,
    // No JavaScript from the model, and no captions burned into the picture: the video is
    // material for an edit, where words go on in the edit.
    // (The provider's type lists only its own tools; it drops the recording ones by name too.)
    excludeTools: ["browser_evaluate", "browser_record_caption"] as unknown as ["browser_evaluate"],
    ...(outputDir
      ? {
          recording: {
            outputDir,
            maxDurationMs: MAX_TAKE_MS,
            maxWidth: size.width,
            maxHeight: size.height,
          },
        }
      : {}),
    firecrawl: {
      ttl: SESSION_TTL,
      activityTtl: SESSION_IDLE_TTL,
      ...(profile ? { profile: { name: profile, saveChanges: false } } : {}),
    },
  });
}

let makeBrowser: (options: BrowserOptions) => PassBrowser = firecrawlBrowser;

/** For tests: hand out a stand-in browser. Pass nothing to undo. */
export function useBrowserForTests(make?: (options: BrowserOptions) => PassBrowser): void {
  makeBrowser = make ?? firecrawlBrowser;
}

type Page = {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  evaluate(script: string): Promise<unknown>;
  context(): { addInitScript(script: string): Promise<void> };
  url(): string;
  title(): Promise<string>;
  screenshot(options: { type: "jpeg"; quality: number }): Promise<Uint8Array>;
};

async function pageOf(browser: PassBrowser): Promise<Page> {
  const manager = (await browser.getManagerForThread(THREAD)) as unknown as {
    getPage(): Page;
  };
  return manager.getPage();
}

async function refsOf(browser: PassBrowser): Promise<RefMap> {
  const manager = (await browser.getManagerForThread(THREAD)) as unknown as {
    getRefMap(): RefMap;
  };
  return manager.getRefMap();
}

type Box = { x: number; y: number; width: number; height: number };
type Locator = {
  scrollIntoViewIfNeeded(options?: { timeout?: number }): Promise<void>;
  boundingBox(): Promise<Box | null>;
};

async function locatorOf(browser: PassBrowser, ref: string): Promise<Locator | null> {
  const manager = (await browser.getManagerForThread(THREAD)) as unknown as {
    getLocatorFromRef(ref: string): Promise<Locator | null>;
  };
  return manager.getLocatorFromRef(ref);
}

const ok = (result: unknown) =>
  Boolean(result && typeof result === "object" && (result as { success?: unknown }).success);

const errorOf = (result: unknown) =>
  String(
    (result as { message?: unknown; error?: unknown })?.message ??
      (result as { error?: unknown })?.error ??
      "the page did not answer",
  );

let paceScale = 1;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms * paceScale));

/** For tests: play the beats faster (0 for no waiting). Pass nothing to undo. */
export function usePaceForTests(scale = 1): void {
  paceScale = scale;
}

// --- One at a time -------------------------------------------------------------------

let busy = false;

/** Whether a take is being made on this server right now. */
export function takeInProgress(): boolean {
  return busy;
}

// --- Rehearsal -----------------------------------------------------------------------

export const REHEARSAL_INSTRUCTIONS = `You prepare a short screen recording of a web page for a video. You are given the line that is said over the recording and the page it starts on. Use the browser to show what the line talks about, the way a person demonstrating it would: open the page, click to the right place, scroll to what matters, type into a search box if that is what the line describes.

Rules:
- Take a snapshot before each click so you use refs the page has now.
- Show, do not change. Never submit a form that saves, sends, buys, books, deletes, publishes or signs up for anything, and never accept a cookie banner's "accept all" unless nothing else closes it. Typing into a search box and pressing Enter is fine.
- Never type a password, a card number or anyone's personal details. If the page asks you to sign in, stop and say so in one line.
- Keep it short: what fits in under a minute and a half of video, usually 3 to 12 actions. Do not wander off the site.
- When the page shows what the line describes, stop and answer with one short line saying what the recording shows.`;

/** What the model is told for one take. */
export function rehearsalPrompt(request: Pick<TakeRequest, "line" | "url" | "notes">): string {
  return [
    `The line said over the recording: "${request.line.trim()}"`,
    `Start on: ${request.url}`,
    request.notes.trim() ? `Also: ${request.notes.trim()}` : "",
    "Open the start page first.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The browser tools the rehearsal may use. */
const REHEARSAL_TOOLS = [
  "browser_goto",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_press",
  "browser_select",
  "browser_scroll",
  "browser_hover",
  "browser_back",
  "browser_wait",
] as const;

type ToolLike = {
  id: string;
  description: string;
  inputSchema?: unknown;
  execute?: (input: unknown, context: unknown) => Promise<unknown>;
};

/**
 * The step an action becomes, worked out before it runs (a ref only means something
 * against the snapshot taken before it). Null for an action that is not part of the path:
 * a snapshot, a wait, or a ref the snapshot did not give.
 */
export function stepOfAction(
  tool: string,
  input: Record<string, unknown>,
  refs: RefMap,
): WalkStep | null {
  const target = (key = "ref"): Target | null =>
    typeof input[key] === "string" ? targetOfRef(refs, input[key] as string) : null;
  switch (tool) {
    case "browser_goto":
      return typeof input.url === "string" ? { do: "goto", url: input.url } : null;
    case "browser_click": {
      const found = target();
      return found ? { do: "click", target: found } : null;
    }
    case "browser_hover": {
      const found = target();
      return found ? { do: "hover", target: found } : null;
    }
    case "browser_type": {
      const found = target();
      return found && typeof input.text === "string"
        ? { do: "type", target: found, text: input.text, clear: input.clear === true }
        : null;
    }
    case "browser_select": {
      const found = target();
      const label =
        typeof input.label === "string"
          ? input.label
          : typeof input.value === "string"
            ? input.value
            : null;
      return found && label !== null ? { do: "select", target: found, label } : null;
    }
    case "browser_press":
      return typeof input.key === "string" ? { do: "press", key: input.key } : null;
    case "browser_scroll":
      return input.direction === "up" || input.direction === "down"
        ? {
            do: "scroll",
            direction: input.direction,
            amount: typeof input.amount === "number" ? Math.round(input.amount) : 500,
          }
        : null;
    case "browser_back":
      return { do: "back" };
    default:
      return null;
  }
}

/**
 * The browser's tools, each writing down the step it made when it worked. Every call runs
 * in the pass's own browser session, whatever thread the model's call names.
 */
export function recordingTools(browser: PassBrowser, steps: WalkStep[], pages?: string[]) {
  const all = browser.getTools() as Record<string, ToolLike>;
  const tools: Record<string, unknown> = {};
  for (const name of REHEARSAL_TOOLS) {
    const original = all[name];
    if (!original?.execute) continue;
    const run = original.execute;
    tools[name] = createTool({
      id: name,
      description: original.description,
      inputSchema: original.inputSchema as z.ZodObject,
      execute: async (input, context) => {
        const refs = await refsOf(browser).catch(() => ({}) as RefMap);
        const step = stepOfAction(name, input as Record<string, unknown>, refs);
        const result = await run(input, {
          ...(context as object),
          agent: { ...((context as { agent?: object })?.agent ?? {}), threadId: THREAD },
        });
        if (step && ok(result) && steps.length < MAX_STEPS) {
          steps.push(step);
          // Where the browser is once the step is done, for finding a page by searching.
          if (pages)
            pages.push(
              await pageOf(browser)
                .then((page) => page.url())
                .catch(() => ""),
            );
        }
        return result;
      },
    });
  }
  return tools;
}

const rehearsalAgent = (
  browser: PassBrowser,
  steps: WalkStep[],
  pages?: string[],
  instructions = REHEARSAL_INSTRUCTIONS,
) =>
  new Agent({
    id: "page-recording",
    name: "Page recording",
    description: "Works out the clicks for a page recording on a storyboard.",
    instructions,
    model: ({ requestContext }) => {
      const key = requestContext.get(TEAM_KEY);
      return onTeamKey(env.CHAT_MODEL, typeof key === "string" ? key : null);
    },
    tools: recordingTools(browser, steps, pages) as never,
  });

/** Works out the click path for a take. */
export async function rehearse(request: TakeRequest, teamKey: string | null): Promise<WalkStep[]> {
  const steps: WalkStep[] = [];
  const browser = makeBrowser({ aspect: request.aspect, profile: request.profile ?? null });
  try {
    const requestContext = new RequestContext();
    if (teamKey) requestContext.set(TEAM_KEY, teamKey);
    await rehearsalAgent(browser, steps).generate(
      [{ role: "user", content: rehearsalPrompt(request) }],
      { requestContext, maxSteps: REHEARSAL_MAX_STEPS },
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
  return pathFrom(steps, request.url);
}

/**
 * A click path that starts on a page: the start page put first when the model did not
 * open it, and repeated goto's to the same page dropped.
 */
export function pathFrom(steps: WalkStep[], url: string): WalkStep[] {
  const path: WalkStep[] = steps[0]?.do === "goto" ? [] : [{ do: "goto", url }];
  for (const step of steps) {
    const last = path[path.length - 1];
    if (step.do === "goto" && last?.do === "goto" && last.url === step.url) continue;
    path.push(step);
  }
  if (!path.some((step) => step.do !== "goto")) {
    throw new TakeProblem(
      "The agent could not find anything to click on that page for this line. Check the page address, or say more about what to show.",
      "no_path",
    );
  }
  return path.slice(0, MAX_STEPS);
}

// --- Finding the page ----------------------------------------------------------------

export const findRequest = z.object({
  organizationId: z.string().min(1).max(200),
  line: z.string().min(1).max(2000),
  notes: z.string().max(2000).default(""),
  aspect: z.enum(["16:9", "9:16", "1:1", "4:5"]).default("16:9"),
  profile: z.string().min(1).max(120).nullish(),
  /** Pages found before that the person did not want. */
  avoid: z.array(z.string().max(2000)).max(10).default([]),
});
export type FindRequest = z.infer<typeof findRequest>;

export type FoundPage = {
  /** The click path for the take, starting on the page found (the search left out). */
  steps: WalkStep[];
  url: string;
  title: string;
  /** A JPEG of where the clicks end, base64, for the person to check before recording. */
  preview: string | null;
};

export const FIND_INSTRUCTIONS = `${REHEARSAL_INSTRUCTIONS}

No page address was given for this take, and there is no start page: you decide where to go. Your first action is opening a page. When you know the site the line is about, open it directly. When you are not sure where the page is, use a search engine to find it. Prefer the site's own page (the company's or project's official site) over articles about it, and the newest version of a page when the line says latest or newest. Once on that site, show what the line describes as above.`;

/** What the model is told when it has to find the page. */
export function findPrompt(request: Pick<FindRequest, "line" | "notes" | "avoid">): string {
  return [
    `The line said over the recording: "${request.line.trim()}"`,
    "No start page: open the page you judge right, or search for it.",
    request.notes.trim() ? `Also: ${request.notes.trim()}` : "",
    request.avoid.length
      ? `The person did not want these pages, so find a different one: ${request.avoid.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * The take's path for a page the agent found: it starts on the site the agent ended on,
 * at the first page of the last stretch on that site. Anything before (a search, say) is
 * left out, so nothing about where to look is fixed in code. Null when no page was reached.
 */
export function pathOnSite(steps: WalkStep[], pages: string[]): WalkStep[] | null {
  const site = hostOf(pages[pages.length - 1] ?? "");
  if (!site) return null;
  let start = pages.length - 1;
  while (start > 0 && hostOf(pages[start - 1]) === site) start--;
  const landed = pages[start];
  if (!/^https?:/.test(landed)) return null;
  const rest = steps.slice(start + 1);
  const path: WalkStep[] = [{ do: "goto", url: landed }, ...rest];
  // A page that already shows it all still needs a moment on screen.
  if (!rest.length) path.push({ do: "pause", ms: 4000 });
  return path.slice(0, MAX_STEPS);
}

/** Finds the page for a take with no address by searching, without recording anything. */
export async function findPage(request: FindRequest, teamKey: string | null): Promise<FoundPage> {
  const steps: WalkStep[] = [];
  const pages: string[] = [];
  const browser = makeBrowser({ aspect: request.aspect, profile: request.profile ?? null });
  let url = "";
  let title = "";
  let preview: string | null = null;
  try {
    const requestContext = new RequestContext();
    if (teamKey) requestContext.set(TEAM_KEY, teamKey);
    await rehearsalAgent(browser, steps, pages, FIND_INSTRUCTIONS).generate(
      [{ role: "user", content: findPrompt(request) }],
      { requestContext, maxSteps: REHEARSAL_MAX_STEPS },
    );
    const page = await pageOf(browser).catch(() => null);
    if (page) {
      url = page.url();
      title = (await page.title().catch(() => "")).slice(0, 300);
      const shot = await page.screenshot({ type: "jpeg", quality: 60 }).catch(() => null);
      preview = shot ? Buffer.from(shot).toString("base64") : null;
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  const path = pathOnSite(steps, pages);
  if (!path || !/^https?:/.test(url)) {
    throw new TakeProblem(
      "The agent could not find a page for this line. Give the page's address, or say more about what to show.",
      "no_path",
    );
  }
  return { steps: path, url, title, preview };
}

// --- The take ------------------------------------------------------------------------

type Pointer = { x: number; y: number };

async function helper(page: Page, call: string): Promise<void> {
  await page.evaluate(`window.__takewon && window.__takewon.${call}`).catch(() => undefined);
}

/** The ref of a step's element on the page as it is now, looking again while it loads. */
async function findRef(browser: PassBrowser, step: WalkStep & { target: Target }) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await wait(800);
    await browser.snapshot({}, THREAD);
    const ref = refOfTarget(await refsOf(browser), step.target);
    if (ref) return ref;
  }
  throw new TakeProblem(
    `The page no longer has what this step clicks: "${describeStep(step)}". Record the take with a new path.`,
    "step_missing",
  );
}

/** Moves the pointer to an element's middle, scrolling it into view first. */
async function pointAt(browser: PassBrowser, page: Page, ref: string, from: Pointer) {
  const locator = await locatorOf(browser, ref);
  if (!locator) return from;
  await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
  const box = await locator.boundingBox().catch(() => null);
  if (!box) return from;
  const to = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  await helper(page, `place(${from.x}, ${from.y})`);
  await helper(page, `glide(${to.x}, ${to.y}, ${PACE.glide})`);
  await wait(PACE.glide + PACE.beforeAct);
  return to;
}

/** Plays one step, with the pointer and the beats a viewer needs to follow it. */
async function play(
  browser: PassBrowser,
  page: Page,
  step: WalkStep,
  pointer: Pointer,
): Promise<Pointer> {
  let at = pointer;
  let result: unknown = { success: true };
  switch (step.do) {
    case "goto":
      result = await browser.goto({ url: step.url, waitUntil: "load", timeout: 30_000 }, THREAD);
      await wait(PACE.afterLoad);
      break;
    case "click":
    case "hover":
    case "type":
    case "select": {
      const ref = await findRef(browser, step);
      at = await pointAt(browser, page, ref, pointer);
      if (step.do === "click") {
        await helper(page, "pulse()");
        result = await browser.click({ ref, waitUntil: "load", timeout: 15_000 }, THREAD);
      } else if (step.do === "hover") {
        result = await browser.hover({ ref }, THREAD);
      } else if (step.do === "type") {
        await helper(page, "pulse()");
        result = await browser.type(
          { ref, text: step.text, clear: step.clear, delay: PACE.typeDelay },
          THREAD,
        );
      } else {
        result = await browser.select({ ref, label: step.label }, THREAD);
      }
      break;
    }
    case "press":
      result = await browser.press({ key: step.key }, THREAD);
      break;
    case "scroll": {
      const top = step.direction === "down" ? step.amount : -step.amount;
      await page
        .evaluate(`window.scrollBy({ top: ${top}, behavior: "smooth" })`)
        .catch(() => undefined);
      break;
    }
    case "back":
      result = await browser.back(THREAD);
      await wait(PACE.afterLoad - PACE.afterStep);
      break;
    case "pause":
      await wait(step.ms);
      break;
  }
  if (!ok(result)) {
    throw new TakeProblem(
      `"${describeStep(step)}" did not work: ${errorOf(result)}.`,
      "step_missing",
    );
  }
  // A new page draws its own pointer; put it back where it was.
  await helper(page, `place(${at.x}, ${at.y})`);
  await wait(PACE.afterStep);
  return at;
}

type RecordTool = {
  execute(input: unknown, context: unknown): Promise<Record<string, unknown>>;
};

/** Plays a click path with recording on, and returns the `.avi` Mastra wrote. */
export async function recordPath(
  request: Pick<TakeRequest, "aspect" | "profile">,
  steps: WalkStep[],
  outputDir: string,
): Promise<{ filePath: string; durationMs: number; frames: number; cut: number }> {
  const browser = makeBrowser({
    aspect: request.aspect,
    profile: request.profile ?? null,
    outputDir,
  });
  const recorder = (browser.getTools() as Record<string, RecordTool | undefined>).browser_record;
  if (!recorder) throw new TakeProblem("This browser cannot record.", "recording");
  const context = { agent: { threadId: THREAD } };
  let recording = false;
  try {
    const [first, ...rest] = steps;
    if (first?.do !== "goto")
      throw new TakeProblem("A click path starts by opening a page.", "no_path");
    // Open the first page before recording, so the video starts on it, not on a blank tab.
    const opened = await browser.goto({ url: "about:blank" }, THREAD);
    if (!ok(opened))
      throw new TakeProblem(`The browser did not open: ${errorOf(opened)}.`, "no_browser");
    const page = await pageOf(browser);
    await page.context().addInitScript(PAGE_HELPERS);
    await page.setViewportSize(VIEWPORTS[request.aspect]);
    const loaded = await browser.goto(
      { url: first.url, waitUntil: "load", timeout: 30_000 },
      THREAD,
    );
    if (!ok(loaded))
      throw new TakeProblem(`${first.url} did not open: ${errorOf(loaded)}.`, "step_missing");
    await wait(PACE.afterLoad);

    const size = VIEWPORTS[request.aspect];
    const started = await recorder.execute(
      {
        action: "start",
        maxDurationMs: MAX_TAKE_MS,
        everyNthFrame: EVERY_NTH_FRAME,
        maxWidth: size.width,
        maxHeight: size.height,
      },
      context,
    );
    if (started.isError) throw new TakeProblem(String(started.content), "recording");
    recording = true;
    const begun = Date.now();
    let pointer: Pointer = { x: Math.round(size.width / 2), y: Math.round(size.height / 2) };
    await helper(page, `place(${pointer.x}, ${pointer.y})`);
    await wait(PACE.afterStep);
    let played = 0;
    for (const step of rest) {
      if (Date.now() - begun > PLAY_BUDGET_MS) break;
      pointer = await play(browser, page, step, pointer);
      played += 1;
    }
    await wait(PACE.end);
    const stopped = await recorder.execute({ action: "stop" }, context);
    recording = false;
    if (stopped.isError || typeof stopped.filePath !== "string") {
      throw new TakeProblem(String(stopped.content ?? "The recording did not save."), "recording");
    }
    return {
      filePath: stopped.filePath,
      durationMs: Number(stopped.durationMs) || 0,
      frames: Number(stopped.frameCount) || 0,
      cut: rest.length - played,
    };
  } finally {
    // A take that failed part-way still ends its recording, so the next one can start.
    if (recording) await recorder.execute({ action: "stop" }, context).catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

/** Sends the finished file to the team's storage. */
async function send(filePath: string, uploadUrl: string): Promise<number> {
  const bytes = await readFile(filePath);
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": "video/x-msvideo" },
    body: bytes,
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    throw new TakeProblem(
      `The team's storage would not take the recording (${response.status}).`,
      "upload",
    );
  }
  return (await stat(filePath)).size;
}

/**
 * Makes one take: works out the click path when there is none, records it, and sends the
 * video to the team's storage. One at a time per server.
 */
export async function makeTake(request: TakeRequest, teamKey: string | null): Promise<TakeResult> {
  if (busy) {
    throw new TakeProblem(
      "Another page recording is being made. It will be this one's turn next.",
      "busy",
    );
  }
  busy = true;
  const dir = await mkdtemp(join(tmpdir(), "takewon-recording-"));
  try {
    const rehearsed = !request.steps;
    const steps = request.steps ?? (await rehearse(request, teamKey));
    const take = await recordPath(request, steps, dir);
    const size = await send(take.filePath, request.uploadUrl);
    return {
      steps,
      rehearsed,
      durationMs: take.durationMs,
      frames: take.frames,
      size,
      cut: take.cut,
    };
  } finally {
    busy = false;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
