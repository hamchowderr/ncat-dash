"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { authClient } from "@/lib/auth-client";

/**
 * Sends the visitor to sign-in or onboarding when a page decides they belong there.
 *
 * Next keeps pages you have left alive in the background, and when one comes back its
 * effects can run once with what it knew before it was hidden. So the decision is
 * checked against the server before anyone is moved.
 */
export function useGuardRedirect(target: "/sign-in" | "/onboarding" | null) {
  const router = useRouter();
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    void (async () => {
      const session = await authClient.getSession();
      if (cancelled || session.error) return;
      if (!session.data) return router.replace("/sign-in");
      if (target !== "/onboarding") return;
      const teams = await authClient.organization.list();
      if (cancelled || !teams.data) return;
      if (teams.data.length === 0) router.replace("/onboarding");
    })();
    return () => {
      cancelled = true;
    };
  }, [target, router]);
}
