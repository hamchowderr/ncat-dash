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
    'One change. op is one of: add (type, optional id, after, before, branch, settings, label, join), remove (ids), connect (source, target, optional branch "yes"/"no"/"failed"), disconnect (source, target), set (id, settings merged; null clears one), use (id, field, from: "auto", "trigger" or a step id), rename (id, label), switch (id, on), duplicate (ids), trigger (trigger: {kind, ...settings}, kind as in list_step_types without "trigger:"; optional id to change a trigger other than the first), addTrigger (trigger, optional starts: ids of steps nothing else feeds) adds another trigger with the id "__trigger_2" and up, removeTrigger (id), name (name), tidy. With several triggers, each run does only the steps its trigger starts: add a step with after set to a trigger id to start a branch from it, or connect a trigger id to a step nothing else feeds.',
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
 * seconds until the run ends. Plain HTML and script, nothing loaded from elsewhere.
 */
const RUN_APP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Run</title>
<style>
  :root { color-scheme: light; --text: var(--color-text-primary, #18181b); --muted: var(--color-text-secondary, #71717a);
    --line: var(--color-border-tertiary, #e4e4e7); --good: var(--color-text-success, #15803d); --bad: var(--color-text-danger, #b91c1c);
    --font: var(--font-sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif); }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 14px 16px; font: 14px/1.45 var(--font); color: var(--text); background: transparent; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  h1 { font-size: 15px; font-weight: 600; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status { font-size: 13px; color: var(--muted); white-space: nowrap; }
  .status.done { color: var(--good); } .status.failed { color: var(--bad); }
  ol { list-style: none; margin: 0; padding: 0; }
  li { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-top: 1px solid var(--line); }
  li:first-child { border-top: 0; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--line); flex: none; }
  .running .dot { background: #2563eb; animation: pulse 1.2s ease-in-out infinite; }
  .done .dot { background: var(--good); } .failed .dot { background: var(--bad); }
  .name { flex: 1; min-width: 0; } .note { color: var(--muted); font-size: 13px; }
  .error { color: var(--bad); font-size: 13px; margin-top: 2px; }
  .files { margin-top: 10px; font-size: 13px; color: var(--muted); }
  a { color: inherit; }
  @keyframes pulse { 50% { opacity: .35; } }
  @media (prefers-reduced-motion: reduce) { .running .dot { animation: none; } }
</style>
</head>
<body>
<header><h1 id="title">Run</h1><span id="status" class="status">Waiting for the run</span></header>
<ol id="steps"></ol>
<p id="files" class="files" hidden></p>
<script>
(function () {
  var nextId = 1, pending = {}, runId = null, timer = null;
  var WORDS = { running: "Running", waiting: "Waiting for an approval", done: "Done", failed: "Failed", cancelled: "Cancelled", pending: "Not started", skipped: "Skipped" };
  function send(message) { window.parent.postMessage(message, "*"); }
  function request(method, params) {
    var id = nextId++;
    send({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    return new Promise(function (resolve, reject) { pending[id] = { resolve: resolve, reject: reject }; });
  }
  function el(tag, cls, text) { var node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; }
  function size() { send({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: Math.ceil(document.body.getBoundingClientRect().height) } }); }
  function show(run) {
    if (!run || typeof run !== "object") return;
    if (run.run_id) runId = run.run_id;
    document.getElementById("title").textContent = run.automation || "Run";
    var status = document.getElementById("status");
    status.textContent = WORDS[run.status] || run.status || "";
    status.className = "status " + (run.status || "");
    var list = document.getElementById("steps");
    list.textContent = "";
    if (!(run.steps || []).length && (run.status === "running" || run.status === "waiting")) {
      var first = el("li", "running");
      first.appendChild(el("span", "dot"));
      first.appendChild(el("div", "name", "Starting the first step"));
      list.appendChild(first);
    }
    (run.steps || []).forEach(function (step) {
      var item = el("li", step.status);
      item.appendChild(el("span", "dot"));
      var name = el("div", "name", step.step);
      if (step.error) name.appendChild(el("div", "error", step.error));
      item.appendChild(name);
      item.appendChild(el("span", "note", step.files ? step.files + (step.files === 1 ? " file" : " files") : WORDS[step.status] || ""));
      list.appendChild(item);
    });
    var files = document.getElementById("files");
    if (run.files && run.files.length) {
      files.hidden = false;
      files.textContent = run.files.length + (run.files.length === 1 ? " finished file" : " finished files");
    } else files.hidden = true;
    size();
    clearTimeout(timer);
    if (runId && (run.status === "running" || run.status === "waiting")) timer = setTimeout(poll, (run.steps || []).length ? 4000 : 1500);
  }
  function fromResult(result) {
    if (!result) return null;
    if (result.structuredContent) return result.structuredContent;
    try { return JSON.parse(result.content[0].text); } catch (e) { return null; }
  }
  function poll() {
    request("tools/call", { name: "check_run", arguments: { run_id: runId } })
      .then(function (result) { show(fromResult(result)); })
      .catch(function () { timer = setTimeout(poll, 10000); });
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
    if (message.method === "ui/resource-teardown" && message.id != null) {
      clearTimeout(timer);
      send({ jsonrpc: "2.0", id: message.id, result: {} });
    }
  });
  request("ui/initialize", {
    appInfo: { name: "Run progress", version: "1.0.0" },
    appCapabilities: {},
    protocolVersion: "2026-01-26"
  }).then(function () { send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} }); size(); });
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
