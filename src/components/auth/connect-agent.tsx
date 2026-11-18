"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { FullPageLoader } from "@/components/full-page-loader";
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
 * Where an AI agent (a claude.ai connector, Claude Code, Cursor) sends someone to let it
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

  // The question waits for the sign-in check, so a signed-in person never sees "Sign in".
  if (session.isPending || asked === undefined) return <FullPageLoader />;
  // Signed in, while the backend is still being handed the sign-in.
  if (session.data?.user && asked.status === "signed-out") return <FullPageLoader />;

  const here = encodeURIComponent(`/connect/${requestId}`);
  if (!session.data?.user || asked.status === "signed-out") {
    return (
      <AuthCard
        title="Connect an AI agent"
        description="Sign in to choose which of your teams it can work on."
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
        description="Start connecting again from the agent. Each link works once, for 15 minutes."
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
      setProblem(errorMessage(caught, "That did not work. Try again from the agent."));
    }
  }

  if (teams.length === 0) {
    return (
      <AuthCard title="Connect an AI agent" description="You are not on a team yet.">
        <Button asChild className="w-full">
          <Link href="/onboarding">Make a team</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={`Connect ${clientName}`}
      description={`It will work as you on the team you pick: see its automations, uploads and runs, build and change automations as drafts, and start runs. It cannot publish drafts or switch automations on.`}
    >
      <div className="flex flex-col gap-5">
        {teams.length > 1 ? (
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
        ) : (
          <p className="text-sm">
            Team: <span className="font-medium">{teams[0].name}</span>
          </p>
        )}
        <p className="text-muted-foreground text-sm">
          {clientHost ? `${clientName} is from ${clientHost}. ` : ""}You will be sent back to{" "}
          <span className="text-foreground font-medium">{redirectHost}</span>. You can disconnect it
          any time in Settings, under AI agents.
        </p>
        {problem && (
          <Alert variant="destructive">
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-2">
          <Button onClick={() => answer(true)} disabled={!chosen || pending !== null}>
            {pending === "allow" ? "Connecting" : "Allow"}
          </Button>
          <Button variant="outline" onClick={() => answer(false)} disabled={pending !== null}>
            {pending === "deny" ? "Cancelling" : "Cancel"}
          </Button>
        </div>
      </div>
    </AuthCard>
  );
}
