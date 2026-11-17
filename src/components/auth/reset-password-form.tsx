"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

import { AuthCard } from "./auth-card";

/** Where the link in a password reset email lands: it carries a one-time token. */
export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const newPassword = String(new FormData(event.currentTarget).get("password") ?? "");
    setError(null);
    setPending(true);
    const result = await authClient.resetPassword({ newPassword, token });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "The password could not be changed. Ask for a new link.");
      return;
    }
    toast.success("Password changed. Sign in with the new one.");
    router.replace("/sign-in");
  }

  if (!token || params.get("error")) {
    return (
      <AuthCard
        title="This link no longer works"
        description="Reset links work once and for one hour. Ask for a new one."
      >
        <Button asChild className="w-full">
          <Link href="/forgot-password">Send a new link</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" description="You will sign in with it from now on.">
      <form onSubmit={onSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="password">New password</FieldLabel>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
            <FieldDescription>At least 8 characters.</FieldDescription>
          </Field>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving" : "Save new password"}
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
