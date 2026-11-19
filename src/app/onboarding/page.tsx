"use client";

import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";

import { FullPageLoader } from "@/components/full-page-loader";
import { ConnectToolkitForm } from "@/components/onboarding/connect-toolkit-form";
import { ContentGoalsFlow } from "@/components/onboarding/content-goals-flow";
import { CreateTeamForm } from "@/components/onboarding/create-team-form";
import { HaveToolkitQuestion } from "@/components/onboarding/have-toolkit-question";
import { BrandForm } from "@/components/settings/brand-form";
import { Button } from "@/components/ui/button";
import { TeamContext } from "@/lib/team-context";
import { useGuardRedirect } from "@/lib/use-guard-redirect";
import { useTeam } from "@/lib/use-team";

// Name, toolkit and brand, then the four content goals screens (content-goals-flow.tsx).
const STEPS = 7;

type Stage = "ask" | "connect" | "connected" | "brand" | "goals";

/**
 * Setting up, in order: name the team, say whether there is a toolkit and connect it if so,
 * the brand every automation uses, then what the team makes: where it posts, the ready-made
 * automations that fit, and a first upload. Someone without a toolkit skips every toolkit
 * field: they are put on ours when the operator lends one, and otherwise the last screen
 * tells them their automations run once one is connected.
 * `/onboarding?toolkit=connect` (the "Connect your toolkit" links) opens the form directly
 * and goes back home once connected. The brand and the first upload can be skipped.
 */
function Onboarding() {
  const router = useRouter();
  const connectOnly = useSearchParams().get("toolkit") === "connect";
  const state = useTeam();
  const teamId = state.status === "ready" ? state.team.id : null;
  const connections = useQuery(
    api.toolkitConnections.list,
    teamId ? { organizationId: teamId } : "skip",
  );
  const settings = useQuery(api.teamSettings.get, teamId ? { organizationId: teamId } : "skip");
  const [stage, setStage] = useState<Stage | null>(null);
  const [hasToolkit, setHasToolkit] = useState(true);
  const offersOurs = useQuery(
    api.toolkitConnections.offersOurs,
    teamId ? { organizationId: teamId } : "skip",
  );
  const connectOurs = useAction(api.toolkitConnections.connectOurs);
  const [joining, setJoining] = useState(false);

  const signedOut = state.status === "signed-out";
  // Someone already connected on an earlier visit goes straight to the dashboard.
  const alreadySetUp = stage === null && connections !== undefined && connections.length > 0;
  useGuardRedirect(signedOut ? "/sign-in" : null);
  useEffect(() => {
    if (alreadySetUp) router.replace("/");
  }, [alreadySetUp, router]);

  if (state.status === "loading" || signedOut || alreadySetUp) return <FullPageLoader />;
  if (
    state.status === "ready" &&
    (connections === undefined || settings === undefined || offersOurs === undefined)
  ) {
    return <FullPageLoader />;
  }

  const current: Stage | "team" =
    state.status === "no-team" ? "team" : (stage ?? (connectOnly ? "connect" : "ask"));
  const step = current === "team" ? 1 : current === "brand" ? 3 : current === "goals" ? 4 : 2;
  const finish = () => router.replace("/");
  const toGoals = () => setStage("goals");
  // No: on ours when the operator lends one, otherwise on without a toolkit for now.
  const withoutToolkit = async () => {
    if (offersOurs && teamId) {
      setJoining(true);
      try {
        const joined = await connectOurs({ organizationId: teamId });
        if (joined.ok) {
          setHasToolkit(true);
          setStage("brand");
          return;
        }
      } catch {
        // Told below, then setting up carries on without one.
      } finally {
        setJoining(false);
      }
      toast.error(
        "Our toolkit did not answer just now. Carry on, and connect one from Home later.",
      );
    }
    setHasToolkit(false);
    setStage("brand");
  };

  return (
    <section className="flex min-h-screen w-full items-center justify-center px-4 py-10">
      <div className={step === 4 ? "w-full max-w-2xl" : "w-full max-w-md space-y-6"}>
        {step < 4 && !connectOnly && (
          <p className="text-muted-foreground text-sm">
            Step {step} of {STEPS}
          </p>
        )}
        {current === "team" && (
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
        {current === "ask" && (
          <HaveToolkitQuestion
            onYes={() => setStage("connect")}
            onNo={() => void withoutToolkit()}
            offersOurs={offersOurs === true}
            pending={joining}
          />
        )}
        {(current === "connect" || current === "connected") && state.status === "ready" && (
          <>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold">Connect your toolkit</h1>
              <p className="text-muted-foreground">
                Point the dashboard at your own NCA Toolkit. Your files go to the toolkit&apos;s own
                storage, so this is the only connection to make. We test it before saving anything.
              </p>
            </div>
            <ConnectToolkitForm
              organizationId={state.team.id}
              onConnected={() => setStage("connected")}
            />
            {current === "connected" ? (
              <Button
                className="w-full"
                onClick={() => {
                  setHasToolkit(true);
                  if (connectOnly) finish();
                  else setStage("brand");
                }}
              >
                Continue
              </Button>
            ) : connectOnly ? (
              <Button variant="ghost" className="w-full" onClick={finish}>
                Not now
              </Button>
            ) : (
              <Button variant="ghost" className="w-full" onClick={() => setStage("ask")}>
                Back
              </Button>
            )}
          </>
        )}
        {current === "brand" && state.status === "ready" && settings && (
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
              submitLabel="Save and continue"
              onSaved={toGoals}
            />
            <Button variant="ghost" className="w-full" onClick={toGoals}>
              Skip for now
            </Button>
          </TeamContext.Provider>
        )}
        {current === "goals" && state.status === "ready" && (
          <ContentGoalsFlow
            organizationId={state.team.id}
            stepsBefore={3}
            stepsTotal={STEPS}
            hasToolkit={hasToolkit}
            onFinish={finish}
          />
        )}
      </div>
    </section>
  );
}

/**
 * Pages are kept alive between visits, so each address gets its own copy of the screens:
 * opening the toolkit form from Home starts there, not where an earlier visit left off.
 */
function ByAddress() {
  return <Onboarding key={useSearchParams().toString()} />;
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <ByAddress />
    </Suspense>
  );
}
