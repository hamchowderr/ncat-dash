import { toolkitHealth } from "@takewon/step-catalog";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { ToolkitState } from "./history";
import type { RunView } from "./timings";

/** What the test needs from a Takewon copy. Tests pass a stand-in. */
export interface Backend {
  /** The automation the test keeps for a ready-made, made from it the first time. */
  automationFor(readyMadeId: string, name: string): Promise<string>;
  /** Starts a run of it on a video, as Run now with a file address does. */
  start(automationId: string, fileUrl: string): Promise<string>;
  run(runId: string): Promise<RunView | null>;
  cancel(runId: string): Promise<void>;
  /** How busy the toolkit is, or null when the test can't ask it. */
  toolkit(): Promise<ToolkitState | null>;
}

type Fetch = typeof fetch;

export interface SignIn {
  /** The Convex HTTP actions address, where sign-in lives (…convex.site, or your own). */
  siteUrl: string;
  /** The dashboard's own address, which sign-in checks requests come from. */
  dashboardUrl: string;
  email: string;
  password: string;
  fetch?: Fetch;
}

const trim = (url: string) => url.replace(/\/+$/, "");

/** The cookies a response set, as one Cookie header. */
function cookiesOf(response: Response): string {
  const all =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : (response.headers.get("set-cookie") ?? "").split(/,(?=[^;]+=)/);
  return all
    .map((cookie) => cookie.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

/**
 * Signs in with email and password and returns a token for Convex. Tokens last about a
 * quarter of an hour, so the test signs in again for each run.
 */
export async function signIn(options: SignIn): Promise<string> {
  const doFetch = options.fetch ?? fetch;
  const site = trim(options.siteUrl);
  const origin = new URL(options.dashboardUrl).origin;
  const signedIn = await doFetch(`${site}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email: options.email, password: options.password }),
  });
  if (!signedIn.ok) {
    throw new Error(
      `Sign-in was refused (${signedIn.status}): ${(await signedIn.text()).slice(0, 200)}`,
    );
  }
  const cookie = cookiesOf(signedIn);
  const tokenResponse = await doFetch(`${site}/api/auth/convex/token`, {
    headers: { Cookie: cookie, Origin: origin },
  });
  const body = (await tokenResponse.json().catch(() => null)) as { token?: string } | null;
  if (!tokenResponse.ok || !body?.token) {
    throw new Error(`Signed in, but no Convex token came back (${tokenResponse.status}).`);
  }
  return body.token;
}

export interface TakewonOptions {
  convexUrl: string;
  /** A fresh Convex token each time it is asked. */
  token: () => Promise<string>;
  /** The team to run on, by name or id. The account's only team when left out. */
  team?: string;
  /** The toolkit itself, to read how busy it is before each run. Optional. */
  toolkit?: { baseUrl: string; apiKey: string };
  fetch?: Fetch;
}

/** Talks to a Takewon copy as a signed-in member of the team. */
export async function takewonBackend(options: TakewonOptions): Promise<Backend> {
  const client = new ConvexHttpClient(options.convexUrl);
  const api = anyApi;
  let tokenAt = 0;
  const authed = async () => {
    if (Date.now() - tokenAt > 10 * 60 * 1000) {
      client.setAuth(await options.token());
      tokenAt = Date.now();
    }
    return client;
  };
  const teams = ((await (await authed()).query(api.teams.mine, {})) ?? []) as {
    id: string;
    name: string;
  }[];
  const team = options.team
    ? teams.find((t) => t.id === options.team || t.name === options.team)
    : teams.length === 1
      ? teams[0]
      : undefined;
  if (!team) {
    throw new Error(
      teams.length === 0
        ? "The account is on no team. Sign in once in the dashboard and make one."
        : `Say which team to use (TAKEWON_TEAM). This account is on: ${teams.map((t) => t.name).join(", ")}.`,
    );
  }
  const organizationId = team.id;
  return {
    async automationFor(readyMadeId, name) {
      const existing = (await (
        await authed()
      ).query(api.automations.list, {
        organizationId,
      })) as { _id: string; name: string }[];
      const found = existing.find((automation) => automation.name === name);
      if (found) return found._id;
      return (await (
        await authed()
      ).mutation(api.automations.create, {
        organizationId,
        name,
        starterId: readyMadeId,
      })) as string;
    },
    async start(automationId, fileUrl) {
      return (await (
        await authed()
      ).mutation(api.automations.runNow, {
        automationId,
        fileUrl,
      })) as string;
    },
    async run(runId) {
      return (await (await authed()).query(api.runs.get, { runId })) as RunView | null;
    },
    async cancel(runId) {
      await (await authed()).mutation(api.runs.cancel, { runId });
    },
    async toolkit() {
      if (!options.toolkit) return null;
      const result = await toolkitHealth(options.toolkit, {
        signal: AbortSignal.timeout(20_000),
        fetch: options.fetch,
      });
      if (!result.ok) return null;
      return {
        build: result.health.buildNumber,
        cpus: result.health.cpus,
        cpuPercent: result.health.cpuPercent,
        jobsRunning: Math.max(result.health.jobs.running, result.health.queue.busy ?? 0),
      };
    },
  };
}
