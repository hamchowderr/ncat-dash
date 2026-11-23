/**
 * What the dashboard last told us about each signed-in person: the token that lets us
 * act in Convex as them, the team they have open and the automation on their screen.
 *
 * The web app posts this to POST /ncat/session just before it forwards a chat request
 * (src/lib/agent-session.ts in the web app), so a tool that runs during that turn finds it
 * here. Nothing is written to disk: a token lives a few minutes and a restart only means
 * the next chat request sends it again.
 */
/** The kinds of thing a dashboard page can be about (convex/agentScreen.ts). */
export const SCREEN_KINDS = [
  "automation",
  "run",
  "library",
  "project",
  "client",
  "review",
  "creator",
] as const;

/** The one thing the page on the person's screen is about, when it is about one. */
export type DashScreen = { kind: (typeof SCREEN_KINDS)[number]; id: string };

export type DashSession = {
  convexToken: string;
  organizationId: string | null;
  automationId: string | null;
  /** Left out by callers that only know the automation (the chat apps, older tests). */
  screen?: DashScreen | null;
  /** The automation the agent last made for them, used when none is on their screen. */
  madeAutomationId: string | null;
  at: number;
};

const sessions = new Map<string, DashSession>();

/**
 * The dashboard person a resource id stands for, or null when it is not one (a Slack,
 * Discord, Teams or Telegram thread, whose resource is `channel:<thread>`).
 *
 * The dashboard names a chat's owner `<person>~<team>` (`chatOwnerId` in the web app's
 * src/lib/agent-session.ts) so that memory, which is kept per resource, stays apart per
 * team. With no team open it is the person's id alone.
 */
export function personOf(resourceId: string): string | null {
  if (resourceId.startsWith("channel:")) return null;
  const cut = resourceId.lastIndexOf("~");
  return cut > 0 ? resourceId.slice(0, cut) : resourceId;
}

/** A Convex token is short-lived; one older than this is not worth trying. */
const MAX_AGE_MS = 30 * 60 * 1000;

export function rememberSession(
  userId: string,
  session: Omit<DashSession, "at" | "madeAutomationId">,
): void {
  const madeAutomationId = sessions.get(userId)?.madeAutomationId ?? null;
  sessions.set(userId, { ...session, madeAutomationId, at: Date.now() });
}

/** The agent made an automation: "this automation" now means it, unless another is on screen. */
export function rememberMade(userId: string, automationId: string): void {
  const session = sessions.get(userId);
  if (session) session.madeAutomationId = automationId;
}

/** The automation a tool should work on when it was not given one. */
export function workingAutomationOf(session: DashSession): string | null {
  return session.automationId ?? session.madeAutomationId;
}

export function sessionOf(userId: string | undefined): DashSession | null {
  if (!userId) return null;
  const session = sessions.get(userId);
  if (!session) return null;
  if (Date.now() - session.at > MAX_AGE_MS) {
    sessions.delete(userId);
    return null;
  }
  return session;
}

/** For tests. */
export function forgetSessions(): void {
  sessions.clear();
}
