"use client";

import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { FullPageLoader } from "@/components/full-page-loader";
import { TOOLKIT_SETTINGS } from "@/components/settings/settings-pages";
import { START_TOUR_SEARCH } from "@/components/app-shell/dashboard-tour";
import { ContentGoalsFlow } from "@/components/onboarding/content-goals-flow";
import { CreateTeamForm } from "@/components/onboarding/create-team-form";
import { BrandForm } from "@/components/settings/brand-form";
import { Button } from "@/components/ui/button";
import { TeamContext } from "@/lib/team-context";
import { useGuardRedirect } from "@/lib/use-guard-redirect";
import { useTeam } from "@/lib/use-team";

// Name and brand, then the four content goals screens (content-goals-flow.tsx).
const STEPS = 6;

type Stage = "brand" | "goals";

/**
 * Setting up, in order: name the team, the brand every automation uses, then what the team
 * makes: where it posts, the ready-made automations that fit, and a first upload. Nobody
 * is asked about a toolkit: a new team is put on the one the operator lends (when there is
 * one), and a team that wants its own sets it in Settings, under Toolkit. On a copy that
 * lends none, the last screen says automations start once a toolkit is connected there.
 * `/onboarding?toolkit=connect` (old "Connect your toolkit" links) goes to that page.
 */
function Onboarding() {
  const router = useRouter();
  const oldConnectLink = useSearchParams().get("toolkit") === "connect";
  const state = useTeam();
  const teamId = state.status === "ready" ? state.team.id : null;
  const connections = useQuery(
    api.toolkitConnections.list,
    teamId ? { organizationId: teamId } : "skip",
  );
  const settings = useQuery(api.teamSettings.get, teamId ? { organizationId: teamId } : "skip");
  const goals = useQuery(api.contentGoals.get, teamId ? { organizationId: teamId } : "skip");
  const offersOurs = useQuery(
    api.toolkitConnections.offersOurs,
    teamId ? { organizationId: teamId } : "skip",
  );
  const connectOurs = useAction(api.toolkitConnections.connectOurs);
  const [stage, setStage] = useState<Stage | null>(null);
  const asked = useRef(false);

  const signedOut = state.status === "signed-out";
  // A team that answered what it makes has set up already.
  const alreadySetUp = stage === null && goals?.answered === true;
  useGuardRedirect(signedOut ? "/sign-in" : null);
  useEffect(() => {
    if (oldConnectLink && teamId) router.replace(TOOLKIT_SETTINGS);
    else if (alreadySetUp) router.replace("/");
  }, [alreadySetUp, oldConnectLink, teamId, router]);

  // The team is put on our toolkit when it is made. Should that not have happened yet
  // (the toolkit was slow to answer), ask once more here, quietly: setting up carries on.
  const lendNow = offersOurs === true && connections !== undefined && connections.length === 0;
  useEffect(() => {
    if (!lendNow || !teamId || asked.current) return;
    asked.current = true;
    connectOurs({ organizationId: teamId }).catch(() => undefined);
  }, [lendNow, teamId, connectOurs]);

  if (state.status === "loading" || signedOut || alreadySetUp || (oldConnectLink && teamId)) {
    return <FullPageLoader />;
  }
  if (
    state.status === "ready" &&
    (connections === undefined ||
      settings === undefined ||
      goals === undefined ||
      offersOurs === undefined)
  ) {
    return <FullPageLoader />;
  }

  const current: Stage | "team" = state.status === "no-team" ? "team" : (stage ?? "brand");
  const step = current === "team" ? 1 : current === "brand" ? 2 : 3;
  // Once setting up is done, Home starts the tour of the dashboard for someone who has not
  // had it.
  const finishSetup = () => router.replace(`/${START_TOUR_SEARCH}`);
  const toGoals = () => setStage("goals");
  // Uploads go to the toolkit's storage, so the first upload needs one: ours (being
  // connected now) or the team's own.
  const hasToolkit = (connections?.length ?? 0) > 0 || offersOurs === true;

  return (
    <section className="flex min-h-screen w-full items-center justify-center px-4 py-10">
      <div className={step === 3 ? "w-full max-w-2xl" : "w-full max-w-md space-y-6"}>
        {step < 3 && (
          <p className="text-muted-foreground text-sm">
            Step {step} of {STEPS}
          </p>
        )}
        {current === "team" && (
          <>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold">Name your team</h1>
              <p className="text-muted-foreground">
                A team holds your media, your brand and your automations.
              </p>
            </div>
            <CreateTeamForm />
          </>
        )}
        {current === "brand" && state.status === "ready" && settings && (
          <TeamContext.Provider value={state.team}>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold">Add your brand</h1>
              <p className="text-muted-foreground">
                Your logo and colour, set once. Every automation that adds a logo or writes text
                uses them by itself.
              </p>
            </div>
            <BrandForm
              brand={settings.brand}
              music={settings.music}
              canEdit={settings.canEdit}
              submitLabel="Save and continue"
              onSaved={toGoals}
              essentials
            />
            <p className="text-muted-foreground text-sm">
              Font, card template, intro, outro and music can be added later in Settings, under
              Brand.
            </p>
            <Button variant="ghost" className="w-full" onClick={toGoals}>
              Skip for now
            </Button>
          </TeamContext.Provider>
        )}
        {current === "goals" && state.status === "ready" && (
          <ContentGoalsFlow
            organizationId={state.team.id}
            stepsBefore={2}
            stepsTotal={STEPS}
            hasToolkit={hasToolkit}
            onFinish={finishSetup}
          />
        )}
      </div>
    </section>
  );
}

/**
 * Pages are kept alive between visits, so each address gets its own copy of the screens:
 * an old toolkit link goes to Settings, not to where an earlier visit left off.
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
