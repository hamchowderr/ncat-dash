"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { AuthProvider } from "@/components/auth/auth-provider";
import { deleteUserPlugin } from "@/lib/auth/delete-user-plugin";
import { authClient } from "@/lib/auth-client";
import { DELETE_ACCOUNT_WORDS, LOCALIZATION } from "@/lib/auth-words";

/**
 * The sign-in screens and account cards come from Better Auth UI (better-auth-ui.com),
 * copied in from its shadcn registry under src/components/auth. This hands them the
 * dashboard's auth client, router and words.
 *
 * Its pages sit at the dashboard's own addresses (/sign-in, /sign-up, /forgot-password,
 * /reset-password, /verify-email), the ones every email already links to.
 */
export function AuthUiProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const settings = useQuery(api.settings.get);
  return (
    <AuthProvider
      authClient={authClient}
      Link={Link}
      navigate={({ to, replace }) => (replace ? router.replace(to) : router.push(to))}
      redirectTo="/"
      basePaths={{ auth: "", settings: "/settings" }}
      viewPaths={{ settings: { account: "account", security: "account" } }}
      socialProviders={settings?.signInWith.google ? ["google"] : []}
      emailAndPassword={{
        enabled: true,
        forgotPassword: settings?.emailConfigured ?? false,
        requireEmailVerification: settings?.emailVerification ?? false,
        confirmPassword: false,
        rememberMe: false,
        strengthMeter: true,
        minPasswordLength: 8,
        maxPasswordLength: 128,
      }}
      avatar={{ enabled: false }}
      // Delete account, at the foot of Settings > Account > Password And Devices.
      plugins={[deleteUserPlugin({ localization: DELETE_ACCOUNT_WORDS })]}
      localization={LOCALIZATION}
    >
      {children}
    </AuthProvider>
  );
}
