"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

import { AuthCard } from "./auth-card";

export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setError(null);
    setPending(true);
    const result = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "That did not work. Try again in a moment.");
      return;
    }
    setSentTo(email);
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email address and we will send you a link to choose a new password."
    >
      {sentTo ? (
        <FieldGroup>
          <Alert>
            <AlertDescription>
              If {sentTo} has an account, a link is on its way. It works for one hour.
            </AlertDescription>
          </Alert>
          <FieldDescription className="text-center">
            <Link href="/sign-in">Back to sign in</Link>
          </FieldDescription>
        </FieldGroup>
      ) : (
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="email">Email address</FieldLabel>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </Field>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Field>
              <Button type="submit" disabled={pending}>
                {pending ? "Sending" : "Send reset link"}
              </Button>
              <FieldDescription className="text-center">
                <Link href="/sign-in">Back to sign in</Link>
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>
      )}
    </AuthCard>
  );
}
