import { z } from "zod";

/**
 * # The click path of a page recording
 *
 * A storyboard line marked "Page recording" is shown as a video of a web page being used:
 * someone opening a page, clicking through it, typing into it. The agent works out the
 * clicks once (./page-recording.ts, "rehearsal"), and they are kept as a list of steps.
 * The video itself is made by playing the steps back with no model in the loop, so it has
 * no pauses while a model thinks, and a take can be recorded again the same way when the
 * page changes.
 *
 * A step names what it acts on by what a person sees, the element's role and name in the
 * page's accessibility tree ("button", "Sign in"), never by the snapshot's own refs
 * ("@e12"), which change every time the page is read. `nth` tells apart elements that
 * share a role and a name, counted in page order.
 */

export const target = z.object({
  role: z.string().min(1).max(60),
  name: z.string().max(300).default(""),
  nth: z.number().int().min(0).max(200).default(0),
});
export type Target = z.infer<typeof target>;

export const walkStep = z.discriminatedUnion("do", [
  z.object({ do: z.literal("goto"), url: z.string().url().max(2000) }),
  z.object({ do: z.literal("click"), target }),
  z.object({ do: z.literal("hover"), target }),
  z.object({
    do: z.literal("type"),
    target,
    text: z.string().max(500),
    clear: z.boolean().default(false),
  }),
  z.object({ do: z.literal("press"), key: z.string().min(1).max(40) }),
  z.object({ do: z.literal("select"), target, label: z.string().max(300) }),
  z.object({
    do: z.literal("scroll"),
    direction: z.enum(["up", "down"]),
    amount: z.number().int().min(50).max(5000).default(500),
  }),
  z.object({ do: z.literal("back") }),
  z.object({ do: z.literal("pause"), ms: z.number().int().min(100).max(10_000) }),
]);
export type WalkStep = z.infer<typeof walkStep>;

/** The most steps one take keeps: well past what fits in two minutes of video. */
export const MAX_STEPS = 60;

export const walkSteps = z.array(walkStep).min(1).max(MAX_STEPS);

/** The refs a snapshot gave, as the browser keeps them: ref id to role and name. */
export type RefMap = Record<string, { role: string; name?: string }>;

const same = (a: string | undefined, b: string | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * What a ref from the rehearsal's snapshot stands for, written so it can be found again:
 * its role, name, and which of the elements with both it was. Null for a ref the
 * snapshot did not give.
 */
export function targetOfRef(refs: RefMap, ref: string): Target | null {
  const id = ref.replace(/^@/, "").replace(/^ref=/, "");
  const found = refs[id];
  if (!found) return null;
  let nth = 0;
  for (const [key, entry] of Object.entries(refs)) {
    if (key === id) break;
    if (same(entry.role, found.role) && same(entry.name, found.name)) nth += 1;
  }
  return { role: found.role, name: found.name ?? "", nth };
}

/**
 * The ref, in a fresh snapshot, of the element a step acts on. The same role and name,
 * the same one of them when there are several, and the last one when the page now has
 * fewer. Null when the page has none.
 */
export function refOfTarget(refs: RefMap, wanted: Target): string | null {
  const matches = Object.entries(refs)
    .filter(([, entry]) => same(entry.role, wanted.role) && same(entry.name, wanted.name))
    .map(([key]) => key);
  if (matches.length === 0) return null;
  return `@${matches[Math.min(wanted.nth, matches.length - 1)]}`;
}

const quoted = (target: Target) => (target.name ? `"${target.name}"` : `the ${target.role}`);

/** A step in words, for the list of clicks shown under a take. */
export function describeStep(step: WalkStep): string {
  switch (step.do) {
    case "goto":
      return `Open ${step.url}`;
    case "click":
      return `Click ${quoted(step.target)}`;
    case "hover":
      return `Point at ${quoted(step.target)}`;
    case "type":
      return `Type "${step.text}" into ${quoted(step.target)}`;
    case "press":
      return `Press ${step.key}`;
    case "select":
      return `Pick "${step.label}" in ${quoted(step.target)}`;
    case "scroll":
      return `Scroll ${step.direction}`;
    case "back":
      return "Go back";
    case "pause":
      return `Wait ${Math.round(step.ms / 100) / 10} seconds`;
  }
}

/** The page size a take is recorded at, from the storyboard's shape. */
export const VIEWPORTS = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "1:1": { width: 960, height: 960 },
  "4:5": { width: 864, height: 1080 },
} as const;
export type Aspect = keyof typeof VIEWPORTS;

/**
 * Put into every page the recording opens, before the page's own scripts:
 *
 * - A pointer, drawn by the page itself, that glides to each thing before it is clicked
 *   and pulses when it is. A browser recording has no mouse pointer of its own, and a
 *   video where things change with nothing pointing at them is hard to follow.
 * - A 2-pixel square in a corner that changes shade on every animation frame. The browser
 *   only sends a picture when something on the page is drawn again, so a page that sits
 *   still gives none, and the video's timing comes out wrong (a 9-second take played in
 *   half a second when this was tested). The square keeps pictures coming at the
 *   browser's own pace. It is almost white on white and sits under the pointer's layer.
 */
export const PAGE_HELPERS = `(() => {
  if (window.__takewon) return;
  const NS = "http://www.w3.org/2000/svg";
  const state = { x: -40, y: -40, el: null, tick: null };
  const make = () => {
    if (state.el && document.documentElement.contains(state.el)) return;
    const tick = document.createElement("div");
    tick.setAttribute("aria-hidden", "true");
    tick.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;pointer-events:none;z-index:2147483646";
    const el = document.createElement("div");
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = "position:fixed;left:0;top:0;width:26px;height:26px;pointer-events:none;z-index:2147483647;transition:transform 0ms linear;will-change:transform";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "26");
    svg.setAttribute("height", "26");
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", "M4 2.5v17.2l4.6-4.4 3 6.7 3.1-1.4-3-6.6h6.3z");
    path.setAttribute("fill", "#111");
    path.setAttribute("stroke", "#fff");
    path.setAttribute("stroke-width", "1.4");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    el.appendChild(svg);
    document.documentElement.append(tick, el);
    state.el = el;
    state.tick = tick;
    el.style.transform = "translate(" + state.x + "px," + state.y + "px)";
  };
  let n = 0;
  const frame = () => {
    n += 1;
    if (state.tick) state.tick.style.background = n % 2 ? "rgba(255,255,255,0.97)" : "rgba(254,254,254,0.97)";
    requestAnimationFrame(frame);
  };
  const ready = () => { make(); requestAnimationFrame(frame); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
  window.__takewon = {
    place(x, y) { make(); state.x = x; state.y = y; state.el.style.transition = "none"; state.el.style.transform = "translate(" + x + "px," + y + "px)"; },
    glide(x, y, ms) { make(); state.x = x; state.y = y; state.el.style.transition = "transform " + ms + "ms cubic-bezier(.4,0,.2,1)"; state.el.style.transform = "translate(" + x + "px," + y + "px)"; },
    pulse() {
      make();
      const ring = document.createElement("div");
      ring.setAttribute("aria-hidden", "true");
      ring.style.cssText = "position:fixed;left:" + (state.x - 14) + "px;top:" + (state.y - 14) + "px;width:28px;height:28px;border-radius:50%;background:rgba(56,132,255,.35);pointer-events:none;z-index:2147483646;transition:transform 420ms ease-out,opacity 420ms ease-out";
      document.documentElement.appendChild(ring);
      requestAnimationFrame(() => { ring.style.transform = "scale(1.9)"; ring.style.opacity = "0"; });
      setTimeout(() => ring.remove(), 500);
    },
  };
})();`;

/** How long the pointer takes to reach a thing, and the beats around each step, in ms. */
export const PACE = {
  glide: 650,
  beforeAct: 180,
  afterStep: 900,
  afterLoad: 1500,
  typeDelay: 55,
  end: 1500,
} as const;
