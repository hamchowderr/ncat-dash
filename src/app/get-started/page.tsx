"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";

import { START_TOUR_SEARCH } from "@/components/app-shell/dashboard-tour";
import { FullPageLoader } from "@/components/full-page-loader";
import { ContentGoalsFlow } from "@/components/onboarding/content-goals-flow";
import { useGuardRedirect } from "@/lib/use-guard-redirect";
import { useTeam } from "@/lib/use-team";

/**
 * What the team makes, for a team that set up before these questions were asked, or
 * wants to answer them again: the same four screens that end setting up.
 */
export default function GetStartedPage() {
  const router = useRouter();
  const state = useTeam();
  const connections = useQuery(
    api.toolkitConnections.list,
    state.status === "ready" ? { organizationId: state.team.id } : "skip",
  );
  useGuardRedirect(
    state.status === "signed-out" ? "/sign-in" : state.status === "no-team" ? "/onboarding" : null,
  );
  if (state.status !== "ready" || connections === undefined) return <FullPageLoader />;
  return (
    <section className="flex min-h-screen w-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <ContentGoalsFlow
          organizationId={state.team.id}
          hasToolkit={connections.length > 0}
          onFinish={() =>
            router.replace(`/${START_TOUR_SEARCH}`, { transitionTypes: ["nav-back"] })
          }
        />
      </div>
    </section>
  );
}
