"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Check, Eye, Lock, Play, Workflow } from "lucide-react";
import { type ReactNode, useState } from "react";

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
import { errorMessage } from "@/lib/catalog";

import { AuthCard } from "./auth-card";

/**
 * Where an AI agent (an MCP client such as ChatGPT, Claude or Cursor) sends someone to let it
 * in. They pick the team it works on and allow it; it then acts as them on that team.
 * Someone signed out signs in first and comes straight back here.
 */
export function ConnectAgent() {
  const { requestId } = useParams<{ requestId: string }>();
  const asked = useQuery(api.oauth.request, { requestId });
  const decide = useMutation(api.oauth.decide);
  const [team, setTeam] = useState<string | null>(null);
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const session = authClient.useSession();
  const router = useRouter();

  // The question waits for the sign-in check, so a signed-in person never sees "Sign in".
  if (session.isPending || asked === undefined) return <FullPageLoader />;
  // Signed in, while the backend is still being handed the sign-in.
  if (session.data?.user && asked.status === "signed-out") return <FullPageLoader />;

  const here = encodeURIComponent(`/connect/${requestId}`);
  if (!session.data?.user || asked.status === "signed-out") {
    return (
      <AuthCard
        title="Connect an app"
        description="Sign in to choose which of your teams it can work with."
      >
        <div className="flex flex-col gap-2">
          <Button asChild>
            <Link href={`/sign-in?next=${here}`}>Sign in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/sign-up?next=${here}`}>Create an account</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  if (asked.status === "gone") {
    return (
      <AuthCard
        title="This link has expired"
        description="Start connecting again from the app. Each link works once, for 15 minutes."
      >
        <Button asChild variant="outline" className="w-full">
          <Link href="/">Go to the dashboard</Link>
        </Button>
      </AuthCard>
    );
  }

  const { clientName, clientHost, redirectHost, teams } = asked;
  const chosen = team ?? (teams.length === 1 ? teams[0].id : null);

  async function answer(allow: boolean) {
    setPending(allow ? "allow" : "deny");
    setProblem(null);
    try {
      const { redirectTo } = await decide({
        requestId,
        allow,
        ...(allow && chosen ? { organizationId: chosen } : {}),
      });
      window.location.assign(redirectTo);
    } catch (caught) {
      setPending(null);
      setProblem(errorMessage(caught, "That did not work. Try again from the app."));
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

  const user = session.data.user;
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
                router.push(`/sign-in?next=${here}`);
              }}
            >
              Not you?
            </button>
          </p>
        </div>

        <div className="bg-background flex flex-col gap-6 rounded-2xl p-6 shadow-sm">
          {teams.length > 1 && (
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
