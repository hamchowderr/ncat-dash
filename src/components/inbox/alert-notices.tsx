"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { notifyDesktop, setDesktopUnseen } from "@/lib/desktop";
import { useActiveTeam } from "@/lib/team-context";

import { alertDetail, alertTitle, LOOK } from "./alert-look";

/** The Inbox page: news there is already in front of the person. */
export const INBOX = "/inbox";

/**
 * Pops up a notice the moment a run fails, an approval starts waiting for the person or
 * someone mentions them. Nothing is drawn otherwise. Alerts that were already there when
 * the page opened are not announced again, and on the Inbox page nothing pops up: the
 * list there says the same, and nothing should sit on top of it.
 *
 * In the desktop app each new alert is also a system notification (the app skips it while
 * its window is in front), and the unseen count goes on the tray and the Dock or taskbar.
 */
export function AlertNotices() {
  const team = useActiveTeam();
  const router = useRouter();
  const pathname = usePathname();
  const data = useQuery(api.alerts.list, { organizationId: team.id });
  const markSeen = useMutation(api.alerts.markSeen);
  const announced = useRef<Set<string> | null>(null);
  const notices = useRef<Set<string>>(new Set());
  const onInbox = pathname === INBOX;
  const onInboxRef = useRef(onInbox);

  useEffect(() => {
    onInboxRef.current = onInbox;
    if (!onInbox) return;
    for (const id of notices.current) toast.dismiss(id);
    notices.current.clear();
  }, [onInbox]);

  const unseen = data?.unseen;
  useEffect(() => {
    if (unseen !== undefined) void setDesktopUnseen(unseen);
  }, [unseen]);

  useEffect(() => {
    if (!data) return;
    if (announced.current === null) {
      announced.current = new Set(data.alerts.map((alert) => alert._id));
      return;
    }
    for (const alert of data.alerts) {
      if (announced.current.has(alert._id)) continue;
      announced.current.add(alert._id);
      if (alert.seen) continue;
      // Seen from the desktop, the window may be hidden, even on the Inbox page.
      void notifyDesktop(alertTitle(alert), alertDetail(alert));
      if (onInboxRef.current) continue;
      const id = `alert-${alert._id}`;
      (alert.kind === "run_failed" ? toast.error : toast.info)(alertTitle(alert), {
        id,
        description: alertDetail(alert),
        duration: 15_000,
        onDismiss: () => notices.current.delete(id),
        onAutoClose: () => notices.current.delete(id),
        action: {
          label: LOOK[alert.kind].action,
          onClick: () => {
            void markSeen({ organizationId: team.id, alertId: alert._id });
            router.push(alert.href);
          },
        },
      });
      notices.current.add(id);
    }
  }, [data, markSeen, router, team.id]);

  return null;
}

/** How many alerts the person has not seen yet, for the Inbox entry in the menu. */
export function useUnseenAlerts(): number {
  const team = useActiveTeam();
  return useQuery(api.alerts.list, { organizationId: team.id })?.unseen ?? 0;
}
