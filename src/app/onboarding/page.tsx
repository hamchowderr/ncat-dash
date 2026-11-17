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
import { StorageForm } from "@/components/uploads/storage-form";
import { TeamContext } from "@/lib/team-context";
import { useGuardRedirect } from "@/lib/use-guard-redirect";
import { useTeam } from "@/lib/use-team";

const STEPS = 4;

/**
 * Setting up, in order: name the team, connect the toolkit, connect storage, then the
 * brand every automation uses. The last two can be skipped and done later from Uploads
 * and Settings.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const state = useTeam();
  const teamId = state.status === "ready" ? state.team.id : null;
  const connections = useQuery(
    api.toolkitConnections.list,
    teamId ? { organizationId: teamId } : "skip",
  );
  const storage = useQuery(api.storage.get, teamId ? { organizationId: teamId } : "skip");
  const settings = useQuery(api.teamSettings.get, teamId ? { organizationId: teamId } : "skip");
  // How far this visit has got past connecting the toolkit: 2 is the toolkit step itself.
  const [stage, setStage] = useState<2 | 3 | 4 | null>(null);

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
                Point the dashboard at your own NCA Toolkit. We test the connection before saving
                anything.
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
        {step === 3 && state.status === "ready" && (
          <>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold">Connect your storage</h1>
              <p className="text-muted-foreground">
                The bucket your files go to: uploads, your logo and your music. Any S3-compatible
                storage works, such as Cloudflare R2.
              </p>
            </div>
            {storage ? (
              <p className="text-sm">Your storage is connected.</p>
            ) : (
              <StorageForm organizationId={state.team.id} onSaved={() => setStage(4)} />
            )}
            <Button
              variant={storage ? "default" : "ghost"}
              className="w-full"
              onClick={() => setStage(4)}
            >
              {storage ? "Continue" : "Skip for now"}
            </Button>
          </>
        )}
        {step === 4 && state.status === "ready" && settings && (
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
