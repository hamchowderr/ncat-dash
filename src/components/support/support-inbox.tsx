"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft, CheckCircle2, RotateCcw } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import {
  categoryTitle,
  isSupportCategory,
  SUPPORT_CATEGORIES,
} from "@convex/lib/supportCategories";

import { Button } from "@/components/ui/button";
import { PickList } from "@/components/ui/pick-list";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { CategoryLabel, ViaLabel } from "./categories";
import { Composer, listTime, MessageList } from "./conversation";

type Row = FunctionReturnType<typeof api.support.inbox>["tickets"][number];
type Status = "open" | "closed";

/** What was kept with a request when it was asked, in the order support reads it. */
const CONTEXT_LABELS: [key: string, label: string][] = [
  ["team", "Team"],
  ["page", "Came from"],
  ["browser", "Browser"],
  ["latestRun", "Latest run"],
  ["latestFailedRun", "Latest failed run"],
];

/**
 * Support, under Admin: every customer's questions, the ones waiting for an answer first
 * in mind. Modelled on Help Scout's mailbox: the list on the left, the conversation in
 * the middle, who asked and from where beside it, and a reply box that switches between
 * an answer (emailed to them) and a private note (seen only here).
 */
export function SupportInbox() {
  const operator = useQuery(api.operator.me, {});
  if (operator === undefined) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (!operator) {
    return (
      <p className="text-muted-foreground bg-surface rounded-xl px-5 py-8 text-sm">
        Support is for whoever runs this copy of the app. To ask a question, open Get Help.
      </p>
    );
  }
  return <Inbox />;
}

function Inbox() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const status: Status = search.get("status") === "closed" ? "closed" : "open";
  const selected = search.get("ticket");
  const wanted = search.get("category");
  const category = isSupportCategory(wanted) ? wanted : null;
  const data = useQuery(api.support.inbox, { status, ...(category ? { category } : {}) });
  const openIn = (id: string) =>
    data?.counts.byCategory.find((each) => each.category === id)?.open ?? 0;

  const go = (params: Record<string, string | null>) => {
    const next = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(params)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const tail = next.toString();
    router.replace(tail ? `${pathname}?${tail}` : pathname, { scroll: false });
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Support</h1>
        <p className="text-muted-foreground max-w-prose text-sm">
          Questions from Get Help and the assistant. Answers reach people in the app and by email.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <section
          aria-label="Questions"
          className={cn("grid content-start gap-3", selected && "max-lg:hidden")}
        >
          <div className="grid gap-2">
            <Segmented
              aria-label="Show"
              className="w-fit"
              value={status}
              onValueChange={(each) => go({ status: each === "open" ? null : each, ticket: null })}
              options={[
                {
                  value: "open",
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      Open
                      {data && data.counts.open > 0 && (
                        <span className="text-muted-foreground tabular-nums">
                          {data.counts.open}
                        </span>
                      )}
                    </span>
                  ),
                },
                { value: "closed", label: "Closed" },
              ]}
            />
            <PickList
              aria-label="Category"
              size="sm"
              className="w-full"
              value={category ?? ""}
              onChange={(next) => go({ category: next || null, ticket: null })}
              options={[
                { value: "", label: "Every category" },
                ...SUPPORT_CATEGORIES.map((each) => ({
                  value: each.id,
                  label:
                    status === "open" && openIn(each.id) > 0
                      ? `${each.title} · ${openIn(each.id)}`
                      : each.title,
                })),
              ]}
            />
          </div>
          {!data ? (
            [0, 1, 2].map((index) => <Skeleton key={index} className="h-20 rounded-xl" />)
          ) : data.tickets.length === 0 ? (
            <p className="text-muted-foreground bg-surface rounded-xl px-5 py-8 text-sm">
              {category
                ? `Nothing ${status === "open" ? "open" : "closed"} under ${categoryTitle(category)}.`
                : status === "open"
                  ? "Nothing waiting. New questions show up here, and you get an email for each."
                  : "No closed questions yet."}
            </p>
          ) : (
            <ul className="grid gap-1">
              {data.tickets.map((row) => (
                <InboxRow
                  key={row.id}
                  row={row}
                  active={row.id === selected}
                  onOpen={() => go({ ticket: row.id })}
                />
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Conversation" className="min-w-0">
          {selected ? (
            <StaffConversation ticketId={selected} onBack={() => go({ ticket: null })} />
          ) : (
            <p className="text-muted-foreground bg-surface rounded-xl px-5 py-8 text-sm max-lg:hidden">
              Pick a question on the left to answer it.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function InboxRow({ row, active, onOpen }: { row: Row; active: boolean; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "true" : undefined}
        data-ticket={row.unread ? "new" : "seen"}
        className={cn(
          "focus-visible:ring-ring/50 grid w-full gap-0.5 rounded-xl px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-3",
          active ? "row-selected" : "hover:bg-muted/60",
        )}
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className={cn("truncate text-sm", row.unread && "font-semibold")}>
            {row.requesterName}
            {row.team && <span className="text-muted-foreground font-normal"> · {row.team}</span>}
          </span>
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {listTime(row.lastMessageAt)}
          </span>
        </span>
        <span
          className={cn("truncate text-sm", row.unread ? "text-foreground" : "text-foreground/80")}
        >
          {row.subject}
        </span>
        <span className="text-muted-foreground line-clamp-1 text-sm">{row.preview}</span>
        <span className="mt-1 flex min-w-0 items-center gap-2 text-xs">
          {row.unread && (
            <span className="bg-destructive size-1.5 shrink-0 rounded-full" aria-hidden="true" />
          )}
          <span
            className={cn(
              "shrink-0",
              row.waitingOnUs ? "text-foreground font-medium" : "text-muted-foreground",
            )}
          >
            {row.status === "closed" ? "Closed" : row.waitingOnUs ? "Needs an answer" : "Answered"}
          </span>
          <CategoryLabel category={row.category} />
        </span>
      </button>
    </li>
  );
}

function StaffConversation({ ticketId, onBack }: { ticketId: string; onBack: () => void }) {
  const data = useQuery(api.support.staffConversation, { ticketId });
  const answer = useMutation(api.support.answer);
  const setStatus = useMutation(api.support.setStatus);
  const markRead = useMutation(api.support.staffMarkRead);
  const setCategory = useMutation(api.support.setCategory);
  const unread = data?.ticket.unread;

  useEffect(() => {
    if (unread) void markRead({ ticketId });
  }, [unread, ticketId, markRead]);

  if (data === undefined) return <Skeleton className="h-64 rounded-2xl" />;
  if (data === null) {
    return (
      <p className="text-muted-foreground bg-surface rounded-xl px-5 py-8 text-sm">
        That question was deleted, with the account or team that asked it.
      </p>
    );
  }
  const { ticket, messages, context } = data;
  const facts = CONTEXT_LABELS.filter(([key]) => context[key]);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="grid min-w-0 content-start gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="-ml-2 size-8 shrink-0 lg:hidden"
              onClick={onBack}
            >
              <ArrowLeft />
              <span className="sr-only">All questions</span>
            </Button>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-balance break-words">
                {ticket.subject}
              </h2>
              <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span>
                  #{ticket.number} · {ticket.status === "closed" ? "Closed" : "Open"}
                </span>
                <ViaLabel via={ticket.via} />
              </p>
            </div>
          </div>
          {ticket.status === "open" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void setStatus({ ticketId, status: "closed" })}
            >
              <CheckCircle2 />
              Close
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void setStatus({ ticketId, status: "open" })}
            >
              <RotateCcw />
              Open again
            </Button>
          )}
        </div>
        <MessageList messages={messages} mine="staff" />
        <Composer
          notes
          label="Send answer"
          placeholder={`Answer ${ticket.requesterName.split(" ")[0]}. They get it here and by email.`}
          onSend={(body, isPrivate) => answer({ ticketId, body, private: isPrivate })}
        />
      </div>

      <aside aria-label="Who asked" className="grid content-start gap-4 text-sm">
        <div className="grid gap-0.5">
          <span className="font-medium">{ticket.requesterName}</span>
          <a
            href={`mailto:${ticket.requesterEmail}`}
            className="text-muted-foreground hover:text-foreground break-all"
          >
            {ticket.requesterEmail}
          </a>
        </div>
        <div className="grid gap-1">
          <label htmlFor="support-category" className="text-muted-foreground text-xs">
            Category
          </label>
          <PickList
            id="support-category"
            size="sm"
            value={ticket.category ?? ""}
            placeholder="None yet"
            onChange={(next) => {
              if (next) void setCategory({ ticketId, category: next });
            }}
            options={SUPPORT_CATEGORIES.map((each) => ({ value: each.id, label: each.title }))}
          />
        </div>
        {facts.length > 0 && (
          <dl className="grid gap-3">
            {facts.map(([key, label]) => (
              <div key={key} className="grid gap-0.5">
                <dt className="text-muted-foreground text-xs">{label}</dt>
                <dd className="break-words">{context[key]}</dd>
              </div>
            ))}
          </dl>
        )}
      </aside>
    </div>
  );
}
