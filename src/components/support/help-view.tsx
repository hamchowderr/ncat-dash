"use client";

import { api } from "@convex/_generated/api";
import Bowser from "bowser";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { categoryForPage, type SupportCategory } from "@convex/lib/supportCategories";
import { ArrowLeft, Bot, CheckCircle2, Mail, Plus, SendHorizontal } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { showAgent } from "@/lib/agent-open";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { CategoryLabel, CategoryPicker, ViaLabel } from "./categories";
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
 * runs, so support doesn't need to ask. Before anyone has asked anything, the page is
 * just the form, in one calm column.
 */
export function HelpView() {
  const team = useActiveTeam();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const requests = useQuery(api.support.mine, {});
  const contact = useQuery(api.support.contact, {});
  const selected = search.get("ticket");
  const none = requests !== undefined && requests.length === 0;
  const writing = search.get("new") === "1" || none;
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
  const form = (
    <NewRequest
      organizationId={team.id}
      page={cameFrom}
      canGoBack={!none}
      onBack={() => go({ new: null })}
      onSent={(ticketId) => go({ ticket: ticketId, new: null })}
    />
  );

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Get Help</h1>
          <p className="text-muted-foreground max-w-prose text-sm">
            Ask a question or tell us what went wrong. We answer here, and email you when we do.
          </p>
        </div>
        {!none && requests !== undefined && !writing && (
          <Button onClick={() => go({ new: "1", ticket: null })}>
            <Plus />
            New question
          </Button>
        )}
      </div>

      {requests === undefined ? (
        <Skeleton className="h-64 w-full max-w-2xl rounded-2xl" />
      ) : none ? (
        <div className="grid w-full max-w-2xl gap-8">
          {form}
          <OtherWays email={contact?.email ?? null} />
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <section
            aria-label="Your questions"
            className={cn("grid content-start gap-6", showingDetail && "max-lg:hidden")}
          >
            <ul className="grid gap-1">
              {requests.map((request) => (
                <RequestRow
                  key={request.id}
                  request={request}
                  active={request.id === selected && !writing}
                  onOpen={() => go({ ticket: request.id, new: null })}
                />
              ))}
            </ul>
            <OtherWays email={contact?.email ?? null} />
          </section>

          <section
            aria-label={writing ? "New question" : "Conversation"}
            className="min-w-0 max-w-3xl"
          >
            {writing ? (
              form
            ) : selected ? (
              <RequestConversation ticketId={selected} onBack={() => go({ ticket: null })} />
            ) : (
              <p className="text-muted-foreground px-1 py-2 text-sm max-lg:hidden">
                Pick a question to see the conversation.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/**
 * The other ways in, kept quiet under the form or the list: the assistant, which can
 * often fix things at once and sends a request here when it can't, and the email address.
 */
function OtherWays({ email }: { email: string | null }) {
  return (
    <div className="text-muted-foreground grid gap-3 text-sm" data-other-ways>
      <div className="flex items-start gap-3">
        <Bot className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0">
          The assistant can often fix it right away, and sends it here for you when it can&apos;t.{" "}
          <button
            type="button"
            onClick={() => showAgent(true)}
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            Ask the assistant
          </button>
        </p>
      </div>
      {email && (
        <div className="flex items-start gap-3">
          <Mail className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0">
            Or email{" "}
            <a
              href={`mailto:${email}`}
              className="text-foreground font-medium underline-offset-4 hover:underline"
            >
              {email}
            </a>
          </p>
        </div>
      )}
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
          "focus-visible:ring-ring/50 grid w-full gap-0.5 rounded-xl px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-3",
          active ? "row-selected" : "hover:bg-muted/60",
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
        <span className="mt-1 flex min-w-0 items-center gap-2 text-xs">
          {request.unread && (
            <span className="bg-destructive size-1.5 shrink-0 rounded-full" aria-hidden="true" />
          )}
          <span
            className={cn(
              "shrink-0",
              request.unread ? "text-foreground font-medium" : "text-muted-foreground",
            )}
          >
            {request.status === "closed"
              ? "Solved"
              : request.answered
                ? request.unread
                  ? "New answer"
                  : "Answered"
                : "Waiting for an answer"}
          </span>
          <CategoryLabel category={request.category} />
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
            <h2 className="text-lg font-semibold tracking-tight text-balance break-words">
              {ticket.subject}
            </h2>
            <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span>
                #{ticket.number} · {ticket.status === "closed" ? "Solved" : "Open"}
              </span>
              <CategoryLabel category={ticket.category} />
              <ViaLabel via={ticket.via} />
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
  // A first guess from the page they came from; one click picks another.
  const [category, setCategory] = useState<SupportCategory | null>(() => categoryForPage(page));
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = category !== null && subject.trim() !== "" && body.trim() !== "";

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const browser = describeBrowser(navigator.userAgent);
      const { ticketId } = await open({
        organizationId,
        category,
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
      className="grid gap-6"
      aria-label="Ask a new question"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {canGoBack && (
        <div className="flex items-center gap-2">
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
          <h2 className="text-lg font-semibold tracking-tight">New question</h2>
        </div>
      )}
      <fieldset className="grid gap-2.5">
        <legend className="mb-2.5 text-sm font-medium">What do you need help with?</legend>
        <CategoryPicker value={category} onChange={setCategory} />
      </fieldset>
      <div className="grid gap-1.5">
        <Label htmlFor="help-subject">Subject</Label>
        <Input
          id="help-subject"
          value={subject}
          maxLength={200}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Captions are a second late"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="help-body">Details</Label>
        <Textarea
          id="help-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="What you did, what you expected, and what happened instead."
          className="min-h-36"
        />
        <p className="text-muted-foreground text-xs">
          Your team, the page you came from and your latest runs go with it, so there&apos;s no need
          to explain them.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {error && (
          <p className="text-destructive mr-auto text-sm" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || !ready}>
          <SendHorizontal />
          Send
        </Button>
      </div>
    </form>
  );
}
