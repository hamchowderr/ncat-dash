"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

const copy = {
  "sign-in": {
    title: "Sign in to your account",
    description: "Enter your email and password to get back to your team.",
    submit: "Sign in",
    pending: "Signing in",
    switchText: "New here?",
    switchLabel: "Create an account",
    switchHref: "/sign-up",
  },
  "sign-up": {
    title: "Create your account",
    description: "You will name your team and connect your toolkit next.",
    submit: "Create account",
    pending: "Creating account",
    switchText: "Already have an account?",
    switchLabel: "Sign in",
    switchHref: "/sign-in",
  },
} as const;

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const session = authClient.useSession();
  const email = useQuery(api.email.status);
  const settings = useQuery(api.settings.get);
  const trialDays = mode === "sign-up" ? (settings?.trialDays ?? null) : null;
  // Where to go once signed in: an invitation link sends people here first. Only paths
  // inside this app are followed.
  const wanted = useSearchParams().get("next");
  const next = wanted && wanted.startsWith("/") && !wanted.startsWith("//") ? wanted : "/";
  const withNext = (href: string) =>
    next === "/" ? href : `${href}?next=${encodeURIComponent(next)}`;
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const text = copy[mode];

  const signedIn = Boolean(session.data?.user);
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    // Checked against the server first: a page returning from the background can
    // briefly hold an old session.
    void authClient.getSession().then((fresh) => {
      if (!cancelled && fresh.data) router.replace(next);
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, router, next]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setError(null);
    setPending(true);
    const result =
      mode === "sign-up"
        ? await authClient.signUp.email({
            name: String(form.get("name") ?? "").trim(),
            email,
            password,
            // Where the link in the confirmation email ends up.
            callbackURL: "/",
          })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "That did not work. Check your details and try again.");
      return;
    }
    // With confirmation required, a new account is not signed in until its address is
    // confirmed from the email.
    if (mode === "sign-up" && !(result.data as { token?: string | null }).token) {
      setConfirm(email);
      return;
    }
    router.replace(next);
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>
              <h1>{text.title}</h1>
            </CardTitle>
            <CardDescription>
              {trialDays
                ? `Free for ${trialDays} ${trialDays === 1 ? "day" : "days"}, with no card needed. ${text.description}`
                : text.description}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit}>
              <FieldGroup>
                {mode === "sign-up" && (
                  <Field>
                    <FieldLabel htmlFor="name">Your name</FieldLabel>
                    <Input id="name" name="name" autoComplete="name" required />
                  </Field>
                )}
                <Field>
                  <FieldLabel htmlFor="email">Email address</FieldLabel>
                  <Input id="email" name="email" type="email" autoComplete="email" required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                    minLength={8}
                    required
                  />
                  {mode === "sign-up" && (
                    <FieldDescription>At least 8 characters.</FieldDescription>
                  )}
                </Field>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                {confirm && (
                  <Alert>
                    <AlertDescription>
                      We sent a link to {confirm}. Open it to confirm your address and you will be
                      signed in.
                    </AlertDescription>
                  </Alert>
                )}
                <Field>
                  <Button type="submit" disabled={pending}>
                    {pending ? text.pending : text.submit}
                  </Button>
                  <FieldDescription className="text-center">
                    {text.switchText}{" "}
                    <Link href={withNext(text.switchHref)}>{text.switchLabel}</Link>
                  </FieldDescription>
                  {mode === "sign-in" && email?.configured && (
                    <FieldDescription className="text-center">
                      <Link href="/forgot-password">Forgot your password?</Link>
                    </FieldDescription>
                  )}
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
