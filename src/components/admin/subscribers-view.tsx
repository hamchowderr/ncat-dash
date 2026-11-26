"use client";

import { api } from "@convex/_generated/api";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Search } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ItemBadge, ItemList, ItemRow, MetaLine } from "@/components/ui/item-list";
import { Segmented } from "@/components/ui/segmented";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { exactly, timeAgo } from "@/lib/when";

import { OperatorOnly } from "./operator-only";

type Status = "subscribed" | "pending" | "unsubscribed";
type Filter = Status | "all";

const STATUS: Record<Status, { label: string; dot: "green" | "amber" | "grey" }> = {
  subscribed: { label: "Subscribed", dot: "green" },
  pending: { label: "Not confirmed", dot: "amber" },
  unsubscribed: { label: "Unsubscribed", dot: "grey" },
};

const SOURCE: Record<string, string> = {
  signup: "Sign-up form",
  website: "Website",
  settings: "Settings",
  unsubscribe_link: "Unsubscribe link",
  complaint: "Spam report",
  operator: "You",
};

const ACTION: Record<string, string> = {
  requested: "Asked, waiting to confirm",
  given: "Agreed",
  withdrawn: "Stopped",
};

const exact = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

export function SubscribersView() {
  return (
    <OperatorOnly>
      <Subscribers />
    </OperatorOnly>
  );
}

function Subscribers() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const typed = useDeferredValue(search.trim());
  const counts = useQuery(api.news.counts, {});
  const { results, status, loadMore } = usePaginatedQuery(
    api.news.list,
    { ...(typed ? { search: typed } : {}), ...(filter !== "all" ? { status: filter } : {}) },
    { initialNumItems: 50 },
  );

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Subscribers</h1>
        <p className="text-muted-foreground text-sm text-pretty">
          Everyone who asked for product news, and the record of when and where they agreed. Website
          sign-ups count once they confirm by email.
        </p>
      </div>

      <dl className="flex flex-wrap gap-x-10 gap-y-3">
        {(Object.keys(STATUS) as Status[]).map((key) => (
          <div key={key} className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-sm">{STATUS[key].label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {counts ? counts[key].toLocaleString() : "–"}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-80">
          <Search
            aria-hidden="true"
            className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <Input
            aria-label="Search by email"
            placeholder="Search by email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <Segmented
          aria-label="Show"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "subscribed", label: "Subscribed" },
            { value: "pending", label: "Not confirmed" },
            { value: "unsubscribed", label: "Unsubscribed" },
          ]}
          className="sm:max-w-md"
        />
      </div>

      {status === "LoadingFirstPage" ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : results.length === 0 ? (
        <p className="bg-surface text-muted-foreground rounded-xl p-6 text-sm">
          {typed ? `No address starts with "${typed}".` : "Nobody here yet."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <ItemList label="Subscribers">
            {results.map((row) => (
              <ItemRow
                key={row._id}
                name={row.email}
                onOpen={() => setOpen(row.email)}
                openLabel={`${row.email}, ${STATUS[row.status].label}`}
                meta={
                  <MetaLine>
                    {row.name && <span>{row.name}</span>}
                    <span>{row.userId ? "Has an account" : "No account"}</span>
                    <span>From {SOURCE[row.source] ?? row.source}</span>
                    <span title={exactly(row.updatedAt)}>Changed {timeAgo(row.updatedAt)}</span>
                  </MetaLine>
                }
                badges={
                  <ItemBadge dot={STATUS[row.status].dot}>{STATUS[row.status].label}</ItemBadge>
                }
              />
            ))}
          </ItemList>
          {status === "CanLoadMore" && (
            <Button variant="outline" size="sm" className="self-start" onClick={() => loadMore(50)}>
              Show more
            </Button>
          )}
        </div>
      )}

      <Sheet open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {open && <Consent email={open} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Consent({ email }: { email: string }) {
  const history = useQuery(api.news.history, { email });
  const stopFor = useMutation(api.news.stopFor);
  const subscribed = history?.[0] && history[0].action !== "withdrawn";
  const stop = async () => {
    try {
      if (await stopFor({ email })) toast.success(`${email} won't get product news.`);
    } catch (error) {
      toast.error(errorMessage(error, "That didn't work. Try again."));
    }
  };
  return (
    <>
      <SheetHeader>
        <SheetTitle className="break-all">{email}</SheetTitle>
        <SheetDescription>
          Every time this address agreed to or stopped product news.
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-6 px-4 pb-6">
        {history === undefined ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : (
          <ol className="flex flex-col gap-5">
            {history.map((row) => (
              <li key={row._id} className="flex flex-col gap-1">
                <span className="text-sm font-medium">
                  {ACTION[row.action]} · {SOURCE[row.source] ?? row.source}
                </span>
                <span className="text-muted-foreground text-sm">{exact.format(row.at)}</span>
                {row.wording && (
                  <span className="bg-muted rounded-lg px-3 py-2 text-sm">&ldquo;{row.wording}&rdquo;</span>
                )}
                {row.userAgent && (
                  <span className="text-muted-foreground truncate text-xs">{row.userAgent}</span>
                )}
              </li>
            ))}
          </ol>
        )}
        {subscribed && (
          <Button variant="outline" size="sm" className="self-start" onClick={() => void stop()}>
            Stop product news for this address
          </Button>
        )}
      </div>
    </>
  );
}
