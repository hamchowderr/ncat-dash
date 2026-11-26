"use client";

import { api } from "@convex/_generated/api";
import Bowser from "bowser";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft, CheckCircle2, Mail, Plus, SendHorizontal } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { Composer, listTime, MessageList } from "./conversation";

type Request = FunctionReturnType<typeof api.support.mine>[number];

/** "Firefox 140 on Windows 11", for support; nothing is sent when it can't be read. */
export function describeBrowser(userAgent: string): string | undefined {
  if (!userAgent) return undefined;
  const parsed = Bowser.parse(userAgent);
  const browser = [parsed.browser.name, parsed.browser.version?.split(".")[0]]
    .filter(Boolean)
    .join(" ");
  const os = [parsed.os.name, parsed.os.versionName ?? parsed.os.version].filter(Boolean).join(" ");
  const both = [browser, os].filter(Boolean).join(" on ");
  return both || undefined;
}

/**
 * Get help: the person's questions to support and the answers, like the Messages tab of
 * Intercom's messenger, as a page of its own so nothing covers what they were doing. A
 * new question keeps the page they came from, their browser and their team's latest
 * runs, so support doesn't need to ask.
 */
export function HelpView() {
  const team = useActiveTeam();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const requests = useQuery(api.support.mine, {});
  const contact = useQuery(api.support.contact, {});
  const selected = search.get("ticket");
  const writing = search.get("new") === "1" || (requests !== undefined && requests.length === 0);
  const cameFrom = search.get("from") ?? undefined;

  const go = (params: Record<string, string | null>) => {
    const next = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(params)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const tail = next.toString();
    router.replace(tail ? `${pathname}?${tail}` : pathname, { scroll: false });
  };

  const showingDetail = Boolean(selected) || writing;

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Get Help</h1>
          <p className="text-muted-foreground max-w-prose text-sm">
            Ask a question or tell us what went wrong. We answer here, and send you an email when we
            do.
          </p>
        </div>
        {contact?.email && (
          <a
            href={`mailto:${contact.email}`}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
          >
            <Mail className="size-4" aria-hidden="true" />
            Or email {contact.email}
          </a>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <section
          aria-label="Your questions"
          className={cn("grid content-start gap-2", showingDetail && "max-lg:hidden")}
        >
          <Button
            variant={writing ? "secondary" : "outline"}
            className="justify-start"
            onClick={() => go({ new: "1", ticket: null })}
          >
            <Plus />
            Ask a new question
          </Button>
          {requests === undefined ? (
            [0, 1].map((index) => <Skeleton key={index} className="h-16 rounded-xl" />)
          ) : requests.length === 0 ? null : (
            <ul className="grid gap-1">
              {requests.map((request) => (
                <RequestRow
                  key={request.id}
                  request={request}
                  active={request.id === selected}
                  onOpen={() => go({ ticket: request.id, new: null })}
                />
              ))}
            </ul>
          )}
        </section>

        <section aria-label={writing ? "New question" : "Conversation"} className="min-w-0">
          {selected && !writing ? (
            <RequestConversation ticketId={selected} onBack={() => go({ ticket: null })} />
          ) : writing ? (
            <NewRequest
              organizationId={team.id}
              page={cameFrom}
              canGoBack={(requests?.length ?? 0) > 0}
              onBack={() => go({ new: null })}
              onSent={(ticketId) => go({ ticket: ticketId, new: null })}
            />
          ) : requests === undefined ? null : (
            <p className="text-muted-foreground bg-surface rounded-xl px-5 py-8 text-sm max-lg:hidden">
              Pick a question on the left to see the conversation.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function RequestRow({
  request,
  active,
  onOpen,
}: {
  request: Request;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "true" : undefined}
        data-request={request.unread ? "new" : "seen"}
        className={cn(
          "hover:bg-muted/60 focus-visible:ring-ring/50 grid w-full gap-0.5 rounded-xl px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-3",
          active && "bg-muted",
        )}
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className={cn("truncate text-sm", request.unread && "font-semibold")}>
            {request.subject}
          </span>
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {listTime(request.lastMessageAt)}
          </span>
        </span>
        <span className="text-muted-foreground line-clamp-1 text-sm">{request.preview}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs">
          {request.unread && (
            <span className="bg-destructive size-1.5 rounded-full" aria-hidden="true" />
          )}
          <span
            className={request.unread ? "text-foreground font-medium" : "text-muted-foreground"}
          >
            {request.status === "closed"
              ? "Solved"
              : request.answered
                ? request.unread
                  ? "New answer"
                  : "Answered"
                : "Waiting for an answer"}
          </span>
          <span className="text-muted-foreground">· #{request.number}</span>
        </span>
      </button>
    </li>
  );
}

function RequestConversation({ ticketId, onBack }: { ticketId: string; onBack: () => void }) {
  const data = useQuery(api.support.conversation, { ticketId });
  const reply = useMutation(api.support.reply);
  const close = useMutation(api.support.close);
  const markRead = useMutation(api.support.markRead);
  const unread = data?.ticket.unread;

  useEffect(() => {
    if (unread) void markRead({ ticketId });
  }, [unread, ticketId, markRead]);

  if (data === undefined) return <Skeleton className="h-64 rounded-2xl" />;
  if (data === null) {
    return (
      <p className="text-muted-foreground bg-surface rounded-xl px-5 py-8 text-sm">
        That question isn&apos;t here any more.
      </p>
    );
  }
  const { ticket, messages } = data;
  return (
    <div className="grid gap-5">
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
            <h2 className="text-lg font-semibold tracking-tight break-words">{ticket.subject}</h2>
            <p className="text-muted-foreground text-xs">
              #{ticket.number} · {ticket.status === "closed" ? "Solved" : "Open"}
            </p>
          </div>
        </div>
        {ticket.status === "open" && (
          <Button variant="ghost" size="sm" onClick={() => void close({ ticketId })}>
            <CheckCircle2 />
            This is solved
          </Button>
        )}
      </div>
      <MessageList messages={messages} mine="customer" />
      <Composer
        placeholder={
          ticket.status === "closed"
            ? "Writing again opens this question again."
            : "Add more, or answer support."
        }
        onSend={(body) => reply({ ticketId, body })}
      />
    </div>
  );
}

function NewRequest({
  organizationId,
  page,
  canGoBack,
  onBack,
  onSent,
}: {
  organizationId: string;
  page?: string;
  canGoBack: boolean;
  onBack: () => void;
  onSent: (ticketId: string) => void;
}) {
  const open = useMutation(api.support.open);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const browser = describeBrowser(navigator.userAgent);
      const { ticketId } = await open({
        organizationId,
        subject,
        body,
        ...(page ? { page } : {}),
        ...(browser ? { browser } : {}),
      });
      onSent(ticketId);
    } catch (caught) {
      setError(errorMessage(caught, "That didn't send. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="bg-surface grid gap-4 rounded-2xl p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-center gap-2">
        {canGoBack && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-ml-2 size-8 lg:hidden"
            onClick={onBack}
          >
            <ArrowLeft />
            <span className="sr-only">All questions</span>
          </Button>
        )}
        <h2 className="text-lg font-semibold tracking-tight">Ask a new question</h2>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="help-subject">What is it about?</Label>
        <Input
          id="help-subject"
          value={subject}
          maxLength={200}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Captions are a second late"
          className="bg-background"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="help-body">Tell us more</Label>
        <Textarea
          id="help-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="What you did, what you expected, and what happened instead."
          className="bg-background min-h-32"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}
          role={error ? "alert" : undefined}
        >
          {error ??
            "We see your team, the page you came from and your latest runs, so you don't have to explain them."}
        </p>
        <Button type="submit" disabled={busy || !subject.trim() || !body.trim()}>
          <SendHorizontal />
          Send
        </Button>
      </div>
    </form>
  );
}
