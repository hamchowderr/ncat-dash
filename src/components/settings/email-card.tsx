"use client";

import { api } from "@convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";

/**
 * Email for the whole dashboard, set once: the toSend account that failed-run alerts,
 * sign-in emails and team invitations are sent through. Each member picks which emails
 * they get in the Notifications card.
 */
export function EmailCard() {
  const team = useActiveTeam();
  const email = useQuery(api.email.get, { organizationId: team.id });
  const connect = useAction(api.email.connect);
  const sendTest = useAction(api.email.sendTest);
  const remove = useMutation(api.email.remove);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (email === undefined) return <Skeleton className="h-48 max-w-xl rounded-xl" />;

  const showForm = email.canEdit && (editing || !email.configured);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setProblem(null);
    setBusy("save");
    try {
      const result = await connect({
        organizationId: team.id,
        apiKey: String(form.get("apiKey") ?? ""),
        fromEmail: String(form.get("fromEmail") ?? ""),
        fromName: String(form.get("fromName") ?? ""),
      });
      if (result.ok) {
        setEditing(false);
        toast.success("Email is set up");
      } else setProblem(result.detail);
    } catch (caught) {
      setProblem(errorMessage(caught, "That could not be checked. Try again in a moment."));
    } finally {
      setBusy(null);
    }
  }

  async function onTest() {
    setBusy("test");
    try {
      const result = await sendTest({ organizationId: team.id });
      if (result.ok) toast.success("Test email sent. Check your inbox.");
      else toast.error(result.detail);
    } catch (caught) {
      toast.error(errorMessage(caught, "The test email could not be sent."));
    } finally {
      setBusy(null);
    }
  }

  async function onRemove() {
    setBusy("remove");
    try {
      await remove({ organizationId: team.id });
      setEditing(false);
      toast.success("Email switched off");
    } catch (caught) {
      toast.error(errorMessage(caught, "That could not be removed. Try again."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>
          <h2>Email</h2>
        </CardTitle>
        <CardDescription>
          Notifications, password resets, address confirmations and team invitations are sent
          through{" "}
          <a href="https://tosend.com" target="_blank" rel="noreferrer" className="underline">
            toSend
          </a>
          . Set it up once here and everything uses it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {email.configured && !showForm && (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Sends from</dt>
              <dd>
                {email.fromName} ({email.fromEmail})
              </dd>
              {email.apiKeyHint && (
                <>
                  <dt className="text-muted-foreground">API key</dt>
                  <dd>Ends in {email.apiKeyHint}</dd>
                </>
              )}
            </dl>
            {email.failing && (
              <Alert variant="destructive">
                <AlertTitle>The last email was not sent</AlertTitle>
                <AlertDescription>{email.failing}</AlertDescription>
              </Alert>
            )}
            {email.source === "deployment" && (
              <p className="text-muted-foreground text-sm">
                Set by whoever runs this dashboard, so there is nothing to change here.
              </p>
            )}
            {email.canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={onTest} disabled={busy !== null}>
                  {busy === "test" ? "Sending" : "Send me a test email"}
                </Button>
                <Button variant="outline" onClick={() => setEditing(true)} disabled={busy !== null}>
                  Change
                </Button>
                <Button variant="ghost" onClick={onRemove} disabled={busy !== null}>
                  {busy === "remove" ? "Removing" : "Remove"}
                </Button>
              </div>
            )}
          </div>
        )}

        {!email.configured && !email.canEdit && (
          <p className="text-muted-foreground text-sm">
            Email is not set up yet. A team owner or admin can set it up here.
          </p>
        )}

        {showForm && (
          <form onSubmit={onSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email-key">toSend API key</FieldLabel>
                <Input
                  id="email-key"
                  name="apiKey"
                  type="password"
                  autoComplete="off"
                  required={!email.configured}
                />
                <FieldDescription>
                  {email.configured
                    ? "Leave empty to keep the saved key."
                    : "A sending key from your toSend dashboard. It is stored encrypted and never shown again."}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="email-from">Send from</FieldLabel>
                <Input
                  id="email-from"
                  name="fromEmail"
                  type="email"
                  autoComplete="off"
                  defaultValue={email.fromEmail ?? ""}
                  required
                />
                <FieldDescription>
                  An address on a domain you have verified in toSend, such as alerts@yourdomain.com.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="email-name">Sender name</FieldLabel>
                <Input
                  id="email-name"
                  name="fromName"
                  autoComplete="off"
                  maxLength={60}
                  defaultValue={email.configured ? (email.fromName ?? "") : team.name}
                />
                <FieldDescription>The name people see in their inbox.</FieldDescription>
              </Field>
              {problem && (
                <Alert variant="destructive">
                  <AlertDescription>{problem}</AlertDescription>
                </Alert>
              )}
              <Field orientation="horizontal">
                <Button type="submit" disabled={busy !== null}>
                  {busy === "save" ? "Checking with toSend" : "Check and save"}
                </Button>
                {email.configured && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setEditing(false);
                      setProblem(null);
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </Field>
            </FieldGroup>
          </form>
        )}

        <p className="text-muted-foreground pt-2 text-sm">
          Which emails you get, and whether they come as they happen or once a day, is up to you
          under{" "}
          <a href="#notifications" className="underline">
            Notifications
          </a>
          .
        </p>
      </CardContent>
    </Card>
  );
}
