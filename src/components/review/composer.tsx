"use client";

import {
  COMMENT_LIMIT,
  completeMention,
  formatMoment,
  matchPeople,
  mentionQuery,
} from "@ncat-dash/review-core";
import { ArrowUp, AtSign, Clock } from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Face, type Person } from "./person";

/**
 * Where a comment or a reply is written. Typing "@" offers the team's names; Enter
 * sends and Shift+Enter starts a new line.
 */
export function Composer({
  people,
  moment,
  placeholder,
  autoFocus,
  onFocus,
  onSend,
  tools,
  onTyping,
}: {
  people: Person[];
  /** The moment the comment will be pinned to; left out for a reply or a still image. */
  moment?: number;
  placeholder: string;
  autoFocus?: boolean;
  onFocus?: () => void;
  /** Resolves to whether the comment was saved; the text is kept when it was not. */
  onSend: (body: string) => Promise<boolean>;
  /** More buttons beside "Tag a teammate", such as drawing on the frame. */
  tools?: ReactNode;
  /** Told when writing starts or goes on (true) and when it stops (false). */
  onTyping?: (active: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [picked, setPicked] = useState(0);
  // The text the name list was closed for with Escape, so it stays closed until more is typed.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const listId = useId();

  const query = dismissed === text ? null : mentionQuery(text);
  const offered = query === null ? [] : matchPeople(query, people).slice(0, 6);
  const active = Math.min(picked, Math.max(0, offered.length - 1));

  function choose(person: Person) {
    const next = completeMention(text, person);
    setText(next);
    // The name is complete, so the list stays closed until more is typed.
    setDismissed(next);
    setPicked(0);
    field.current?.focus();
  }

  async function send() {
    const body = text.trim();
    if (body === "" || sending) return;
    setSending(true);
    const saved = await onSend(body);
    setSending(false);
    if (saved) {
      setText("");
      onTyping?.(false);
    }
  }

  return (
    <div className="bg-surface focus-within:ring-ring/50 relative rounded-xl focus-within:ring-3">
      {offered.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="People on the team"
          className="bg-popover text-popover-foreground absolute bottom-full left-0 z-20 mb-1.5 w-64 overflow-hidden rounded-lg p-1 shadow-lg"
        >
          {offered.map((person, index) => (
            <li
              key={person.id}
              role="option"
              aria-selected={index === active}
              // Keeps the writing place focused while a name is clicked.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(person)}
              onMouseEnter={() => setPicked(index)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                index === active && "bg-accent text-accent-foreground",
              )}
            >
              <Face {...person} className="size-5 text-[0.55rem]" />
              <span className="truncate">{person.name}</span>
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={field}
        value={text}
        rows={2}
        maxLength={COMMENT_LIMIT}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-controls={offered.length > 0 ? listId : undefined}
        onFocus={onFocus}
        onBlur={() => onTyping?.(false)}
        onChange={(event) => {
          setText(event.target.value);
          setPicked(0);
          onTyping?.(event.target.value.trim() !== "");
        }}
        onKeyDown={(event) => {
          if (offered.length > 0) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setPicked((active + step + offered.length) % offered.length);
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              choose(offered[active]);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDismissed(text);
              return;
            }
          }
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
        className="placeholder:text-muted-foreground block max-h-40 min-h-14 w-full resize-none bg-transparent px-3 pt-2.5 text-sm outline-none"
      />
      <div className="flex items-center gap-1 px-2 pb-2">
        {moment !== undefined && (
          <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs tabular-nums">
            <Clock className="size-3" aria-hidden="true" />
            {formatMoment(moment)}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Tag a teammate"
          onClick={() => {
            setText(text === "" || /\s$/.test(text) ? `${text}@` : `${text} @`);
            setDismissed(null);
            field.current?.focus();
          }}
        >
          <AtSign />
        </Button>
        {tools}
        <Button
          type="button"
          size="icon-sm"
          className="ml-auto"
          aria-label="Send comment"
          disabled={text.trim() === "" || sending}
          onClick={() => void send()}
        >
          <ArrowUp />
        </Button>
      </div>
    </div>
  );
}
