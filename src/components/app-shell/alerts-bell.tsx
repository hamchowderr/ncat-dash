"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { Bell, CircleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function tries(retries: number): string {
  return retries > 0 ? ` after ${retries + 1} tries` : "";
}

/**
 * The bell at the top of every page. It counts the alerts the person has not seen,
 * lists the team's latest ones, and pops up a notice the moment a run fails.
 */
export function AlertsBell() {
  const team = useActiveTeam();
  const router = useRouter();
  const data = useQuery(api.alerts.list, { organizationId: team.id });
  const markSeen = useMutation(api.alerts.markSeen);
  const [open, setOpen] = useState(false);
  // Alerts that were already there when the page opened are not announced again.
  const announced = useRef<Set<string> | null>(null);

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
      const href = `/automations/${alert.automationId}/runs/${alert.runId}`;
      toast.error(`${alert.automationName} failed${tries(alert.retries)}`, {
        description: alert.stepName ? `${alert.stepName}: ${alert.message}` : alert.message,
        duration: 15_000,
        action: {
          label: "View run",
          onClick: () => {
            void markSeen({ organizationId: team.id, alertId: alert._id });
            router.push(href);
          },
        },
      });
    }
  }, [data, markSeen, router, team.id]);

  const unseen = data?.unseen ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-alerts-bell>
          <Bell />
          {unseen > 0 && (
            <span
              data-alerts-count
              className="bg-destructive absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-medium text-white tabular-nums"
            >
              {unseen > 9 ? "9+" : unseen}
            </span>
          )}
          <span className="sr-only">
            {unseen > 0 ? `Alerts, ${unseen} you have not seen` : "Alerts"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="text-sm font-medium">Alerts</h2>
          {unseen > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="-mr-2 h-7"
              onClick={() => void markSeen({ organizationId: team.id })}
            >
              Mark all as seen
            </Button>
          )}
        </div>
        {!data || data.alerts.length === 0 ? (
          <p className="text-muted-foreground px-4 py-6 text-sm">
            Nothing to report. When a run fails after all its tries, it shows up here for everyone
            on the team.
          </p>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {data.alerts.map((alert) => (
              <li key={alert._id} className="border-b last:border-b-0">
                <Link
                  href={`/automations/${alert.automationId}/runs/${alert.runId}`}
                  data-alert={alert.seen ? "seen" : "new"}
                  className={cn(
                    "hover:bg-muted/60 flex gap-3 px-4 py-3 outline-none focus-visible:bg-muted/60",
                    !alert.seen && "bg-destructive/5",
                  )}
                  onClick={() => {
                    setOpen(false);
                    if (!alert.seen) void markSeen({ organizationId: team.id, alertId: alert._id });
                  }}
                >
                  <CircleAlert
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      alert.seen ? "text-muted-foreground" : "text-destructive",
                    )}
                    aria-hidden="true"
                  />
                  <span className="grid min-w-0 gap-0.5">
                    <span className={cn("truncate text-sm", !alert.seen && "font-medium")}>
                      {alert.automationName} failed{tries(alert.retries)}
                    </span>
                    <span className="text-muted-foreground line-clamp-2 text-xs break-words">
                      {alert.stepName ? `${alert.stepName}: ` : ""}
                      {alert.message}
                    </span>
                    <span className="text-muted-foreground text-xs">{when.format(alert.at)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
