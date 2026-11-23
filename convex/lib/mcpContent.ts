import { APP_MIME_TYPE, type McpResource, type McpSkill } from "./mcpServer";

/**
 * What the MCP server hands an agent besides its tools: the skill that teaches it to
 * build and run the team's automations (Skills extension), and the page that shows a
 * run's progress in the chat (MCP Apps extension).
 */

/** A change to an automation, as change_automation takes it (automations.change). */
export const OPERATION_SCHEMA = {
  type: "object",
  description:
    'One change. op is one of: add (type, optional id, after, before, branch, settings, label, join), remove (ids), connect (source, target, optional branch "yes"/"no"/"failed"), disconnect (source, target), set (id, settings merged; null clears one), use (id, field, from: "auto", "trigger" or a step id), rename (id, label), meet (id, mode: "all" waits for every line and uses every file, "source" pairs files from the same upload, "position" pairs them in order, "first" uses whichever line finishes first; for a step two or more lines lead into), switch (id, on), duplicate (ids), trigger (trigger: {kind, ...settings}, kind as in list_step_types without "trigger:"; optional id to change a trigger other than the first), addTrigger (trigger, optional starts: ids of steps nothing else feeds) adds another trigger with the id "__trigger_2" and up, removeTrigger (id), name (name), tidy. With several triggers, each run does only the steps its trigger starts: add a step with after set to a trigger id to start a branch from it, or connect a trigger id to a step nothing else feeds.',
  properties: {
    op: {
      type: "string",
      enum: [
        "add",
        "remove",
        "connect",
        "disconnect",
        "set",
        "use",
        "rename",
        "meet",
        "switch",
        "duplicate",
        "trigger",
        "addTrigger",
        "removeTrigger",
        "name",
        "tidy",
      ],
    },
  },
  required: ["op"],
  additionalProperties: true,
} as const;

const SKILL_MD = `---
name: content-automations
description: Build, try and run the team's content automations in Takewon (clips, captions, reframing and other FFmpeg steps that run on the team's own toolkit). Use when asked to make or change an automation, run one on a file, or check how a run went.
---

# Content automations

An automation runs by itself on the team's server: something starts it (a new upload, a watched folder, a schedule, its web address, another automation ending, or a person by hand), then plain steps run in order with nobody at the keyboard. No AI is spent per video; you set the automation up once.

## Read before you change

1. \`list_automations\` for what the team has. \`describe_automation\` before changing one: it gives the steps in running order and what still stops it running.
2. \`list_step_types\` lists every trigger and step type in one line each. Pass a type (such as \`step:video-caption\`) for the settings it takes, before adding a step you have not used yet.

## Ask what only the person can decide

When the automation makes clips or reshapes video, ask which platforms it is for (TikTok, Instagram Reels, YouTube Shorts and so on) if they did not say, and what starts it. Choices that only shape the look, such as caption style, you may pick yourself; say what you picked.

## Build

- \`create_automation\` makes a new, empty one (switched off). \`change_automation\` sends every change for one request together; they are made in order and all are kept or none.
- Your changes are kept as a draft. Someone on the team publishes it in the dashboard; the published version keeps running until then. Say so, with the address you were given.
- Leave file settings empty: each step takes the nearest fitting file before it by itself. Logo, colour, font and music come from the team's brand in Settings. Never ask the person to type file links or placeholders.
- For several platforms, give each its own "Clips for a platform" step from the same start, with its own steps after it.
- An Approval step asks anyone on the team unless reviewers are named; it waits until someone decides.
- One automation can have more than one trigger (say an upload and a schedule), all under its one on/off switch. Each trigger starts only the steps it is connected to, so two triggers can share the same steps or each start their own. \`addTrigger\` adds one; then add steps \`after\` its id. For automations that should run one after another, use a trigger that starts when another automation finishes instead.

## Try it

When \`change_automation\` reports no problems, try the draft: \`start_automation\` with \`version: "draft"\` on one of the team's uploads (\`list_uploads\`). Then \`check_run\` shows each step. If a step failed, read its error, fix what you can and try again; say plainly what you could not fix. A run waiting at an Approval step is working as built.

## Report

Say in plain words what starts it and what each step does, and for a run, what it made (how many clips) and any step that failed and why. No ids or JSON unless asked. You cannot switch an automation on or publish a draft: people do that in the dashboard.

You do not post to social platforms, generate video from text, dub voices or make avatars.
`;

export const SKILLS: McpSkill[] = [
  {
    name: "content-automations",
    description:
      "Build, try and run the team's content automations in this dashboard (clips, captions, reframing and other FFmpeg steps that run on the team's own toolkit).",
    files: [
      {
        uri: "skill://content-automations/SKILL.md",
        name: "SKILL.md",
        title: "Content automations",
        description: "How to build, try and run the team's automations.",
        mimeType: "text/markdown",
        text: SKILL_MD,
      },
    ],
  },
];

export const RUN_APP_URI = "ui://ncat-dash/run.html";

/**
 * A run's progress, shown in the chat by hosts with MCP Apps. It reads the tool result it
 * was opened with (start_automation or check_run), then asks check_run again every few
 * seconds until the run ends. While it goes it shows the steps; once done, the finished files,
 * which open through the chat (ui/open-link). Plain HTML and script, nothing loaded from
 * elsewhere, and it takes the chat's own colours and fonts when the chat hands them over.
 */
const RUN_APP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Run</title>
<style>
  :root { color-scheme: light;
    --text: var(--color-text-primary, #18181b); --muted: var(--color-text-secondary, #71717a); --faint: var(--color-text-tertiary, #a1a1aa);
    --track: var(--color-background-tertiary, #f0f0f1); --hover: var(--color-background-secondary, #f6f6f7);
    --accent: #4f46e5; --good: var(--color-text-success, #15803d); --bad: var(--color-text-danger, #b91c1c); --wait: var(--color-text-warning, #b45309);
    --font: var(--font-sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif); --radius: var(--border-radius-md, 8px); }
  :root[data-theme="dark"] { color-scheme: dark;
    --text: var(--color-text-primary, #f4f4f5); --muted: var(--color-text-secondary, #a1a1aa); --faint: var(--color-text-tertiary, #71717a);
    --track: var(--color-background-tertiary, #2a2a2e); --hover: var(--color-background-secondary, #232326);
    --accent: #818cf8; --good: var(--color-text-success, #4ade80); --bad: var(--color-text-danger, #f87171); --wait: var(--color-text-warning, #fbbf24); }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px 18px; font: 14px/1.45 var(--font); color: var(--text); background: transparent; -webkit-font-smoothing: antialiased; }
  h1 { font-size: 15px; font-weight: 600; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { margin-top: 2px; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .status { font-weight: 500; }
  .status.running { color: var(--accent); } .status.done { color: var(--good); }
  .status.failed, .status.cancelled { color: var(--bad); } .status.waiting { color: var(--wait); }
  .bar { height: 3px; margin-top: 12px; border-radius: 3px; background: var(--track); overflow: hidden; }
  .bar span { display: block; height: 100%; width: 0; background: var(--accent); border-radius: 3px; transition: width .4s ease; }
  ol, ul { list-style: none; margin: 14px 0 0; padding: 0; }
  li { display: flex; align-items: flex-start; gap: 10px; padding: 3px 0; }
  .icon { width: 16px; height: 16px; flex: none; margin-top: 2px; }
  .pending .name, .skipped .name { color: var(--faint); }
  .done .icon { color: var(--good); } .failed .icon { color: var(--bad); } .waiting_approval .icon { color: var(--wait); }
  .running .icon { color: var(--accent); animation: spin 1s linear infinite; } .pending .icon, .skipped .icon { color: var(--faint); }
  .name { flex: 1; min-width: 0; }
  .note { display: block; margin-top: 1px; font-size: 13px; color: var(--muted); }
  .failed .note { color: var(--bad); }
  .label { margin: 16px 0 0; font-size: 12px; font-weight: 500; color: var(--muted); }
  #files { margin-top: 6px; }
  #files li { padding: 0; }
  #files a { display: flex; align-items: center; gap: 10px; width: 100%; padding: 6px 8px; margin: 0 -8px; border-radius: var(--radius);
    color: inherit; text-decoration: none; min-width: 0; }
  #files a:hover, #files a:focus-visible { background: var(--hover); outline: none; }
  #files .icon { margin: 0; color: var(--muted); }
  .file { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .open { font-size: 13px; color: var(--muted); }
  .more { padding: 4px 0 0; font-size: 13px; color: var(--muted); }
  footer { margin-top: 16px; }
  .button { display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: var(--radius); font: 500 13px/1 var(--font);
    color: var(--text); background: var(--hover); text-decoration: none; }
  .button:hover, .button:focus-visible { background: var(--track); outline: none; }
  .button.primary { color: #fff; background: var(--accent); }
  .button.primary:hover, .button.primary:focus-visible { filter: brightness(1.08); }
  [hidden] { display: none !important; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .running .icon { animation: none; } .bar span { transition: none; } }
</style>
</head>
<body>
<h1 id="title">Run</h1>
<div class="meta"><span id="status" class="status">Starting</span><span id="detail"></span></div>
<div class="bar" id="bar" hidden><span></span></div>
<ol id="steps"></ol>
<p class="label" id="files-label" hidden>Finished files</p>
<ul id="files" hidden></ul>
<footer id="footer" hidden><a id="open" class="button" href="#" target="_blank" rel="noopener">Open in Takewon</a></footer>
<script>
(function () {
  var nextId = 1, pending = {}, runId = null, timer = null, seenAt = Date.now(), clock = null, last = null;
  var WORDS = { running: "Running", waiting: "Waiting for an approval", done: "Done", failed: "Failed", cancelled: "Cancelled" };
  var NOTES = { waiting_approval: "Waiting for someone to approve it in Takewon", skipped: "Skipped" };
  var ICONS = {
    done: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5 8.2l2 2 4-4.4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    running: '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="1.6"/><path d="M8 1.8a6.2 6.2 0 0 1 6.2 6.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    pending: '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2.4 2.4"/>',
    waiting: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M6.3 5.2v5.6M9.7 5.2v5.6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>',
    failed: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>',
    file: '<rect x="2.5" y="3" width="11" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M7 6.2v3.6l3-1.8z" fill="currentColor"/>'
  };
  ICONS.skipped = ICONS.pending; ICONS.cancelled = ICONS.failed; ICONS.waiting_approval = ICONS.waiting;
  function send(message) { window.parent.postMessage(message, "*"); }
  function request(method, params) {
    var id = nextId++;
    send({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    return new Promise(function (resolve, reject) { pending[id] = { resolve: resolve, reject: reject }; });
  }
  function el(tag, cls, text) { var node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; }
  function icon(kind) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("class", "icon"); svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = ICONS[kind] || ICONS.pending;
    return svg;
  }
  function size() { send({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: Math.ceil(document.documentElement.getBoundingClientRect().height) } }); }
  function took(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? s + "s" : Math.floor(s / 60) + "m " + (s % 60) + "s";
  }
  function fileName(url) {
    var name = String(url).split("?")[0].split("#")[0].split("/").pop() || String(url);
    try { return decodeURIComponent(name); } catch (e) { return name; }
  }
  function link(node, url) {
    node.href = url;
    node.onclick = function (event) {
      event.preventDefault();
      request("ui/open-link", { url: url }).catch(function () { window.open(url, "_blank", "noopener"); });
    };
  }
  function live(run) { return run.status === "running" || run.status === "waiting"; }
  function detail(run) {
    var steps = run.steps || [];
    var done = steps.filter(function (s) { return s.status === "done" || s.status === "skipped"; }).length;
    var start = run.started_at ? Date.parse(run.started_at) : seenAt;
    var end = run.finished_at ? Date.parse(run.finished_at) : Date.now();
    var parts = [];
    if (run.status === "done") parts.push(steps.length + (steps.length === 1 ? " step" : " steps"));
    else if (live(run) && steps.length) parts.push("step " + Math.min(done + 1, steps.length) + " of " + steps.length);
    if (run.status !== "waiting") parts.push(took(end - start));
    return parts.length ? " · " + parts.join(" · ") : "";
  }
  function show(run) {
    if (!run || typeof run !== "object") return;
    last = run;
    if (run.run_id) runId = run.run_id;
    var steps = run.steps || [];
    document.getElementById("title").textContent = run.automation || "Run";
    var status = document.getElementById("status");
    status.textContent = WORDS[run.status] || run.status || "";
    status.className = "status " + (run.status || "");
    document.getElementById("detail").textContent = detail(run);

    var bar = document.getElementById("bar");
    bar.hidden = !live(run);
    var finished = steps.filter(function (s) { return s.status === "done" || s.status === "skipped"; }).length;
    bar.firstChild.style.width = (steps.length ? Math.max(4, (finished / steps.length) * 100) : 4) + "%";

    // A finished run shows what it made; the steps only matter while it goes or when one fails.
    var list = document.getElementById("steps");
    list.textContent = "";
    var rows = run.status === "done" ? [] : steps.length ? steps : live(run) ? [{ step: "Starting the first step", status: "running" }] : [];
    rows.forEach(function (step) {
      var item = el("li", step.status);
      item.appendChild(icon(step.status));
      var name = el("div", "name", step.step);
      var note = step.error || NOTES[step.status];
      if (note) name.appendChild(el("span", "note", note));
      item.appendChild(name);
      list.appendChild(item);
    });
    list.hidden = !rows.length;

    var files = document.getElementById("files");
    files.textContent = "";
    var urls = run.files || [];
    urls.slice(0, 6).forEach(function (url) {
      var item = el("li"), a = el("a");
      a.appendChild(icon("file"));
      a.appendChild(el("span", "file", fileName(url)));
      a.appendChild(el("span", "open", "Open"));
      link(a, url);
      item.appendChild(a);
      files.appendChild(item);
    });
    if (urls.length > 6) files.appendChild(el("li", "more", "And " + (urls.length - 6) + " more in Takewon"));
    files.hidden = document.getElementById("files-label").hidden = !urls.length;

    var open = document.getElementById("open");
    document.getElementById("footer").hidden = !run.address;
    if (run.address) {
      link(open, run.address);
      open.textContent = run.status === "waiting" ? "Review in Takewon" : "Open in Takewon";
      open.className = "button" + (run.status === "waiting" ? " primary" : "");
    }
    size();
    clearTimeout(timer); clearInterval(clock);
    if (runId && live(run)) {
      timer = setTimeout(poll, steps.length ? 4000 : 1500);
      clock = setInterval(function () { document.getElementById("detail").textContent = detail(last); }, 1000);
    }
  }
  function fromResult(result) {
    if (!result) return null;
    if (result.structuredContent) return result.structuredContent;
    try { return JSON.parse(result.content[0].text); } catch (e) { return null; }
  }
  function poll() {
    request("tools/call", { name: "check_run", arguments: { run_id: runId } })
      .then(function (result) { var run = fromResult(result); if (run) { run.address = run.address || (last && last.address); } show(run); })
      .catch(function () { timer = setTimeout(poll, 10000); });
  }
  function theme(context) {
    if (!context) return;
    if (context.theme) document.documentElement.setAttribute("data-theme", context.theme);
    var vars = context.styles && context.styles.variables;
    if (vars) Object.keys(vars).forEach(function (key) { if (/^--[A-Za-z0-9_-]+$/.test(key) && vars[key]) document.documentElement.style.setProperty(key, String(vars[key])); });
  }
  window.addEventListener("message", function (event) {
    var message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.id != null && pending[message.id] && !message.method) {
      var waiting = pending[message.id]; delete pending[message.id];
      if (message.error) waiting.reject(message.error); else waiting.resolve(message.result);
      return;
    }
    if (message.method === "ui/notifications/tool-result") show(fromResult(message.params));
    if (message.method === "ui/notifications/host-context-changed") theme(message.params);
    if (message.method === "ui/resource-teardown" && message.id != null) {
      clearTimeout(timer); clearInterval(clock);
      send({ jsonrpc: "2.0", id: message.id, result: {} });
    }
  });
  request("ui/initialize", {
    appInfo: { name: "Run progress", version: "1.1.0" },
    appCapabilities: {},
    protocolVersion: "2026-01-26"
  }).then(function (result) {
    theme(result && result.hostContext);
    send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
    size();
  });
})();
</script>
</body>
</html>
`;

export const APPS: McpResource[] = [
  {
    uri: RUN_APP_URI,
    name: "run.html",
    title: "Run progress",
    description: "A run's steps as they go.",
    mimeType: APP_MIME_TYPE,
    text: RUN_APP_HTML,
    _meta: { ui: { csp: {}, prefersBorder: true } },
  },
];
