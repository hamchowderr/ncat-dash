"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Eye, Lock, Play, Workflow } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { FullPageLoader } from "@/components/full-page-loader";
import { clientLogo } from "@/components/mcp-client-logos";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { authClient } from "@/lib/auth-client";

import { AuthCard } from "./auth-card";

/**
 * Where an AI agent (an MCP client such as ChatGPT, Claude or Cursor) sends someone to let it
 * in. Better Auth runs the sign-in (convex/auth.ts, mcp()): it sends the person here with a
 * signed copy of the agent's request. On /connect/team they pick the team it works on and
 * allow it; /connect asks only to allow it, for the team already picked. Someone signed out
 * signs in first and comes straight back. The agent then acts as them on that team.
 */
export function ConnectAgent({ step }: { step: "team" | "consent" }) {
  const search = useSearchParams();
  const query = search.toString();
  const clientId = search.get("client_id");
  const redirectHost = hostOf(search.get("redirect_uri"));
  const signed = Boolean(clientId && search.get("sig"));

  const session = authClient.useSession();
  const teamsQuery = authClient.useListOrganizations();
  const router = useRouter();
  const [client, setClient] = useState<{ name: string; host: string | null } | null>(null);
  const [team, setTeam] = useState<string | null>(null);
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const signedIn = Boolean(session.data?.user);
  useEffect(() => {
    if (!signedIn || !clientId) return;
    let cancelled = false;
    void (async () => {
      const found = await authCall<{ client_name?: string; client_uri?: string }>(
        `/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`,
      ).catch(() => null);
      if (cancelled) return;
      setClient({
        name: found?.client_name || hostOf(clientId) || "An app",
        host: hostOf(found?.client_uri ?? null) ?? hostOf(clientId),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn, clientId]);

  if (session.isPending) return <FullPageLoader />;

  const here = encodeURIComponent(`/connect${step === "team" ? "/team" : ""}?${query}`);
  if (!signedIn) {
    return (
      <AuthCard
        title="Connect an app"
        description="Sign in to choose which of your teams it can work with."
      >
        <div className="flex flex-col gap-2">
          <Button asChild>
            <Link href={`/sign-in?redirectTo=${here}`}>Sign in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/sign-up?redirectTo=${here}`}>Create an account</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  if (!signed) {
    return (
      <AuthCard
        title="This link has expired"
        description="Start connecting again from the app. Each link works for 10 minutes."
      >
        <Button asChild variant="outline" className="w-full">
          <Link href="/">Go to the dashboard</Link>
        </Button>
      </AuthCard>
    );
  }

  if (teamsQuery.isPending || client === null) return <FullPageLoader />;

  const activeTeam = session.data?.session.activeOrganizationId ?? null;
  const allTeams = (teamsQuery.data ?? []).map((each) => ({ id: each.id, name: each.name }));
  // On /connect the team was already picked: it is the active one.
  const teams = step === "team" ? allTeams : allTeams.filter((each) => each.id === activeTeam);
  const chosen = team ?? (teams.length === 1 ? teams[0].id : null);
  const clientName = client.name;
  const clientHost = client.host;

  async function answer(allow: boolean) {
    setPending(allow ? "allow" : "deny");
    setProblem(null);
    try {
      let url: string;
      if (!allow) {
        url = (
          await authCall<{ url: string }>("/oauth2/consent", { accept: false, oauth_query: query })
        ).url;
      } else if (step === "team") {
        const picked = await authClient.organization.setActive({ organizationId: chosen });
        if (picked.error) throw new Error(picked.error.message);
        url = (
          await authCall<{ url: string }>("/oauth2/continue", {
            postLogin: true,
            oauth_query: query,
          })
        ).url;
        // Not allowed before on this team: allow it now, as the person just asked.
        if (url.startsWith("/connect?")) {
          url = (
            await authCall<{ url: string }>("/oauth2/consent", {
              accept: true,
              oauth_query: url.slice("/connect?".length),
            })
          ).url;
        }
      } else {
        url = (
          await authCall<{ url: string }>("/oauth2/consent", { accept: true, oauth_query: query })
        ).url;
      }
      window.location.assign(url);
    } catch (caught) {
      setPending(null);
      setProblem(
        caught instanceof Error && caught.message
          ? caught.message
          : "That did not work. Try again from the app.",
      );
    }
  }

  if (teams.length === 0) {
    return (
      <AuthCard title="Connect an app" description="You are not on a team yet.">
        <Button asChild className="w-full">
          <Link href="/onboarding">Make a team</Link>
        </Button>
      </AuthCard>
    );
  }

  const user = session.data?.user;
  if (!user) return <FullPageLoader />;
  const chosenTeam = teams.find((each) => each.id === chosen);
  const mark = clientLogo(clientName, "size-7");

  return (
    <div className="bg-muted/40 flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <main className="flex w-full max-w-md flex-col gap-8">
        <div className="flex items-center justify-center gap-3">
          <span className="bg-background flex size-14 items-center justify-center rounded-2xl shadow-sm">
            {mark ?? (
              <span className="text-lg font-semibold">{clientName.slice(0, 1).toUpperCase()}</span>
            )}
          </span>
          <span className="flex items-center gap-1" aria-hidden>
            <span className="bg-muted-foreground/40 size-1 rounded-full" />
            <span className="bg-muted-foreground/40 size-1 rounded-full" />
            <span className="bg-emerald-500/90 flex size-5 items-center justify-center rounded-full text-white">
              <Check className="size-3" />
            </span>
            <span className="bg-muted-foreground/40 size-1 rounded-full" />
            <span className="bg-muted-foreground/40 size-1 rounded-full" />
          </span>
          <span
            aria-hidden
            className="bg-foreground text-background flex size-14 items-center justify-center rounded-2xl text-lg font-semibold shadow-sm"
          >
            {(chosenTeam?.name ?? "?").slice(0, 1).toUpperCase()}
          </span>
        </div>

        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-xl font-semibold tracking-tight">
            {clientName} wants to connect to{" "}
            {teams.length === 1 ? teams[0].name : "your automations"}
          </h1>
          <p className="text-muted-foreground text-sm">
            Signed in as <span className="text-foreground">{user.email}</span>.{" "}
            <button
              type="button"
              className="hover:text-foreground underline underline-offset-4"
              onClick={async () => {
                await authClient.signOut();
                router.push(`/sign-in?redirectTo=${here}`);
              }}
            >
              Not you?
            </button>
          </p>
        </div>

        <div className="bg-background flex flex-col gap-6 rounded-2xl p-6 shadow-sm">
          {step === "team" && teams.length > 1 && (
            <div className="flex flex-col gap-2">
              <label htmlFor="connect-team" className="text-sm font-medium">
                Team
              </label>
              <Select value={chosen ?? undefined} onValueChange={setTeam}>
                <SelectTrigger id="connect-team" className="w-full">
                  <SelectValue placeholder="Pick a team" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((each) => (
                    <SelectItem key={each.id} value={each.id}>
                      {each.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">{clientName} will be able to</p>
            <ul className="flex flex-col gap-3 text-sm" aria-label="What it can do">
              <Can icon={<Eye />}>See your automations, uploads and runs</Can>
              <Can icon={<Workflow />}>Build and change automations as drafts</Can>
              <Can icon={<Play />}>Start runs and follow them</Can>
              <Can icon={<Lock />} muted>
                It cannot publish drafts or switch automations on
              </Can>
            </ul>
          </div>

          {problem && (
            <Alert variant="destructive">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => answer(false)} disabled={pending !== null}>
              {pending === "deny" ? "Cancelling" : "Cancel"}
            </Button>
            <Button onClick={() => answer(true)} disabled={!chosen || pending !== null}>
              {pending === "allow" ? "Connecting" : "Allow"}
            </Button>
          </div>
        </div>

        <p className="text-muted-foreground text-center text-xs leading-relaxed">
          {clientHost ? `${clientName} is from ${clientHost}. ` : ""}Allowing sends you back to{" "}
          <span className="text-foreground">{redirectHost}</span>. Disconnect it any time in
          Settings, under MCP.
        </p>
      </main>
    </div>
  );
}

function Can({ icon, muted, children }: { icon: ReactNode; muted?: boolean; children: ReactNode }) {
  return (
    <li
      className={`flex items-center gap-3 ${muted ? "text-muted-foreground" : ""} [&_svg]:size-4 [&_svg]:shrink-0`}
    >
      <span className="text-muted-foreground">{icon}</span>
      {children}
    </li>
  );
}

/** A call to Better Auth's own endpoints, from the person's browser, following no redirect. */
async function authCall<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/auth${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const answer = (await response.json().catch(() => null)) as
    (T & { message?: string; error_description?: string }) | null;
  if (!response.ok || !answer) {
    throw new Error(
      answer?.error_description || answer?.message || "That did not work. Try again from the app.",
    );
  }
  return answer;
}

function hostOf(address: string | null): string | null {
  if (!address) return null;
  try {
    return new URL(address).host || null;
  } catch {
    return null;
  }
}
