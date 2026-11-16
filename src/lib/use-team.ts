"use client";

import { api } from "@convex/_generated/api";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect } from "react";

import { authClient } from "@/lib/auth-client";

type SessionUser = { id: string; name: string; email: string; image?: string | null };

export type TeamState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "no-team"; user: SessionUser }
  | { status: "ready"; user: SessionUser; team: { id: string; name: string } };

/**
 * Where the visitor stands: signed out, signed in without a team, or working in a team.
 * The team list is a live Convex query, so creating or joining a team shows up at once.
 * The team in use is the session's active one, or the first team when none is chosen.
 */
export function useTeam(): TeamState {
  const session = authClient.useSession();
  const convexAuth = useConvexAuth();
  const user = session.data?.user;
  const teams = useQuery(api.teams.mine, user && convexAuth.isAuthenticated ? {} : "skip");

  const activeId = session.data?.session.activeOrganizationId ?? null;
  const team = teams?.find((candidate) => candidate.id === activeId) ?? teams?.[0] ?? null;

  // Keep Better Auth's idea of the active team in step, for invitations and roles.
  const needsActivating = team && team.id !== activeId ? team.id : null;
  useEffect(() => {
    if (needsActivating) {
      void authClient.organization.setActive({ organizationId: needsActivating });
    }
  }, [needsActivating]);

  if (session.isPending) return { status: "loading" };
  if (!user) return { status: "signed-out" };
  if (teams === undefined || teams === null) return { status: "loading" };
  if (!team) return { status: "no-team", user };
  return { status: "ready", user, team: { id: team.id, name: team.name } };
}
