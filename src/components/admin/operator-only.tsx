"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

/** A Platform Admin page: shown to whoever runs this copy (OPERATOR_EMAILS), nobody else. */
export function OperatorOnly({ children }: { children: ReactNode }) {
  const operator = useQuery(api.operator.me, {});
  if (operator === undefined) return <Skeleton className="h-48 rounded-xl" />;
  if (!operator) {
    return (
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Platform Admin</h1>
        <p className="text-muted-foreground text-sm">
          Only the people who run this copy of Takewon can see this page.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * "Platform Admin" above the heading of every Platform Admin page, for its operator, so
 * nobody takes it for their team's admin settings. Others see OperatorOnly's own heading.
 */
export function PlatformAdminEyebrow() {
  const operator = useQuery(api.operator.me, {});
  if (!operator) return null;
  return (
    <p className="text-muted-foreground -mb-1 text-xs font-medium tracking-wide uppercase">
      Platform Admin
    </p>
  );
}

/** Who a broadcast goes to, in the words the pages use. */
export const AUDIENCES = {
  news: {
    label: "Product news subscribers",
    short: "Product news",
    note: "Everyone who asked for product news. The only audience for marketing.",
  },
  accounts: {
    label: "Everyone with an account",
    short: "All accounts",
    note: "Only for news about their account or the service, never marketing.",
  },
  trial_teams: {
    label: "Teams on a free trial",
    short: "Trial teams",
    note: "Everyone on a team whose trial is running. About their account, not marketing.",
  },
  paid_teams: {
    label: "Paying teams",
    short: "Paying teams",
    note: "Everyone on a team that has bought. About their account, not marketing.",
  },
} as const;

export type Audience = keyof typeof AUDIENCES;
