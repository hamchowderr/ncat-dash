"use client";

import { api } from "@convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";

import { fromInputValue, toInputValue } from "@/components/calendar/dates";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/catalog";

import { AUDIENCES, type Audience, OperatorOnly } from "./operator-only";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function SendEmailView() {
  return (
    <OperatorOnly>
      <SendEmailForm />
    </OperatorOnly>
  );
}

function SendEmailForm() {
  const router = useRouter();
  const audiences = useQuery(api.broadcasts.audiences, {});
  const create = useMutation(api.broadcasts.create);
  const sendTest = useAction(api.broadcasts.sendTest);

  const [audience, setAudience] = useState<Audience>("news");
  const [subject, setSubject] = useState("");
  const [heading, setHeading] = useState("");
  const [body, setBody] = useState("");
  const [buttonLabel, setButtonLabel] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  const [timing, setTiming] = useState<"now" | "later">("now");
  const [sendAt, setSendAt] = useState(() => toInputValue(Date.now() + 60 * 60 * 1000));
  const [testing, setTesting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);

  const draft = {
    subject,
    body,
    audience,
    ...(heading.trim() ? { heading } : {}),
    ...(buttonLabel.trim() || buttonUrl.trim()
      ? { button: { label: buttonLabel, url: buttonUrl } }
      : {}),
  };
  const shown = useDeferredValue(draft);
  const preview = useQuery(api.broadcasts.preview, { draft: shown });

  if (!audiences) return <Skeleton className="h-96 rounded-xl" />;
  const reach = audiences.counts[audience];
  const at = timing === "later" ? fromInputValue(sendAt) : null;
  const ready = subject.trim() !== "" && body.trim() !== "" && audiences.sending;
  const options = (Object.keys(AUDIENCES) as Audience[]).filter(
    (key) => audiences.hasTrials || (key !== "trial_teams" && key !== "paid_teams"),
  );

  const test = async () => {
    setTesting(true);
    try {
      const result = await sendTest({ draft });
      if (result.ok) toast.success(`Test sent to ${result.to}.`);
      else toast.error(result.detail);
    } catch (error) {
      toast.error(errorMessage(error, "That didn't work. Try again."));
    } finally {
      setTesting(false);
    }
  };

  const send = async () => {
    setSending(true);
    try {
      const id = await create({ draft, ...(at ? { sendAt: at } : {}) });
      toast.success(at ? `Booked for ${when.format(at)}.` : "Sending now.");
      router.push(`/admin/emails/${id}`);
    } catch (error) {
      toast.error(errorMessage(error, "That didn't work. Try again."));
      setSending(false);
      setConfirming(false);
    }
  };

  const people = `${reach.toLocaleString()} ${reach === 1 ? "person" : "people"}`;

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Send An Email</h1>
        <p className="text-muted-foreground text-sm text-pretty">
          Write it once, check the preview, send yourself a test, then send it now or later. Every
          email carries your postal address and a one-click unsubscribe.
        </p>
      </div>

      {!audiences.sending && (
        <p className="bg-amber-500/10 text-amber-900 rounded-lg px-4 py-3 text-sm">
          Email isn&rsquo;t set up yet, so nothing can be sent. Set it up in Settings, Integrations,
          Email.
        </p>
      )}
      {audiences.needsAddress && (
        <p className="bg-amber-500/10 text-amber-900 rounded-lg px-4 py-3 text-sm">
          Set EMAIL_POSTAL_ADDRESS so these emails carry your postal address, as US law asks.
        </p>
      )}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <FieldGroup>
          <Field>
            <FieldLabel>Who gets it</FieldLabel>
            <div className="flex flex-col gap-1" role="radiogroup" aria-label="Who gets it">
              {options.map((key) => (
                <label
                  key={key}
                  className="hover:bg-muted/60 has-[:checked]:bg-muted flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5"
                >
                  <input
                    type="radio"
                    name="audience"
                    value={key}
                    checked={audience === key}
                    onChange={() => setAudience(key)}
                    className="accent-primary mt-1"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline justify-between gap-3 text-sm font-medium">
                      {AUDIENCES[key].label}
                      <span className="text-muted-foreground tabular-nums font-normal">
                        {audiences.counts[key].toLocaleString()}
                      </span>
                    </span>
                    <span className="text-muted-foreground text-sm">{AUDIENCES[key].note}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="email-subject">Subject</FieldLabel>
            <Input
              id="email-subject"
              value={subject}
              maxLength={150}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="New in Takewon: Best Moments"
            />
            <FieldDescription>
              Say plainly what&rsquo;s inside. Honest subjects are the law.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="email-heading">Heading</FieldLabel>
            <Input
              id="email-heading"
              value={heading}
              maxLength={150}
              onChange={(event) => setHeading(event.target.value)}
              placeholder="The subject, unless you write another"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="email-body">Message</FieldLabel>
            <Textarea
              id="email-body"
              value={body}
              rows={10}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Leave a blank line between paragraphs."
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="email-button-label">Button</FieldLabel>
              <Input
                id="email-button-label"
                value={buttonLabel}
                maxLength={60}
                onChange={(event) => setButtonLabel(event.target.value)}
                placeholder="Try it"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="email-button-url">Button link</FieldLabel>
              <Input
                id="email-button-url"
                value={buttonUrl}
                inputMode="url"
                onChange={(event) => setButtonUrl(event.target.value)}
                placeholder="https://app.takewon.com/library"
              />
            </Field>
          </div>
          <Field>
            <FieldLabel>When</FieldLabel>
            <Segmented
              aria-label="When"
              value={timing}
              onValueChange={setTiming}
              options={[
                { value: "now", label: "Send now" },
                { value: "later", label: "Send later" },
              ]}
              className="max-w-xs"
            />
            {timing === "later" && (
              <Input
                type="datetime-local"
                aria-label="Send at"
                value={sendAt}
                onChange={(event) => setSendAt(event.target.value)}
                className="max-w-xs"
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!ready || reach === 0 || (timing === "later" && !at)}
              onClick={() => setConfirming(true)}
            >
              <Send aria-hidden="true" />
              {timing === "later" ? "Schedule" : "Send"}
            </Button>
            <Button variant="outline" disabled={!ready || testing} onClick={() => void test()}>
              {testing ? "Sending test" : "Send me a test"}
            </Button>
          </div>
        </FieldGroup>

        <section aria-label="Preview" className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-medium">Preview</h2>
            <p className="text-muted-foreground truncate text-sm">
              {preview ? preview.subject : "Loading"}
            </p>
          </div>
          {preview ? (
            <iframe
              title="Email preview"
              srcDoc={preview.html}
              sandbox=""
              className="bg-muted h-[640px] w-full rounded-xl"
            />
          ) : (
            <Skeleton className="h-[640px] rounded-xl" />
          )}
        </section>
      </div>

      <AlertDialog open={confirming} onOpenChange={(open) => !sending && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {at ? `Schedule for ${people}?` : `Send to ${people} now?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {AUDIENCES[audience].label}
              {at
                ? `, on ${when.format(at)}. You can call it off until then.`
                : ". It can't be taken back once it goes."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Cancel</AlertDialogCancel>
            <Button disabled={sending} onClick={() => void send()}>
              {sending ? "Sending" : at ? "Schedule" : "Send"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
