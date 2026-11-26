"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ItemBadge, ItemList, ItemRow, MetaLine, Pager, usePages } from "@/components/ui/item-list";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { exactly, timeAgo } from "@/lib/when";

import { AUDIENCES, OperatorOnly } from "./operator-only";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

type Status = "scheduled" | "sending" | "sent" | "cancelled" | "failed";

const STATUS: Record<Status, { label: string; dot: "green" | "amber" | "red" | "grey" }> = {
  scheduled: { label: "Scheduled", dot: "amber" },
  sending: { label: "Sending", dot: "amber" },
  sent: { label: "Sent", dot: "green" },
  cancelled: { label: "Called off", dot: "grey" },
  failed: { label: "Failed", dot: "red" },
};

type Counts = {
  recipients: number;
  sent: number;
  failed: number;
  skipped: number;
  bounced: number;
  complaints: number;
  unsubscribed: number;
};

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** "Sent to 120 · 2 bounced · 1 unsubscribed", leaving out what is zero. */
export function countsLine(row: Counts): string {
  const parts = [`Sent to ${row.sent.toLocaleString()}`];
  if (row.failed) parts.push(`${row.failed.toLocaleString()} failed`);
  if (row.skipped) parts.push(`${row.skipped.toLocaleString()} skipped`);
  if (row.bounced) parts.push(`${row.bounced.toLocaleString()} bounced`);
  if (row.complaints) parts.push(plural(row.complaints, "spam report"));
  if (row.unsubscribed) parts.push(`${row.unsubscribed.toLocaleString()} unsubscribed`);
  return parts.join(" · ");
}

export function SentEmailsView() {
  return (
    <OperatorOnly>
      <SentEmails />
    </OperatorOnly>
  );
}

function SentEmails() {
  const rows = useQuery(api.broadcasts.list, {});
  const { shown, pager } = usePages(rows ?? [], "sent-emails");
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Sent Emails</h1>
          <p className="text-muted-foreground text-sm">
            Every email sent from Send An Email, newest first, and how each one went.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/admin/emails/new">Send an email</Link>
        </Button>
      </div>
      {rows === undefined ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : rows.length === 0 ? (
        <p className="bg-surface text-muted-foreground rounded-xl p-6 text-sm">
          Nothing sent yet. Emails you send or schedule show here.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <ItemList label="Sent emails">
            {shown.map((row) => (
              <ItemRow
                key={row._id}
                href={`/admin/emails/${row._id}`}
                name={row.subject}
                openLabel={`${row.subject}, ${STATUS[row.status].label}`}
                meta={
                  <MetaLine>
                    <span>{AUDIENCES[row.audience].short}</span>
                    {row.status === "scheduled" && row.scheduledFor ? (
                      <span>For {when.format(row.scheduledFor)}</span>
                    ) : (
                      <span title={exactly(row.startedAt ?? row.createdAt)}>
                        {timeAgo(row.startedAt ?? row.createdAt)}
                      </span>
                    )}
                    {(row.status === "sent" ||
                      row.status === "sending" ||
                      row.status === "failed") && <span>{countsLine(row)}</span>}
                  </MetaLine>
                }
                badges={
                  <ItemBadge dot={STATUS[row.status].dot}>{STATUS[row.status].label}</ItemBadge>
                }
              />
            ))}
          </ItemList>
          <Pager {...pager} noun="emails" />
        </div>
      )}
    </>
  );
}

export function SentEmailView({ id }: { id: string }) {
  return (
    <OperatorOnly>
      <SentEmail id={id as Id<"broadcasts">} />
    </OperatorOnly>
  );
}

function SentEmail({ id }: { id: Id<"broadcasts"> }) {
  const found = useQuery(api.broadcasts.get, { broadcastId: id });
  const cancel = useMutation(api.broadcasts.cancel);
  const preview = useQuery(
    api.broadcasts.preview,
    found
      ? {
          draft: {
            subject: found.broadcast.subject,
            body: found.broadcast.body,
            audience: found.broadcast.audience,
            ...(found.broadcast.heading ? { heading: found.broadcast.heading } : {}),
            ...(found.broadcast.button ? { button: found.broadcast.button } : {}),
          },
        }
      : "skip",
  );
  if (found === undefined) return <Skeleton className="h-48 rounded-xl" />;
  if (found === null)
    return <p className="text-muted-foreground text-sm">That email isn&rsquo;t here any more.</p>;
  const { broadcast, failures } = found;
  const status = STATUS[broadcast.status];
  const stats: { label: string; value: number }[] = [
    { label: "People", value: broadcast.recipients },
    { label: "Sent", value: broadcast.sent },
    { label: "Failed", value: broadcast.failed },
    { label: "Skipped", value: broadcast.skipped },
    { label: "Bounced", value: broadcast.bounced },
    { label: "Spam reports", value: broadcast.complaints },
    { label: "Unsubscribed", value: broadcast.unsubscribed },
  ];

  const callOff = async () => {
    try {
      if (await cancel({ broadcastId: id })) toast.success("Called off. Nothing was sent.");
    } catch (error) {
      toast.error(errorMessage(error, "That didn't work. Try again."));
    }
  };

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link href="/admin/emails" className="text-muted-foreground text-sm hover:underline">
          Sent Emails
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{broadcast.subject}</h1>
          <ItemBadge dot={status.dot}>{status.label}</ItemBadge>
        </div>
        <p className="text-muted-foreground text-sm">
          {AUDIENCES[broadcast.audience].label}.{" "}
          {broadcast.status === "scheduled" && broadcast.scheduledFor
            ? `Goes out ${when.format(broadcast.scheduledFor)}.`
            : `Started ${when.format(broadcast.startedAt ?? broadcast.createdAt)}.`}{" "}
          By {broadcast.createdBy}.
        </p>
        {broadcast.problem && <p className="text-destructive text-sm">{broadcast.problem}</p>}
        {broadcast.status === "scheduled" && (
          <Button variant="outline" size="sm" className="self-start" onClick={() => void callOff()}>
            Call it off
          </Button>
        )}
      </div>

      {broadcast.status !== "scheduled" && broadcast.status !== "cancelled" && (
        <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4 lg:grid-cols-7">
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col gap-1">
              <dt className="text-muted-foreground text-sm">{stat.label}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{stat.value.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      )}

      {failures.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Why some didn&rsquo;t go</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {failures.map((failure) => (
              <li key={failure.email}>
                <span className="font-medium">{failure.email}</span>
                <span className="text-muted-foreground">: {failure.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="The email" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">The email</h2>
        {preview ? (
          <iframe
            title="The email"
            srcDoc={preview.html}
            sandbox=""
            className="bg-muted h-[640px] w-full max-w-3xl rounded-xl"
          />
        ) : (
          <Skeleton className="h-[640px] max-w-3xl rounded-xl" />
        )}
      </section>
    </>
  );
}
