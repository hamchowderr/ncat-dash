"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  type DeliverableKind,
  type DeliverableStatus,
  fileKindOf,
  slotProblem,
} from "@convex/lib/packages";
import { useMutation, useQuery } from "convex/react";
import { ExternalLink, Trash2, X } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { KindIcon, kindLabel, selectClass, STATUSES } from "./slot-status";

export type Slot = {
  _id: Id<"deliverables">;
  kind: DeliverableKind;
  label: string;
  status: DeliverableStatus;
  url: string | null;
  versions: number;
  clipId: Id<"reviewClips"> | null;
  updatedAt: number;
};

const NEEDS_FILE: DeliverableStatus[] = ["review", "approved", "published"];
const RECENT = 12;
const added = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The newest file in a slot, as it plays: a video, a picture or a sound. */
export function SlotFile({ url, className }: { url: string; className?: string }) {
  const kind = fileKindOf(url);
  if (kind === "image") {
    // The file sits in the team's own storage, so there is nothing for Next to resize.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className={cn("rounded-lg object-contain", className)} />;
  }
  if (kind === "audio") return <audio src={url} controls className="w-full" />;
  return (
    <video
      src={url}
      controls
      playsInline
      preload="metadata"
      className={cn("rounded-lg bg-black", className)}
    />
  );
}

function fileName(url: string, names: Record<string, string>) {
  return names[url] ?? decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() ?? url);
}

/** Recent finished files that fit the slot, to put one in with a click, or a pasted link. */
function AddFile({ slot }: { slot: Slot }) {
  const team = useActiveTeam();
  const outputs = useQuery(api.jobs.outputs, { organizationId: team.id });
  const addVersion = useMutation(api.projects.addVersion);
  const [link, setLink] = useState("");
  const [pending, setPending] = useState(false);

  const fits = (outputs ?? [])
    .flatMap((group) =>
      group.urls.map((url) => ({ url, name: fileName(url, group.names), at: group.finishedAt })),
    )
    .filter((file) => !slotProblem(slot.kind, file.url) && fileKindOf(file.url) !== null)
    .slice(0, RECENT);

  async function put(url: string) {
    setPending(true);
    try {
      await addVersion({ deliverableId: slot._id, url });
      setLink("");
      toast.success(
        slot.versions === 0 ? "Added. It is in review now." : "New version added for review.",
      );
    } catch (caught) {
      toast.error(errorMessage(caught, "That file could not be added. Try again."));
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (link.trim()) void put(link.trim());
  }

  return (
    <section aria-label="Put a file in" className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">
        {slot.versions === 0 ? "Put a file in" : "Add a new version"}
      </h3>
      {outputs === undefined ? null : fits.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No finished {kindLabel(slot.kind).toLowerCase()} files yet. Paste a link instead.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {fits.map((file) => (
            <li key={file.url}>
              <button
                type="button"
                disabled={pending}
                onClick={() => void put(file.url)}
                className="hover:bg-muted focus-visible:ring-ring/50 flex w-full flex-col items-start rounded-lg px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-3 disabled:opacity-50"
              >
                <span className="w-full truncate">{file.name}</span>
                {file.at && (
                  <span className="text-muted-foreground text-xs">{added.format(file.at)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          aria-label="File link"
          placeholder="https://…"
          value={link}
          onChange={(event) => setLink(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={pending || !link.trim()}>
          Add
        </Button>
      </form>
    </section>
  );
}

/**
 * One slot's details beside the list or board, pushing it narrower rather than covering
 * it: the newest file, where it stands, a file to put in, and its review clip.
 */
export function SlotPanel({
  slot,
  reviewId,
  onClose,
}: {
  slot: Slot;
  reviewId: Id<"reviews"> | null;
  onClose: () => void;
}) {
  const rename = useMutation(api.projects.renameSlot);
  const setStatus = useMutation(api.projects.setStatus);
  const remove = useMutation(api.projects.removeSlot);
  const [label, setLabel] = useState(slot.label);
  const [confirming, setConfirming] = useState(false);

  async function saveLabel() {
    const next = label.trim();
    if (!next || next === slot.label) return setLabel(slot.label);
    try {
      await rename({ deliverableId: slot._id, label: next });
    } catch (caught) {
      setLabel(slot.label);
      toast.error(errorMessage(caught, "The slot could not be renamed."));
    }
  }

  async function onStatus(status: DeliverableStatus) {
    try {
      await setStatus({ deliverableId: slot._id, status });
    } catch (caught) {
      toast.error(errorMessage(caught, "That could not be changed."));
    }
  }

  async function onRemove() {
    try {
      await remove({ deliverableId: slot._id });
      onClose();
    } catch (caught) {
      toast.error(errorMessage(caught, "The slot could not be removed."));
    }
  }

  return (
    <div aria-label={`Slot ${slot.label}`} role="region" className="flex flex-col gap-5 p-4">
      <div className="flex items-start gap-2">
        <KindIcon kind={slot.kind} className="mt-2.5" />
        <Input
          aria-label="Slot name"
          value={label}
          maxLength={80}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={() => void saveLabel()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setLabel(slot.label);
          }}
          className="h-9 border-transparent px-1.5 text-base font-semibold shadow-none hover:border-input md:text-base"
        />
        <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
          <X />
          <span className="sr-only">Close slot</span>
        </Button>
      </div>

      {slot.url ? (
        <SlotFile url={slot.url} className="max-h-72 w-full" />
      ) : (
        <p className="text-muted-foreground bg-surface rounded-lg px-3 py-6 text-center text-sm">
          No file yet
        </p>
      )}

      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3 text-sm">
        <dt className="text-muted-foreground">
          <label htmlFor={`status-${slot._id}`}>Status</label>
        </dt>
        <dd>
          <select
            id={`status-${slot._id}`}
            value={slot.status}
            onChange={(event) => void onStatus(event.target.value as DeliverableStatus)}
            className={cn(selectClass, "w-full")}
          >
            {STATUSES.map(({ status, label: name }) => (
              <option
                key={status}
                value={status}
                disabled={slot.versions === 0 && NEEDS_FILE.includes(status)}
              >
                {name}
              </option>
            ))}
          </select>
        </dd>
        <dt className="text-muted-foreground">Kind</dt>
        <dd>{kindLabel(slot.kind)}</dd>
        <dt className="text-muted-foreground">Versions</dt>
        <dd className="tabular-nums">{slot.versions}</dd>
      </dl>

      {reviewId && slot.clipId && (
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link href={`/review/${reviewId}?clip=${slot.clipId}`}>
            <ExternalLink />
            Open in the review room
          </Link>
        </Button>
      )}

      <AddFile key={slot._id} slot={slot} />

      <div className="pt-2">
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Remove this slot?</span>
            <Button size="sm" variant="destructive" onClick={() => void onRemove()}>
              Remove
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setConfirming(true)}
          >
            <Trash2 />
            Remove slot
          </Button>
        )}
      </div>
    </div>
  );
}
