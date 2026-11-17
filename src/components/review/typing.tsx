"use client";

import { useEffect, useRef } from "react";

/** Where someone is writing: a new comment (no thread) or a reply in a thread. */
export type TypingPlace = { clipId: string; version: number; threadId: string | null };

/** Someone writing on the clip and version on screen. */
export type Typist = { id: string; name: string; threadId: string | null };

/** How long after the last key someone still counts as typing. */
const IDLE = 4_000;
/** How often a long stretch of typing is said again, so it does not look stopped. */
const REFRESH = 2_500;

/**
 * Tells the room what this person is writing, without a message per key: once when they
 * start or move to another thread, again every few seconds while they keep going, and
 * "stopped" after a pause, on send, or when they leave the box.
 */
export function useTypingSignal(send: (place: TypingPlace | null) => void) {
  const current = useRef<{ key: string; at: number } | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });

  function stop() {
    if (idle.current) clearTimeout(idle.current);
    idle.current = null;
    if (current.current) {
      current.current = null;
      sendRef.current(null);
    }
  }

  // Leaving the clip or the page stops it too.
  useEffect(() => stop, []);

  return (place: TypingPlace, active: boolean) => {
    if (!active) {
      stop();
      return;
    }
    const key = `${place.clipId}:${place.version}:${place.threadId ?? ""}`;
    const now = Date.now();
    if (!current.current || current.current.key !== key || now - current.current.at > REFRESH) {
      current.current = { key, at: now };
      sendRef.current(place);
    }
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(stop, IDLE);
  };
}

/** "Maya is typing…", "Maya and Riley are typing…", "3 people are typing…". */
export function typingText(names: string[]): string {
  const first = (name: string) => name.split(" ")[0];
  if (names.length === 1) return `${first(names[0])} is typing…`;
  if (names.length === 2) return `${first(names[0])} and ${first(names[1])} are typing…`;
  return `${names.length} people are typing…`;
}

export function TypingLine({ names, className }: { names: string[]; className?: string }) {
  if (names.length === 0) return null;
  return (
    <p
      role="status"
      data-typing
      className={`text-muted-foreground flex items-center gap-1.5 text-xs ${className ?? ""}`}
    >
      <span aria-hidden="true" className="flex gap-0.5">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="bg-muted-foreground/70 size-1 animate-bounce rounded-full"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      {typingText(names)}
    </p>
  );
}
