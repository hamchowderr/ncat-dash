"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SIGN_UP_WORDING } from "@convex/lib/news";
import { type ReactNode, useMemo } from "react";

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
  const avatar = useAvatarStorage();
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
      avatar={avatar}
      // An unticked box on the sign-up form, only where email can be sent: product news
      // needs the person to agree first. auth.ts keeps the consent (news.fromSignUp).
      additionalFields={settings?.emailConfigured ? PRODUCT_NEWS_FIELD : undefined}
      // Delete account, at the foot of Settings > Account > Password And Devices.
      plugins={[deleteUserPlugin({ localization: DELETE_ACCOUNT_WORDS })]}
      localization={LOCALIZATION}
    >
      {children}
    </AuthProvider>
  );
}

const PRODUCT_NEWS_FIELD = [
  {
    name: "productNews",
    type: "boolean" as const,
    inputType: "checkbox" as const,
    label: SIGN_UP_WORDING,
    defaultValue: false,
    signUp: true,
    profile: false,
  },
];

/**
 * Profile photos go to the app's own file storage, not into the account record: the page
 * squares and shrinks the picture to 256 pixels, sends it straight to storage, and the
 * account keeps its address. A new photo, or removing it, deletes the old file.
 */
function useAvatarStorage() {
  const uploadUrl = useMutation(api.profiles.avatarUploadUrl);
  const keep = useMutation(api.profiles.setAvatar);
  const remove = useMutation(api.profiles.removeAvatar);
  return useMemo(
    () => ({
      enabled: true,
      extension: "webp" as const,
      upload: async (file: File) => {
        const response = await fetch(await uploadUrl(), {
          method: "POST",
          headers: { "Content-Type": file.type || "image/webp" },
          body: file,
        });
        if (!response.ok) throw new Error("The photo did not upload.");
        const { storageId } = (await response.json()) as { storageId: string };
        const kept = await keep({ file: storageId as never });
        if ("problem" in kept) throw new Error(kept.problem);
        return kept.url;
      },
      delete: async () => {
        await remove({});
      },
    }),
    [uploadUrl, keep, remove],
  );
}
