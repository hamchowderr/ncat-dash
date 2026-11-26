"use client";

import { useEffect, useState } from "react";
import { spokenSpan, transcriptIsSlow, transcriptLimitMs } from "@takewon/automation-core";

/**
 * What a file's Words tab says while its transcript is being made: how long it has been
 * going, and, once it runs longer than the video itself, that this is slow and when it
 * will be stopped (transcriptLimitMs), so nobody waits hours without knowing.
 */
export function TranscriptWait({
  since,
  duration,
  now: fixedNow,
}: {
  since: number | null;
  duration: number | null;
  /** For tests: the time to show it at. */
  now?: number;
}) {
  const [now, setNow] = useState(() => fixedNow ?? Date.now());
  useEffect(() => {
    if (fixedNow !== undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [fixedNow]);

  const elapsed = since === null ? null : Math.max(0, now - since);
  const slow = elapsed !== null && transcriptIsSlow(elapsed, duration);
  return (
    <div className="flex flex-col gap-1 text-sm" role="status">
      <p className="text-muted-foreground">
        Being transcribed
        {elapsed !== null && elapsed >= 60_000 ? `, ${spokenSpan(elapsed)} so far` : ""}. The words,
        SRT and VTT show here when it is done.
      </p>
      {slow && (
        <p className="text-amber-900">
          This is taking longer than the video itself, so the server doing it is busy or slow. It is
          stopped if it is not done after {spokenSpan(transcriptLimitMs(duration))}, and you can try
          again then.
        </p>
      )}
    </div>
  );
}
