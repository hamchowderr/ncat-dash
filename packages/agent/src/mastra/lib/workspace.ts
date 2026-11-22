/**
 * # Shared Workspace (filesystem + sandbox + browser)
 *
 * ONE workspace instance for the whole server, used by BOTH:
 *   - the chat Agent (`chatAgent.workspace`) — so Mastra Studio surfaces the workspace
 *     + its tools on the registered agent, matching the official template-agent-harness
 *     (698.31), and
 *   - the AgentController (`createChatAgentController`) — the session that drives our
 *     custom UI.
 *
 * Sharing ONE instance (rather than constructing one per surface) is what "no double
 * provision" means: the filesystem/sandbox/browser initialize once, and the browser it
 * carries is the SAME Chrome the `/browser/screencast` route streams.
 *
 * The per-tool approval policy (698.21) lives here so both surfaces inherit it: write/
 * edit require a prior read of the file (`requireReadBeforeWrite`), delete requires
 * explicit approval (`requireApproval`). NOTE: under the AgentController every tool is
 * ALSO gated by the controller's global approval (HITL) — these declarative controls are
 * what protects a workspace used OUTSIDE the controller (e.g. Studio), and encode intent.
 *
 * This module deliberately imports neither the agent nor the controller, so both can import
 * it without a cycle.
 */

import path from 'node:path';
import { BrowserViewer } from '@mastra/browser-viewer';
import type { MastraBrowser } from '@mastra/core/browser';
import { MASTRA_RESOURCE_ID_KEY } from '@mastra/core/request-context';
import { LocalFilesystem, LocalSandbox, WORKSPACE_TOOLS, Workspace } from '@mastra/core/workspace';
import { env } from '../../lib/env';
import { TURN_USER_KEY } from './turn-user';
import { type ChatFeatures, features as defaultFeatures } from './features';

// Absolute root for the agent's workspace (filesystem + sandbox share it). Under
// `mastra dev` the cwd shifts, so resolve a relative WORKSPACE_ROOT once here.
// Exported so the /workspace/* routes can read the same folder the agent works in.
export const WORKSPACE_ROOT = path.isAbsolute(env.WORKSPACE_ROOT)
  ? env.WORKSPACE_ROOT
  : path.resolve(process.cwd(), env.WORKSPACE_ROOT);

/**
 * Build the workspace's browser: a `BrowserViewer` (a `MastraBrowser`) that owns a
 * Playwright-driven Chrome and injects its CDP URL into the CLI the agent shells out to
 * (`agent-browser` by default), so shell-driven and native browser tools drive the SAME
 * window. Construction is cheap — Chrome launches lazily on first use, so this stays off
 * the boot/AIMock/test path until a browser tool actually fires.
 */
export function createBrowser(): BrowserViewer {
  return new BrowserViewer({
    cli: env.BROWSER_CLI,
    headless: env.BROWSER_HEADLESS,
    ...(env.BROWSER_EXECUTABLE_PATH ? { executablePath: env.BROWSER_EXECUTABLE_PATH } : {}),
  });
}

let browserSingleton: BrowserViewer | null = null;
/** The process-wide browser the live workspace uses (exposed for the screencast route). */
export function getChatBrowserInstance(): BrowserViewer {
  if (!browserSingleton) {
    browserSingleton = createBrowser();
  }
  return browserSingleton;
}

/**
 * The kit's workspace: filesystem + sandbox rooted at one folder, with its safety
 * policy. The ONE place that policy lives, so tests that pass a temp `root`
 * exercise the same rules the live app runs with.
 *
 * `features` (lib/features.ts) decides what it carries: the filesystem always, and the
 * sandbox and browser each behind their own switch. Plan mode writes its plan file here
 * with the write_file tool (Mastra's submit_plan takes that file's path).
 */
export function createChatWorkspace({
  root = WORKSPACE_ROOT,
  browser,
  features = defaultFeatures,
}: {
  root?: string;
  browser?: MastraBrowser;
  features?: ChatFeatures;
} = {}): Workspace {
  return new Workspace({
    id: 'chat-workspace',
    filesystem: new LocalFilesystem({ basePath: root }),
    ...(features.sandbox ? { sandbox: new LocalSandbox({ workingDirectory: root }) } : {}),
    // Only the viewer goes in the workspace; the Firecrawl browser sits on the controller.
    ...(browser && features.browser === 'viewer' ? { browser } : {}),
    // Per-tool safety policy (698.21). requireReadBeforeWrite forces the agent to read
    // a file before overwriting/editing it; delete always needs explicit approval.
    tools: {
      [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: { requireReadBeforeWrite: true },
      [WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]: { requireReadBeforeWrite: true },
      [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: { requireApproval: true },
    },
  });
}

let workspaceSingleton: Workspace | null = null;
/**
 * The process-wide shared workspace. Lazily constructed; the browser launches lazily on
 * first use, so importing this stays cheap. Tests don't call this: they pass
 * `createChatWorkspace({ root })` a temp folder, and the chat agent's own workspace is
 * off under NODE_ENV=test, so runs stay hermetic.
 */
export function getChatWorkspace(): Workspace {
  if (!workspaceSingleton) {
    workspaceSingleton = createChatWorkspace(
      defaultFeatures.browser === 'viewer' ? { browser: getChatBrowserInstance() } : {},
    );
  }
  return workspaceSingleton;
}

// ── One workspace per team ────────────────────────────────────────────────
// On a server with sign-in (MASTRA_JWT_SECRET), every team gets its own folder under
// WORKSPACE_ROOT/teams/<team>, so one team's agent never reads or writes another team's
// files. The team comes from the resource id the web server signs (`<person>~<team>`,
// chatOwnerId in src/lib/agent-session.ts), never from anything the person typed. A
// resource with no team (a chat-app thread, a person with no team open) gets no
// workspace at all. Without sign-in there is one shared user and WORKSPACE_ROOT itself.

/** A team id safe to use as one folder name. */
const SAFE_TEAM = /^[A-Za-z0-9_-]{1,64}$/;

/** The team a resource id belongs to (`<person>~<team>`), or null. */
export function workspaceTeamOf(resourceId: string | undefined): string | null {
  if (!resourceId || resourceId.startsWith('channel:')) return null;
  const cut = resourceId.lastIndexOf('~');
  if (cut <= 0) return null;
  const team = resourceId.slice(cut + 1);
  return SAFE_TEAM.test(team) ? team : null;
}

/**
 * The folder a resource's workspace lives in, or null when it gets none. `signedIn`
 * defaults to whether this server runs with MASTRA_JWT_SECRET.
 */
export function workspaceRootFor(
  resourceId: string | undefined,
  { root = WORKSPACE_ROOT, signedIn = Boolean(env.MASTRA_JWT_SECRET) } = {},
): string | null {
  if (!signedIn) return root;
  const team = workspaceTeamOf(resourceId);
  return team ? path.join(root, 'teams', team) : null;
}

/** Whose turn a request context is for: the controller session's resource, else the turn user. */
function resourceIdOfContext(requestContext: { get(key: string): unknown } | undefined) {
  if (!requestContext) return undefined;
  const controller = requestContext.get('controller') as { resourceId?: unknown } | undefined;
  for (const id of [
    controller?.resourceId,
    requestContext.get(TURN_USER_KEY),
    requestContext.get(MASTRA_RESOURCE_ID_KEY),
  ]) {
    if (typeof id === 'string' && id) return id;
  }
  return undefined;
}

const teamWorkspaces = new Map<string, Workspace>();

/**
 * The workspace a request runs against: the team's own, the shared one without sign-in,
 * or none. Used as the controller's and the chat agent's workspace factory.
 */
export function chatWorkspaceFor(
  requestContext: { get(key: string): unknown } | undefined,
): Workspace | undefined {
  const root = workspaceRootFor(resourceIdOfContext(requestContext));
  if (!root) return undefined;
  if (root === WORKSPACE_ROOT) return getChatWorkspace();
  let workspace = teamWorkspaces.get(root);
  if (!workspace) {
    // No browser: the viewer is one Chrome for the whole server, so it stays with the
    // single-user workspace.
    workspace = createChatWorkspace({ root });
    teamWorkspaces.set(root, workspace);
  }
  return workspace;
}
