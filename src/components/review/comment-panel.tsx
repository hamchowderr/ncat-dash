"use client";

import { formatMoment, splitBody, type Thread } from "@ncat-dash/review-core";
import { Check, CircleCheck, CornerDownRight, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Composer } from "./composer";
import { Face, type Person } from "./person";

export type RoomComment = {
  id: string;
  parentId: string | null;
  version: number;
  time: number;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: number;
  resolved: boolean;
  mine: boolean;
};

const clock = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function when(at: number): string {
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  return today ? clock.format(date) : `${day.format(date)}, ${clock.format(date)}`;
}

function Body({ text, people }: { text: string; people: Person[] }) {
  return (
    <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
      {splitBody(text, people).map((part, index) =>
        part.mention ? (
          <span key={index} className="bg-primary/10 text-primary rounded px-1 py-0.5 font-medium">
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}

function Entry({
  comment,
  people,
  small,
  timed,
  onSeek,
  onDelete,
}: {
  comment: RoomComment;
  people: Person[];
  small?: boolean;
  /** Whether to show the moment; replies and comments on a still do not. */
  timed: boolean;
  onSeek: (seconds: number) => void;
  onDelete: (id: string) => void;
}) {
  const author = people.find((person) => person.id === comment.authorId);
  return (
    <div className="group/entry flex gap-2.5">
      <Face
        id={comment.authorId}
        name={comment.authorName}
        image={author?.image}
        className={small ? "mt-0.5 size-5 text-[0.5rem]" : "mt-0.5"}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium">{comment.authorName}</span>
          {timed && (
            <button
              type="button"
              onClick={() => onSeek(comment.time)}
              aria-label={`Jump to ${formatMoment(comment.time)}`}
              className="bg-foreground text-background focus-visible:ring-ring/50 rounded-md px-1.5 py-0.5 font-mono text-[0.7rem] leading-none tabular-nums outline-none focus-visible:ring-3"
            >
              {formatMoment(comment.time)}
            </button>
          )}
          <span className="text-muted-foreground text-xs">{when(comment.createdAt)}</span>
          {comment.mine && (
            <button
              type="button"
              onClick={() => onDelete(comment.id)}
              aria-label="Delete your comment"
              className="text-muted-foreground hover:text-destructive focus-visible:ring-ring/50 ml-auto rounded opacity-0 outline-none group-hover/entry:opacity-100 focus-visible:opacity-100 focus-visible:ring-3"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
        <Body text={comment.body} people={people} />
      </div>
    </div>
  );
}

/** The conversation about one clip: threads in the order of the clip, and where to write. */
export function CommentPanel({
  threads,
  loading,
  people,
  timed,
  moment,
  active,
  onSeek,
  onActive,
  onComposerFocus,
  onSend,
  onResolve,
  onDelete,
}: {
  threads: Thread<RoomComment>[];
  loading: boolean;
  people: Person[];
  timed: boolean;
  moment: number;
  active: string | null;
  onSeek: (seconds: number) => void;
  onActive: (id: string | null) => void;
  onComposerFocus: () => void;
  onSend: (body: string, parentId?: string) => Promise<boolean>;
  onResolve: (id: string, resolved: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const open = threads.filter((thread) => !thread.root.resolved).length;

  return (
    <section
      aria-label="Comments"
      className="bg-card flex min-h-96 min-w-0 flex-col overflow-hidden rounded-xl border"
    >
      <header className="flex items-baseline gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Comments</h2>
        <span className="text-muted-foreground text-xs">
          {threads.length === 0
            ? "None on this clip yet"
            : open === 0
              ? "All resolved"
              : `${open} to resolve`}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? null : threads.length === 0 ? (
          <p className="text-muted-foreground px-4 py-6 text-sm">
            {timed
              ? "Pause where something needs a note and write it below. It stays pinned to that moment for the whole team."
              : "Write a note below. The whole team sees it here."}
          </p>
        ) : (
          <ol className="divide-y">
            {threads.map(({ root, replies }) => (
              <li
                key={root.id}
                id={`thread-${root.id}`}
                onClick={() => onActive(root.id)}
                className={cn(
                  "flex flex-col gap-3 px-4 py-3.5 transition-colors",
                  active === root.id && "bg-muted/60",
                  root.resolved && active !== root.id && "opacity-60",
                )}
              >
                <Entry
                  comment={root}
                  people={people}
                  timed={timed}
                  onSeek={onSeek}
                  onDelete={onDelete}
                />
                {replies.length > 0 && (
                  <div className="ml-9 flex flex-col gap-3">
                    {replies.map((reply) => (
                      <Entry
                        key={reply.id}
                        comment={reply}
                        people={people}
                        small
                        timed={false}
                        onSeek={onSeek}
                        onDelete={onDelete}
                      />
                    ))}
                  </div>
                )}
                {replyTo === root.id ? (
                  <div className="ml-9">
                    <Composer
                      people={people}
                      placeholder="Reply"
                      autoFocus
                      onSend={async (body) => {
                        const saved = await onSend(body, root.id);
                        if (saved) setReplyTo(null);
                        return saved;
                      }}
                    />
                  </div>
                ) : (
                  <div className="ml-9 flex items-center gap-1">
                    <Button variant="ghost" size="xs" onClick={() => setReplyTo(root.id)}>
                      <CornerDownRight />
                      Reply
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-pressed={root.resolved}
                      onClick={() => onResolve(root.id, !root.resolved)}
                    >
                      {root.resolved ? <CircleCheck className="text-emerald-600" /> : <Check />}
                      {root.resolved ? "Resolved" : "Resolve"}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="border-t p-3">
        <Composer
          people={people}
          moment={timed ? moment : undefined}
          placeholder={
            timed
              ? "Comment at this moment. Type @ to tag a teammate."
              : "Comment. Type @ to tag a teammate."
          }
          onFocus={onComposerFocus}
          onSend={(body) => onSend(body)}
        />
      </div>
    </section>
  );
}
