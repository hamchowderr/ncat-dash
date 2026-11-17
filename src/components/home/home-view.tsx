"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { CircleAlertIcon, CircleCheckIcon, RefreshCwIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { FailureText } from "@/components/failure-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveTeam } from "@/lib/team-context";

const checkedAt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function HomeView() {
  const team = useActiveTeam();
  const connections = useQuery(api.toolkitConnections.list, { organizationId: team.id });
  const recheck = useAction(api.toolkitConnections.recheck);
  const [checking, setChecking] = useState<Id<"toolkitConnections"> | null>(null);

  async function onRecheck(connectionId: Id<"toolkitConnections">) {
    setChecking(connectionId);
    try {
      const result = await recheck({ connectionId });
      if (result.ok) toast.success("Your toolkit is connected.");
      else toast.error("Your toolkit did not pass the check.");
    } catch {
      toast.error("The check could not run. Try again in a moment.");
    } finally {
      setChecking(null);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{team.name}</h1>
        <p className="text-muted-foreground text-sm">
          Your toolkit connection and, soon, your media and automations.
        </p>
      </div>

      {connections === undefined ? (
        <Skeleton className="h-36 max-w-2xl rounded-xl" />
      ) : connections.length === 0 ? (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Connect your toolkit</CardTitle>
            <CardDescription>
              The dashboard needs your NCA Toolkit&apos;s address and API key before it can do
              anything.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/onboarding">Connect a toolkit</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        connections.map((connection) => {
          const ok = connection.status === "ok";
          return (
            <Card key={connection._id} className="max-w-2xl">
              <CardHeader>
                <CardTitle>Toolkit connection</CardTitle>
                <CardDescription className="break-all">{connection.baseUrl}</CardDescription>
                <CardAction>
                  <Badge variant={ok ? "secondary" : "destructive"} data-testid="connection-status">
                    {ok ? (
                      <CircleCheckIcon className="text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <CircleAlertIcon />
                    )}
                    {ok ? "Connected" : "Not responding"}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">API key</dt>
                  <dd>Ends in {connection.apiKeyHint}</dd>
                  {connection.buildNumber && (
                    <>
                      <dt className="text-muted-foreground">Toolkit build</dt>
                      <dd>{connection.buildNumber}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">Last checked</dt>
                  <dd>{checkedAt.format(connection.lastCheckedAt)}</dd>
                </dl>
                {!ok && connection.lastError && (
                  <FailureText className="text-destructive text-sm" text={connection.lastError} />
                )}
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={checking === connection._id}
                    onClick={() => onRecheck(connection._id)}
                  >
                    <RefreshCwIcon className={checking === connection._id ? "animate-spin" : ""} />
                    {checking === connection._id ? "Checking" : "Check again"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </>
  );
}
