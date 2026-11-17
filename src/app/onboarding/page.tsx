"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { FullPageLoader } from "@/components/full-page-loader";
import { ConnectToolkitForm } from "@/components/onboarding/connect-toolkit-form";
import { CreateTeamForm } from "@/components/onboarding/create-team-form";
import { BrandForm } from "@/components/settings/brand-form";
import { Button } from "@/components/ui/button";
import { TeamContext } from "@/lib/team-context";
import { useGuardRedirect } from "@/lib/use-guard-redirect";
import { useTeam } from "@/lib/use-team";

const STEPS = 3;

/**
 * Setting up, in order: name the team, connect the toolkit, then the brand every
 * automation uses. Files go to the toolkit's own storage, so there is no storage step.
 * The brand can be skipped and set later in Settings.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const state = useTeam();
  const teamId = state.status === "ready" ? state.team.id : null;
  const connections = useQuery(
    api.toolkitConnections.list,
    teamId ? { organizationId: teamId } : "skip",
  );
  const settings = useQuery(api.teamSettings.get, teamId ? { organizationId: teamId } : "skip");
  // How far this visit has got past connecting the toolkit: 2 is the toolkit step itself.
  const [stage, setStage] = useState<2 | 3 | null>(null);

  const signedOut = state.status === "signed-out";
  // Someone who set up on an earlier visit goes straight to the dashboard.
  const alreadySetUp = stage === null && connections !== undefined && connections.length > 0;
  useGuardRedirect(signedOut ? "/sign-in" : null);
  useEffect(() => {
    if (alreadySetUp) router.replace("/");
  }, [alreadySetUp, router]);

  if (state.status === "loading" || signedOut || alreadySetUp) return <FullPageLoader />;
  if (state.status === "ready" && (connections === undefined || settings === undefined)) {
    return <FullPageLoader />;
  }

  const step = state.status === "no-team" ? 1 : (stage ?? 2);
  const finish = () => router.replace("/");

  return (
    <section className="flex min-h-screen w-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <p className="text-muted-foreground text-sm">
          Step {step} of {STEPS}
        </p>
        {step === 1 && (
          <>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold">Name your team</h1>
              <p className="text-muted-foreground">
                A team holds your toolkit connection, your media and your automations.
              </p>
            </div>
            <CreateTeamForm />
          </>
        )}
        {step === 2 && state.status === "ready" && (
          <>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold">Connect your toolkit</h1>
              <p className="text-muted-foreground">
                Point the dashboard at your own NCA Toolkit. Your files go to the toolkit&apos;s own
                storage, so this is the only connection to make. We test it before saving anything.
              </p>
            </div>
            <ConnectToolkitForm organizationId={state.team.id} onConnected={() => setStage(2)} />
            {stage === 2 && (
              <Button className="w-full" onClick={() => setStage(3)}>
                Continue
              </Button>
            )}
          </>
        )}
        {step === 3 && state.status === "ready" && settings && (
          <TeamContext.Provider value={state.team}>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold">Add your brand</h1>
              <p className="text-muted-foreground">
                Set these once. Any step that adds a logo, writes text or adds music uses them by
                itself, in every automation. You can change them later in Settings.
              </p>
            </div>
            <BrandForm
              brand={settings.brand}
              music={settings.music}
              canEdit={settings.canEdit}
              submitLabel="Save and go to the dashboard"
              onSaved={finish}
            />
            <Button variant="ghost" className="w-full" onClick={finish}>
              Skip for now
            </Button>
          </TeamContext.Provider>
        )}
      </div>
    </section>
  );
}
