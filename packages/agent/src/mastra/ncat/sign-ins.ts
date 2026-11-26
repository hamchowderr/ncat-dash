import { Firecrawl } from "firecrawl";
import { z } from "zod";
import { env } from "../../lib/env";

/**
 * # A team's saved sign-ins for page recordings
 *
 * Some pages a storyboard records are only there once someone is signed in: a team's
 * admin page, a dashboard. The person signs in once themselves, in a Firecrawl browser
 * session they drive from their own screen (Firecrawl's interactive live view), and the
 * session is kept as a named Firecrawl profile: its cookies and local storage. Page
 * recordings for the team then open that profile read-only (./page-recording.ts).
 *
 * The password is typed by the person into the site itself and never passes through the
 * dashboard, this server or the model. This follows Firecrawl's and Mastra's own advice:
 * sign in once with `saveChanges: true`, then use the profile with `saveChanges: false`,
 * so only one session ever writes to it.
 *
 * Firecrawl saves the profile when the session ends, so `finishSignIn` ends it.
 */

export const startSignInRequest = z.object({
  organizationId: z.string().min(1).max(200),
  /** The Firecrawl profile to save into, made by the dashboard (one per saved sign-in). */
  profile: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9_-]+$/),
  /** The page to open first: the site's sign-in page. */
  url: z.string().url().max(2000),
});

export const finishSignInRequest = z.object({
  sessionId: z.string().min(1).max(200),
});

/** How long the person has to sign in, in seconds. */
const SIGN_IN_TTL = 15 * 60;
const SIGN_IN_IDLE_TTL = 10 * 60;

export class SignInProblem extends Error {}

type Client = Pick<Firecrawl, "browser" | "browserExecute" | "deleteBrowser">;

function firecrawl(): Client {
  if (!env.FIRECRAWL_API_KEY) {
    throw new SignInProblem(
      "Saved sign-ins need a Firecrawl key on the agent server (FIRECRAWL_API_KEY).",
    );
  }
  return new Firecrawl({ apiKey: env.FIRECRAWL_API_KEY, apiUrl: env.FIRECRAWL_API_URL });
}

let client: () => Client = firecrawl;

/** For tests: answer for Firecrawl. Pass nothing to undo. */
export function useFirecrawlForTests(stand?: () => Client): void {
  client = stand ?? firecrawl;
}

/**
 * Opens a browser session that saves into the profile, on the sign-in page, and gives the
 * link the person drives it from.
 */
export async function startSignIn(
  request: z.infer<typeof startSignInRequest>,
): Promise<{ sessionId: string; liveViewUrl: string; expiresAt: string | null }> {
  const fc = client();
  const session = await fc.browser({
    ttl: SIGN_IN_TTL,
    activityTtl: SIGN_IN_IDLE_TTL,
    profile: { name: request.profile, saveChanges: true },
  });
  const liveViewUrl = session.interactiveLiveViewUrl ?? null;
  if (!session.success || !session.id || !liveViewUrl) {
    if (session.id) await fc.deleteBrowser(session.id).catch(() => undefined);
    throw new SignInProblem(session.error ?? "Firecrawl did not open a browser to sign in with.");
  }
  // Open the sign-in page in the session, so the person lands on it.
  await fc
    .browserExecute(session.id, {
      code: `await page.goto(${JSON.stringify(request.url)}, { waitUntil: "domcontentloaded" });`,
      language: "node",
      timeout: 30,
    })
    .catch(() => undefined);
  return { sessionId: session.id, liveViewUrl, expiresAt: session.expiresAt ?? null };
}

/** Ends the session, which is when Firecrawl saves the profile. */
export async function finishSignIn(request: z.infer<typeof finishSignInRequest>): Promise<void> {
  const answer = await client().deleteBrowser(request.sessionId);
  if (!answer.success) {
    throw new SignInProblem(answer.error ?? "Firecrawl did not close the sign-in browser.");
  }
}
