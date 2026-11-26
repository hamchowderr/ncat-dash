"use client";

import { useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import posthog from "posthog-js";

const posthogConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST,
);

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  // A short suffix keeps two teams with the same name from colliding.
  return `${base || "team"}-${Math.random().toString(36).slice(2, 8)}`;
}

export function CreateTeamForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!name) return;
    setError(null);
    setPending(true);
    const created = await authClient.organization.create({ name, slug: slugify(name) });
    if (created.error || !created.data) {
      setPending(false);
      setError(created.error?.message ?? "The team could not be created. Try again.");
      return;
    }
    await authClient.organization.setActive({ organizationId: created.data.id });
    if (posthogConfigured) posthog.capture("team_created");
    // The page moves on by itself once the new team shows up as the active one.
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">Team name</Label>
        <Input
          id="name"
          name="name"
          placeholder="Your company or channel"
          autoComplete="organization"
          maxLength={60}
          required
          className="mt-1"
        />
        <p className="text-muted-foreground text-sm">You can invite teammates later.</p>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating team" : "Create team"}
      </Button>
    </form>
  );
}
