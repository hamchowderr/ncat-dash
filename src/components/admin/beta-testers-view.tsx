"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
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

type Status = "applied" | "invited" | "joined";
type Filter = Status | "all";

export const BETA_STATUS: Record<Status, { label: string; dot: "green" | "amber" | "grey" }> = {
  applied: { label: "Waiting for an invite", dot: "amber" },
  invited: { label: "Invited", dot: "grey" },
  joined: { label: "Joined", dot: "green" },
};

const exact = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function BetaTestersView() {
  return (
    <OperatorOnly>
      <BetaTesters />
    </OperatorOnly>
  );
}

function BetaTesters() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Id<"betaTesters"> | null>(null);
  const typed = useDeferredValue(search.trim());
  const counts = useQuery(api.beta.counts, {});
  const invite = useMutation(api.beta.invite);
  const { results, status, loadMore } = usePaginatedQuery(
    api.beta.list,
    { ...(typed ? { search: typed } : {}), ...(filter !== "all" ? { status: filter } : {}) },
    { initialNumItems: 50 },
  );
  const waiting = results.filter((row) => row.status === "applied");

  const inviteWaiting = async () => {
    try {
      const sent = await invite({ testerIds: waiting.map((row) => row._id) });
      toast.success(sent === 1 ? "1 invite sent." : `${sent} invites sent.`);
    } catch (error) {
      toast.error(errorMessage(error, "That didn't work. Try again."));
    }
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Beta Testers</h1>
        <p className="text-muted-foreground text-sm text-pretty">
          Everyone who asked to join the beta on the website, with what they told you. Invite
          them from here; they show as joined once they make an account.
        </p>
      </div>

      <dl className="flex flex-wrap gap-x-10 gap-y-3">
        {(Object.keys(BETA_STATUS) as Status[]).map((key) => (
          <div key={key} className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-sm">{BETA_STATUS[key].label}</dt>
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
            { value: "applied", label: "Waiting" },
            { value: "invited", label: "Invited" },
            { value: "joined", label: "Joined" },
          ]}
          className="sm:max-w-md"
        />
        {waiting.length > 0 && (
          <Button size="sm" className="sm:ml-auto" onClick={() => void inviteWaiting()}>
            {waiting.length === 1 ? "Invite 1 waiting" : `Invite ${waiting.length} waiting`}
          </Button>
        )}
      </div>

      {status === "LoadingFirstPage" ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : results.length === 0 ? (
        <p className="bg-surface text-muted-foreground rounded-xl p-6 text-sm">
          {typed
            ? `No address starts with "${typed}".`
            : "Nobody yet. Sign-ups from the website's beta form land here."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <ItemList label="Beta testers">
            {results.map((row) => (
              <ItemRow
                key={row._id}
                name={row.name}
                onOpen={() => setOpen(row._id)}
                openLabel={`${row.name}, ${row.email}, ${BETA_STATUS[row.status].label}`}
                meta={
                  <MetaLine>
                    <span>{row.email}</span>
                    {row.source && <span>From {row.source}</span>}
                    {row.newsletter && <span>Asked for news</span>}
                    <span title={exactly(row.appliedAt)}>Signed up {timeAgo(row.appliedAt)}</span>
                  </MetaLine>
                }
                badges={
                  <ItemBadge dot={BETA_STATUS[row.status].dot}>
                    {BETA_STATUS[row.status].label}
                  </ItemBadge>
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
          {open && <Tester testerId={open} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Tester({ testerId }: { testerId: Id<"betaTesters"> }) {
  const tester = useQuery(api.beta.get, { testerId });
  const invite = useMutation(api.beta.invite);
  if (tester === undefined) return <Skeleton className="m-4 h-48 rounded-xl" />;
  if (tester === null) return <p className="text-muted-foreground p-4 text-sm">Not found.</p>;

  const send = async () => {
    try {
      await invite({ testerIds: [testerId] });
      toast.success(`Invite sent to ${tester.email}.`);
    } catch (error) {
      toast.error(errorMessage(error, "That didn't work. Try again."));
    }
  };

  const history: [string, number | undefined][] = [
    [tester.timesApplied > 1 ? `Signed up (${tester.timesApplied} times)` : "Signed up", tester.appliedAt],
    ["Invited", tester.invitedAt],
    ["Joined", tester.joinedAt],
    ["Check-in email sent", tester.checkInSentAt],
  ];

  return (
    <>
      <SheetHeader>
        <SheetTitle>{tester.name}</SheetTitle>
        <SheetDescription className="break-all">{tester.email}</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-6 px-4 pb-6">
        {tester.status !== "joined" && (
          <Button size="sm" className="self-start" onClick={() => void send()}>
            {tester.status === "invited" ? "Send the invite again" : "Invite to the beta"}
          </Button>
        )}

        <dl className="flex flex-col gap-1 text-sm">
          {history
            .filter((entry): entry is [string, number] => entry[1] !== undefined)
            .map(([label, at]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">{exact.format(at)}</dd>
              </div>
            ))}
        </dl>

        <dl className="flex flex-col gap-4">
          {tester.source && <Answer question="Heard about it from" answer={tester.source} />}
          {tester.link && <Answer question="Link" answer={tester.link} />}
          {tester.answers.map((one) => (
            <Answer key={one.question} question={one.question} answer={one.answer} />
          ))}
          <Answer
            question="Product news"
            answer={
              tester.newsletter
                ? "Ticked the box. See Subscribers for whether they confirmed."
                : "Didn't ask for it."
            }
          />
        </dl>
      </div>
    </>
  );
}

function Answer({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-sm">{question}</dt>
      <dd className="text-sm break-words whitespace-pre-wrap">{answer}</dd>
    </div>
  );
}
