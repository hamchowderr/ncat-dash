"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef } from "react";

/**
 * The time zone the app works in for this person: the one on their profile (Settings >
 * Account), or the browser's until that has loaded. Daily summaries, new calendar
 * times, new schedules and the agent's sense of "today" all go by it, so they stay in
 * step when someone opens Takewon from a laptop set to another zone.
 */
let preferred: string | undefined;

/** The browser's IANA zone, such as "America/Los_Angeles", or undefined. */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** The profile's zone, else the browser's, else UTC. */
export function myTimeZone(): string {
  return preferred ?? browserTimeZone() ?? "UTC";
}

/** For tests and for TimeZoneSync. */
export function setPreferredTimeZone(zone: string | undefined) {
  preferred = zone;
}

/**
 * Keeps `myTimeZone()` on the profile's zone, and the first time someone signs in with
 * none saved, saves the browser's. Draws nothing.
 */
export function TimeZoneSync() {
  const profile = useQuery(api.profiles.mine);
  const fill = useMutation(api.profiles.fillTimeZone);
  const filled = useRef(false);
  useEffect(() => {
    if (!profile) return;
    setPreferredTimeZone(profile.timeZone ?? undefined);
    const here = browserTimeZone();
    if (!profile.timeZone && here && !filled.current) {
      filled.current = true;
      void fill({ timeZone: here });
    }
  }, [profile, fill]);
  return null;
}
