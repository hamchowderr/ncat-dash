"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { TimeZonePicker } from "@/components/automations/time-zone-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/catalog";
import { myTimeZone } from "@/lib/time-zone";

/** Longest job title, as convex/profiles.ts allows. */
const TITLE_LONGEST = 60;

/**
 * What you do on a team and the time zone the app works in for you, under your name and
 * photo on Settings > Account. Laid out like Better Auth UI's Profile card above it.
 */
export function ProfileDetails() {
  const profile = useQuery(api.profiles.mine);
  // Drawn afresh once the profile loads, or changes, so the fields start from it.
  return (
    <ProfileForm
      key={profile ? `${profile.title ?? ""}|${profile.timeZone ?? ""}` : "loading"}
      profile={profile ?? undefined}
    />
  );
}

function ProfileForm({
  profile,
}: {
  profile: { title: string | null; timeZone: string | null } | undefined;
}) {
  const update = useMutation(api.profiles.update);
  const savedTitle = profile?.title ?? "";
  const savedZone = profile?.timeZone ?? myTimeZone();
  const [title, setTitle] = useState(savedTitle);
  const [timeZone, setTimeZone] = useState(savedZone);
  const [pending, setPending] = useState(false);

  const changed = profile !== undefined && (title.trim() !== savedTitle || timeZone !== savedZone);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await update({ title, timeZone });
      toast.success("Saved.");
    } catch (caught) {
      toast.error(errorMessage(caught, "That didn't save. Try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">Work</h2>
      <form onSubmit={(event) => void onSubmit(event)}>
        <Card>
          <CardContent className="flex flex-col gap-6">
            <Field>
              <FieldLabel htmlFor="profile-title">Job title</FieldLabel>
              <Input
                id="profile-title"
                placeholder="Editor, producer, host…"
                maxLength={TITLE_LONGEST}
                value={title}
                disabled={!profile || pending}
                onChange={(event) => setTitle(event.target.value)}
              />
              <FieldDescription>
                Shown beside your name on Members and when someone picks a reviewer.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-time-zone">Time zone</FieldLabel>
              <TimeZonePicker id="profile-time-zone" value={timeZone} onChange={setTimeZone} />
              <FieldDescription>
                Daily summaries, calendar times, schedules and the agent go by this, wherever you
                open Takewon from.
              </FieldDescription>
            </Field>
          </CardContent>
          <CardFooter>
            <Button type="submit" size="sm" disabled={!changed || pending}>
              Save work details
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
