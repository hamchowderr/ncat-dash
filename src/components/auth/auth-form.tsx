"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

const copy = {
  "sign-in": {
    title: "Sign in to your account",
    submit: "Sign in",
    pending: "Signing in",
    switchText: "New here?",
    switchLabel: "Create an account",
    switchHref: "/sign-up",
  },
  "sign-up": {
    title: "Create your account",
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
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const text = copy[mode];

  const signedIn = Boolean(session.data?.user);
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    // Checked against the server first: a page returning from the background can
    // briefly hold an old session.
    void authClient.getSession().then((fresh) => {
      if (!cancelled && fresh.data) router.replace("/");
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, router]);

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
          })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "That did not work. Check your details and try again.");
      return;
    }
    router.replace("/");
  }

  return (
    <section className="flex min-h-screen w-full items-center justify-center px-4 py-4 lg:py-20">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="mt-6 text-3xl font-bold">{text.title}</h1>
        <form onSubmit={onSubmit} className="space-y-6">
          {mode === "sign-up" && (
            <div className="space-y-2">
              <Label htmlFor="name">Your name</Label>
              <Input id="name" name="name" autoComplete="name" required className="mt-1" />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="mt-1"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
              minLength={8}
              required
              className="mt-1"
            />
            {mode === "sign-up" && (
              <p className="text-muted-foreground text-sm">At least 8 characters.</p>
            )}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? text.pending : text.submit}
          </Button>
        </form>

        <p className="text-muted-foreground text-sm">
          {text.switchText}{" "}
          <Link href={text.switchHref} className="text-foreground font-medium hover:underline">
            {text.switchLabel}
          </Link>
        </p>
      </div>
    </section>
  );
}
