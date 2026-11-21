"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { TONE_CLASS, localToday, rightsStatus } from "./rights";

type Loaded = NonNullable<ReturnType<typeof useQuery<typeof api.creators.list>>>;
type Listed = Loaded["creators"][number];

/** A creator's first letter, as a quiet mark beside their name. */
export function CreatorMark({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function CreatorRow({ creator, today }: { creator: Listed; today: string }) {
  const status = creator.next ? rightsStatus(creator.next.endsOn, today) : null;
  return (
    <li data-creator={creator.name}>
      <Link
        href={`/creators/${creator._id}`}
        transitionTypes={["nav-forward"]}
        className="group hover:bg-muted focus-visible:ring-ring/50 flex items-center gap-3 rounded-xl bg-surface p-3 outline-none transition-colors focus-visible:ring-3"
      >
        <CreatorMark name={creator.name} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-medium">{creator.name}</span>
          {status && creator.next ? (
            <span
              data-tone={status.tone}
              className={cn("truncate text-sm", TONE_CLASS[status.tone])}
            >
              {creator.next.client ? `${creator.next.client}: ` : ""}
              {status.label}
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">No usage rights kept yet</span>
          )}
        </span>
        <span className="text-muted-foreground hidden w-28 text-sm sm:block">
          {creator.deals === 1 ? "1 deal" : `${creator.deals} deals`}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5"
        />
      </Link>
    </li>
  );
}

function AddCreator({ seen }: { seen: string[] }) {
  const team = useActiveTeam();
  const router = useRouter();
  const create = useMutation(api.creators.create);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const id = await create({ organizationId: team.id, name });
      setName("");
      router.push(`/creators/${id}`, { transitionTypes: ["nav-forward"] });
    } catch (caught) {
      toast.error(errorMessage(caught, "The creator could not be added. Try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <Input
        aria-label="Creator name"
        placeholder="As their folder is named"
        value={name}
        maxLength={80}
        list={seen.length ? "creator-folders" : undefined}
        autoComplete="off"
        onChange={(event) => setName(event.target.value)}
        className="h-8 w-56"
      />
      {seen.length > 0 && (
        <datalist id="creator-folders">
          {seen.map((one) => (
            <option key={one} value={one} />
          ))}
        </datalist>
      )}
      <Button type="submit" size="sm" disabled={pending || !name.trim()}>
        <Plus />
        Add creator
      </Button>
    </form>
  );
}

/**
 * The creators who film for the team, with the deal of theirs that ends first. Each has a
 * page with all their deals and the runs made from their folder.
 */
export function CreatorsView({ today = localToday() }: { today?: string }) {
  const team = useActiveTeam();
  const data = useQuery(api.creators.list, { organizationId: team.id });
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Creators</h1>
          <p className="text-muted-foreground max-w-prose text-sm">
            Who films for you, and how long each deal lets you use their footage. A week before a
            deal ends, everyone on the team hears about it.
          </p>
        </div>
        <AddCreator seen={data?.seen ?? []} />
      </div>
      {data === undefined ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : data.creators.length === 0 ? (
        <p className="text-muted-foreground max-w-prose rounded-xl bg-surface px-4 py-3 text-sm">
          No creators yet. Add the people whose footage you use, named as their folders are, then
          keep each deal&apos;s last day on their page.
          {data.seen.length > 0 && ` Folders seen so far: ${data.seen.join(", ")}.`}
        </p>
      ) : (
        <ul className="reveal flex flex-col gap-2" aria-label="Creators">
          {data.creators.map((creator) => (
            <CreatorRow key={creator._id} creator={creator} today={today} />
          ))}
        </ul>
      )}
    </>
  );
}
