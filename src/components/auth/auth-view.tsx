"use client";

import type { AuthView as View } from "@better-auth-ui/core";
import { useAuth } from "@better-auth-ui/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { authClient } from "@/lib/auth-client";

import { Auth } from "./auth";
import { SignUpNote } from "./sign-up-note";

/** Screens that someone already signed in has no use for. */
const SIGNED_OUT_ONLY: View[] = ["signIn", "signUp", "forgotPassword"];

/**
 * One of Better Auth UI's sign-in screens, at its own address. Someone already signed in is
 * sent on from sign-in and sign-up, and creating an account also says what comes with it
 * (a free trial, or that an invitation is needed).
 */
export function AuthView({ view }: { view: View }) {
  useSendOnWhenSignedIn(SIGNED_OUT_ONLY.includes(view));
  return (
    <>
      <Auth view={view} socialPosition="top" className="bg-transparent" />
      {view === "signUp" && <SignUpNote />}
    </>
  );
}

function useSendOnWhenSignedIn(active: boolean) {
  const router = useRouter();
  const { redirectTo } = useAuth();
  const signedIn = Boolean(authClient.useSession().data?.user);
  useEffect(() => {
    if (!active || !signedIn) return;
    let cancelled = false;
    // Checked against the server first: a page returning from the background can briefly
    // hold an old session.
    void authClient.getSession().then((fresh) => {
      if (!cancelled && fresh.data) router.replace(redirectTo);
    });
    return () => {
      cancelled = true;
    };
  }, [active, signedIn, router, redirectTo]);
}
