"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { FullPageLoader } from "@/components/full-page-loader";
import { ConnectToolkitForm } from "@/components/onboarding/connect-toolkit-form";
import { CreateTeamForm } from "@/components/onboarding/create-team-form";
import { Button } from "@/components/ui/button";
import { useGuardRedirect } from "@/lib/use-guard-redirect";
import { useTeam } from "@/lib/use-team";

export default function OnboardingPage() {
  const router = useRouter();
  const state = useTeam();
  const teamId = state.status === "ready" ? state.team.id : null;
  const connections = useQuery(
    api.toolkitConnections.list,
    teamId ? { organizationId: teamId } : "skip",
  );
  // Set when the connection is made on this visit, so the success message stays on screen.
  const [justConnected, setJustConnected] = useState(false);

  const signedOut = state.status === "signed-out";
  const alreadySetUp = !justConnected && connections !== undefined && connections.length > 0;
  useGuardRedirect(signedOut ? "/sign-in" : null);
  useEffect(() => {
    if (alreadySetUp) router.replace("/");
  }, [alreadySetUp, router]);

  if (state.status === "loading" || signedOut || alreadySetUp) return <FullPageLoader />;
  if (state.status === "ready" && connections === undefined) return <FullPageLoader />;

  const step = state.status === "no-team" ? 1 : 2;

  return (
    <section className="flex min-h-screen w-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <p className="text-muted-foreground text-sm">Step {step} of 2</p>
        {step === 1 ? (
          <>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold">Name your team</h1>
              <p className="text-muted-foreground">
                A team holds your toolkit connection, your media and your automations.
              </p>
            </div>
            <CreateTeamForm />
          </>
        ) : (
          <>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold">Connect your toolkit</h1>
              <p className="text-muted-foreground">
                Point the dashboard at your own NCA Toolkit. We test the connection before saving
                anything.
              </p>
            </div>
            {state.status === "ready" && (
              <ConnectToolkitForm
                organizationId={state.team.id}
                onConnected={() => setJustConnected(true)}
              />
            )}
            {justConnected && (
              <Button asChild className="w-full">
                <Link href="/">Go to the dashboard</Link>
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
