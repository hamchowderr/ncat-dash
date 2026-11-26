"use client";

import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";
import posthog from "posthog-js";
import { useEffect, useRef, type ReactNode } from "react";

import { AuthUiProvider } from "@/components/auth-ui-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const posthogConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST,
);

/** Synchronizes the persistent browser analytics identity with the Better Auth session. */
function PostHogIdentity() {
  const session = authClient.useSession();
  const identifiedUserId = useRef<string | null>(null);
  const user = session.data?.user;

  useEffect(() => {
    if (!posthogConfigured || session.isPending) return;

    if (user) {
      if (identifiedUserId.current && identifiedUserId.current !== user.id) {
        posthog.reset();
      }

      if (identifiedUserId.current !== user.id) {
        posthog.identify(user.id, { email: user.email, name: user.name });
        identifiedUserId.current = user.id;
      }
      return;
    }

    if (identifiedUserId.current) {
      posthog.reset();
      identifiedUserId.current = null;
    }
  }, [session.isPending, user]);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      <PostHogIdentity />
      <AuthUiProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </AuthUiProvider>
      <Toaster />
    </ConvexBetterAuthProvider>
  );
}
