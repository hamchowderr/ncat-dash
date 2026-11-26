"use client";

import { Lock, SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/catalog";
import { cn } from "@/lib/utils";

export type ShownMessage = {
  id: string;
  at: number;
  from: "customer" | "staff";
  authorName: string;
  body: string;
  private: boolean;
};

const stamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const short = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const monthDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** "3:04 PM" today, "Nov 24" before. Beside a request in a list. */
export function listTime(at: number, now = Date.now()): string {
  return new Date(at).toDateString() === new Date(now).toDateString()
    ? short.format(at)
    : monthDay.format(at);
}

/**
 * The messages of one request, oldest first, as a chat. `mine` is the side the viewer is
 * on: their messages sit on the right, a step darker. A private note shows on a soft amber wash with a
 * lock, as in Help Scout and Zendesk, so nobody mistakes it for an answer.
 */
export function MessageList({
  messages,
  mine,
}: {
  messages: ShownMessage[];
  mine: "customer" | "staff";
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length]);
  return (
    <ol className="grid gap-4" aria-label="Messages">
      {messages.map((message) => {
        const own = message.from === mine;
        return (
          <li
            key={message.id}
            data-message-from={message.from}
            data-private={message.private || undefined}
            className={cn("flex flex-col gap-1", own ? "items-end" : "items-start")}
          >
            <span className="text-muted-foreground flex items-center gap-1.5 px-1 text-xs">
              {message.private && <Lock className="size-3" aria-hidden="true" />}
              <span className="text-foreground/80 font-medium">
                {message.private ? `Private note by ${message.authorName}` : message.authorName}
              </span>
              <time dateTime={new Date(message.at).toISOString()}>{stamp.format(message.at)}</time>
            </span>
            <div
              className={cn(
                "max-w-[min(36rem,100%)] rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap",
                message.private ? "bg-amber-50 text-amber-950" : own ? "bg-selected" : "bg-surface",
              )}
            >
              {message.body}
            </div>
          </li>
        );
      })}
      <div ref={end} />
    </ol>
  );
}

/**
 * Where a reply is written. Enter adds a line; Ctrl or Cmd with Enter sends. With
 * `notes`, support can switch between an answer and a private note.
 */
export function Composer({
  onSend,
  placeholder,
  notes = false,
  label = "Send",
}: {
  onSend: (body: string, isPrivate: boolean) => Promise<unknown>;
  placeholder: string;
  notes?: boolean;
  label?: string;
}) {
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPrivate = notes && mode === "note";

  async function send() {
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(body, isPrivate);
      setBody("");
    } catch (caught) {
      setError(errorMessage(caught, "That didn't send. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={cn(
        "grid gap-2 rounded-2xl p-2 transition-colors",
        isPrivate ? "bg-amber-50" : "bg-surface",
      )}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      {notes && (
        <Segmented
          aria-label="Write"
          className="w-fit"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "reply", label: "Answer" },
            { value: "note", label: "Private note" },
          ]}
        />
      )}
      <Textarea
        aria-label={isPrivate ? "Private note" : notes ? "Your answer" : "Your message"}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void send();
          }
        }}
        placeholder={isPrivate ? "Only support sees this. Nothing is sent." : placeholder}
        className="max-h-60 min-h-20 border-0 bg-transparent shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center justify-between gap-3 px-1">
        <p
          className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}
          role={error ? "alert" : undefined}
        >
          {error ??
            (isPrivate
              ? "A note stays here. The customer never sees it."
              : "Ctrl or ⌘ with Enter sends.")}
        </p>
        <Button type="submit" size="sm" disabled={!body.trim() || busy}>
          {isPrivate ? <Lock /> : <SendHorizontal />}
          {isPrivate ? "Add note" : label}
        </Button>
      </div>
    </form>
  );
}
