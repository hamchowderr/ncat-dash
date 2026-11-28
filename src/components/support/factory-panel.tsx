"use client";

import { api } from "@convex/_generated/api";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { CheckCircle2, Factory } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/catalog";

type Staff = NonNullable<FunctionReturnType<typeof api.support.staffConversation>>["ticket"];

const day = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/**
 * Send to Factory, beside a request in the Support inbox. The platform admin writes or
 * checks a short summary first: the repository is public, so the summary is all a pull
 * request may show. Once sent it says so, and once the Factory reports back, Fixed.
 */
export function FactoryPanel({ ticket }: { ticket: Staff }) {
  const send = useMutation(api.support.sendToFactory);
  const factory = ticket.factory;
  const [summary, setSummary] = useState(factory?.summary ?? ticket.subject);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (factory?.status === "fixed") {
    return (
      <section aria-label="Factory" className="grid gap-1" data-factory="fixed">
        <span className="text-muted-foreground text-xs">Factory</span>
        <span className="inline-flex items-center gap-1.5 font-medium">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          Fixed
        </span>
        <span className="text-muted-foreground text-xs">
          {factory.beadId ? `${factory.beadId} · ` : ""}
          {factory.fixedAt ? day.format(factory.fixedAt) : ""}
        </span>
        {factory.reason && <p className="break-words">{factory.reason}</p>}
      </section>
    );
  }

  const changed = summary.trim() !== (factory?.summary ?? "");
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await send({ ticketId: ticket.id, summary });
    } catch (caught) {
      setError(errorMessage(caught, "That didn't send. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Factory" className="grid gap-1.5" data-factory={factory?.status ?? "no"}>
      <label htmlFor="factory-summary" className="text-muted-foreground text-xs">
        Summary for the Factory
      </label>
      <Input
        id="factory-summary"
        value={summary}
        maxLength={200}
        onChange={(event) => setSummary(event.target.value)}
      />
      <p className="text-muted-foreground text-xs">
        It can show in a public pull request: no names, emails, teams or links.
      </p>
      {error && (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      )}
      {factory ? (
        <>
          <p className="text-xs">
            Sent to Factory {day.format(factory.sentAt)} by {factory.sentByName}
          </p>
          {changed && (
            <Button size="sm" variant="outline" disabled={busy || !summary.trim()} onClick={submit}>
              Update summary
            </Button>
          )}
        </>
      ) : (
        <Button size="sm" disabled={busy || !summary.trim()} onClick={submit}>
          <Factory />
          Send to Factory
        </Button>
      )}
    </section>
  );
}
