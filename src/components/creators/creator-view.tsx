"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ChevronRight, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { cn } from "@/lib/utils";

import { CreatorMark } from "./creators-view";
import { TONE_CLASS, USAGES, type Usage, localToday, rightsStatus, sayUsage } from "./rights";

type Loaded = NonNullable<ReturnType<typeof useQuery<typeof api.creators.get>>>;
type Deal = Loaded["deals"][number];

function Section({ title, line, children }: { title: string; line?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold">{title}</h2>
        {line && <p className="text-muted-foreground max-w-prose text-sm">{line}</p>}
      </div>
      {children}
    </section>
  );
}

/** The boxes for a deal: the client, the last day, organic or paid, and a note. */
function DealForm({
  creator,
  start,
  onDone,
}: {
  creator: Loaded;
  start?: Deal;
  onDone?: () => void;
}) {
  const save = useMutation(api.creators.saveDeal);
  const [clientId, setClientId] = useState<string>(start?.clientId ?? "");
  const [endsOn, setEndsOn] = useState(start?.endsOn ?? "");
  const [usage, setUsage] = useState<Usage>(start?.usage ?? "both");
  const [note, setNote] = useState(start?.note ?? "");
  const [busy, setBusy] = useState(false);
  const key = start?._id ?? "new";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!endsOn) return;
    setBusy(true);
    try {
      await save({
        creatorId: creator._id,
        dealId: start?._id,
        clientId: clientId ? (clientId as Id<"clients">) : undefined,
        endsOn,
        usage,
        note: note.trim() || undefined,
      });
      toast.success(start ? "Deal saved" : "Deal added");
      if (!start) {
        setClientId("");
        setEndsOn("");
        setUsage("both");
        setNote("");
      }
      onDone?.();
    } catch (caught) {
      toast.error(errorMessage(caught, "That could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      aria-label={start ? "Change deal" : "Add a deal"}
      className="flex max-w-2xl flex-col gap-3"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`deal-client-${key}`} className="text-sm font-medium">
            Client
          </label>
          <select
            id={`deal-client-${key}`}
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 rounded-lg border bg-transparent px-2 text-sm outline-none focus-visible:ring-3"
          >
            <option value="">Your own content</option>
            {creator.clients.map((client) => (
              <option key={client._id} value={client._id}>
                {client.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`deal-ends-${key}`} className="text-sm font-medium">
            Last day of use
          </label>
          <Input
            id={`deal-ends-${key}`}
            type="date"
            value={endsOn}
            onChange={(event) => setEndsOn(event.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span id={`deal-usage-${key}`} className="text-sm font-medium">
          Allowed for
        </span>
        <Segmented
          aria-labelledby={`deal-usage-${key}`}
          value={usage}
          onValueChange={setUsage}
          options={USAGES}
          className="max-w-sm"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`deal-note-${key}`} className="text-sm font-medium">
          Note <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <Input
          id={`deal-note-${key}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Platforms, whitelisting, renewal price"
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={busy || !endsOn}>
          {busy ? "Saving" : start ? "Save" : "Add deal"}
        </Button>
        {start && onDone && (
          <Button size="sm" type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function DealRow({ creator, deal, today }: { creator: Loaded; deal: Deal; today: string }) {
  const remove = useMutation(api.creators.removeDeal);
  const [editing, setEditing] = useState(false);
  const status = rightsStatus(deal.endsOn, today);
  const name = deal.client ?? "Your own content";

  if (editing) {
    return (
      <li className="bg-muted/40 rounded-xl p-4">
        <DealForm creator={creator} start={deal} onDone={() => setEditing(false)} />
      </li>
    );
  }

  async function drop() {
    try {
      await remove({ dealId: deal._id });
      toast.success("Deal removed");
    } catch (caught) {
      toast.error(errorMessage(caught, "That could not be removed."));
    }
  }

  return (
    <li
      data-deal={name}
      className="flex items-start justify-between gap-4 rounded-xl bg-surface px-4 py-3"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{name}</span>
        <span data-tone={status.tone} className={cn("text-sm", TONE_CLASS[status.tone])}>
          {status.label}
        </span>
        <span className="text-muted-foreground text-sm">
          {[sayUsage(deal.usage), deal.note].filter(Boolean).join(". ")}
        </span>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEditing(true)}
          aria-label={`Change ${name}`}
        >
          Change
        </Button>
        <Button size="sm" variant="ghost" onClick={drop} aria-label={`Remove ${name}`}>
          Remove
        </Button>
      </div>
    </li>
  );
}

function Header({ creator }: { creator: Loaded }) {
  const router = useRouter();
  const rename = useMutation(api.creators.rename);
  const remove = useMutation(api.creators.remove);
  const [name, setName] = useState(creator.name);
  const [confirming, setConfirming] = useState(false);

  async function saveName() {
    const next = name.trim();
    if (!next || next === creator.name) return setName(creator.name);
    try {
      await rename({ creatorId: creator._id, name: next });
    } catch (caught) {
      setName(creator.name);
      toast.error(errorMessage(caught, "The creator could not be renamed."));
    }
  }

  async function onRemove() {
    try {
      await remove({ creatorId: creator._id });
      router.replace("/creators", { transitionTypes: ["nav-back"] });
    } catch (caught) {
      toast.error(errorMessage(caught, "The creator could not be removed."));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button asChild variant="ghost" size="icon" className="-ml-2">
        <Link href="/creators" transitionTypes={["nav-back"]}>
          <ArrowLeft />
          <span className="sr-only">Back to creators</span>
        </Link>
      </Button>
      <CreatorMark name={creator.name} />
      <Input
        aria-label="Creator name"
        value={name}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => void saveName()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setName(creator.name);
        }}
        className="h-9 max-w-sm flex-1 border-transparent px-1.5 text-xl font-semibold tracking-tight shadow-none md:text-xl hover:border-input"
      />
      <div className="ml-auto">
        {confirming ? (
          <span className="flex flex-wrap items-center gap-2 text-sm">
            Remove {creator.name} and their deals? Their footage and runs stay.
            <Button size="sm" variant="destructive" onClick={() => void onRemove()}>
              Remove
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep them
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            <Trash2 />
            Remove creator
          </Button>
        )}
      </div>
    </div>
  );
}

function Creator({ creator, today }: { creator: Loaded; today: string }) {
  return (
    <>
      <Header key={creator.name} creator={creator} />
      <div className="flex max-w-4xl flex-col gap-10">
        <Section
          title="Usage rights"
          line="One line per deal. A week before a deal's last day, everyone on the team hears about it in Inbox, by email and in Slack, Discord, Telegram or Teams, as each person set in Notifications."
        >
          {creator.deals.length === 0 ? (
            <p className="text-muted-foreground max-w-prose rounded-xl bg-surface px-4 py-3 text-sm">
              No deals kept yet. Add each brand this creator films for, with the last day you may
              use the footage.
            </p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Deals">
              {creator.deals.map((deal) => (
                <DealRow key={deal._id} creator={creator} deal={deal} today={today} />
              ))}
            </ul>
          )}
        </Section>

        <Section title="Add a deal">
          <DealForm creator={creator} />
        </Section>

        <Section
          title="Runs from their folder"
          line={`Runs started by a folder named ${creator.name}, such as UGC Ad Variants From Creator Folders. Take these ads down when a deal ends.`}
        >
          {creator.runs.length === 0 ? (
            <p className="text-muted-foreground max-w-prose rounded-xl bg-surface px-4 py-3 text-sm">
              No runs from a folder with this name yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1" aria-label="Runs">
              {creator.runs.map((run) => (
                <li key={run._id}>
                  <Link
                    href={`/automations/${run.automationId}/runs/${run._id}`}
                    className="group hover:bg-muted flex items-center gap-3 rounded-lg bg-surface px-3 py-2 text-sm transition-colors"
                  >
                    <span className="min-w-0 flex-1 truncate">{run.automationName}</span>
                    <span className="text-muted-foreground text-xs">
                      {new Date(run.startedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <ChevronRight aria-hidden="true" className="text-muted-foreground size-4" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

export function CreatorView({
  creatorId,
  today = localToday(),
}: {
  creatorId: Id<"creators">;
  today?: string;
}) {
  const creator = useQuery(api.creators.get, { creatorId });
  if (creator === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-72 rounded-lg" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }
  if (creator === null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground text-sm">This creator is no longer here.</p>
        <Button asChild size="sm" variant="outline">
          <Link href="/creators">Back to creators</Link>
        </Button>
      </div>
    );
  }
  return <Creator creator={creator} today={today} />;
}
