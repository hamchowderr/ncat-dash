import type { ComputeStateSignalArgs, InputProcessor } from "@mastra/core/processors";
import { dash, dashFor, NotConnected } from "./convex";
import { type DashSession, sessionOf } from "./session-store";

/**
 * What the person has open in the dashboard, kept in the conversation as a Mastra state
 * signal (lane `screen`).
 *
 * The dashboard says which page is on screen with each chat request (the `screen` the web
 * app hands to POST /ncat/session). This processor turns that into a few plain lines,
 * read as the person from the dashboard's `agentScreen.describe` (an automation, its
 * client and what starts it; a run and the file it ran on; a video's length, shape,
 * frame rate and sound), and hands them to the model as `<state type="screen">`.
 *
 * It sends a new snapshot only when the screen changes, or when the last one has left
 * the model's context, so an unchanged screen costs nothing more and the prompt cache
 * stays warm. Chats in Slack, Discord, Teams and Telegram have no screen, so they get
 * none.
 */
export const SCREEN_STATE_ID = "screen";

const NOTHING_OPEN = "none";

/** What the cache key is for a session: the team and the thing on screen. */
export function screenKey(session: Pick<DashSession, "organizationId" | "screen">): string {
  const screen = session.screen;
  if (!screen || !session.organizationId) return NOTHING_OPEN;
  return `${session.organizationId}/${screen.kind}/${screen.id}`;
}

type Describe = (
  resourceId: string,
  session: DashSession,
) => Promise<string | null>;

const describeFromDashboard: Describe = async (resourceId, session) => {
  if (!session.screen || !session.organizationId) return null;
  const { client } = dashFor(resourceId);
  return (await client.query(dash.agentScreen.describe, {
    organizationId: session.organizationId,
    kind: session.screen.kind,
    id: session.screen.id,
  })) as string | null;
};

let describe: Describe = describeFromDashboard;

/** For tests: answer the description without a dashboard. Pass nothing to undo. */
export function useScreenDescriptionForTests(answer?: Describe): void {
  describe = answer ?? describeFromDashboard;
}

type ScreenArgs = Pick<
  ComputeStateSignalArgs,
  "resourceId" | "contextWindow" | "tracking"
>;

/** The state signal for this step, or nothing when the model already has the current one. */
export async function screenSignal({ resourceId, contextWindow, tracking }: ScreenArgs) {
  const session = sessionOf(resourceId);
  if (!session) return undefined;
  const key = screenKey(session);
  const sent = tracking?.currentCacheKey;
  if (sent === key && contextWindow.hasSnapshot) return undefined;

  if (key === NOTHING_OPEN) {
    // Nothing was ever said about the screen: there is nothing to take back.
    if (!sent || sent === NOTHING_OPEN) return undefined;
    return {
      mode: "snapshot" as const,
      cacheKey: NOTHING_OPEN,
      contents:
        "The person no longer has one automation, run or file open: they are on a list or a settings page.",
    };
  }

  let text: string | null = null;
  try {
    text = await describe(resourceId, session);
  } catch (caught) {
    // A dashboard that cannot be reached leaves the bare fact of what is open.
    if (!(caught instanceof NotConnected)) console.warn("[screen] could not describe", caught);
  }
  const screen = session.screen!;
  return {
    mode: "snapshot" as const,
    cacheKey: key,
    contents:
      text ??
      `What the person has open in the dashboard right now: a ${screen.kind} (id ${screen.id}).`,
    value: screen,
  };
}

export const screenStateProcessor: InputProcessor = {
  id: "screen-state",
  stateId: SCREEN_STATE_ID,
  computeStateSignal: (args) => screenSignal(args),
};
