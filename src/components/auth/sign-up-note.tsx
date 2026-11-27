"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";

/**
 * Under the sign-up form: on the hosted dashboard, that it is free for a few days with no
 * card; on an invite-only copy, that an invitation is needed. On the hosted Takewon while
 * it is a closed beta, where to ask for an invite. Nothing on other copies.
 */
export function SignUpNote() {
  const settings = useQuery(api.settings.get);
  if (!settings) return null;
  if (settings.betaFormUrl) {
    return (
      <p className="text-muted-foreground mt-4 px-4 text-center text-sm text-pretty">
        Takewon is in a closed beta. If you were invited, sign up with the email address your
        invite went to. If not,{" "}
        <a className="text-foreground underline underline-offset-4" href={settings.betaFormUrl}>
          join the beta
        </a>{" "}
        and you&apos;ll get an invite by email.
      </p>
    );
  }
  const text = settings.inviteOnly
    ? "This dashboard is invite-only. Use the email address your invitation went to."
    : settings.trialDays
      ? `Free for ${settings.trialDays} ${settings.trialDays === 1 ? "day" : "days"}, with no card needed. You will name your team and connect your toolkit next.`
      : null;
  if (!text) return null;
  return <p className="text-muted-foreground mt-4 px-4 text-center text-sm text-pretty">{text}</p>;
}
