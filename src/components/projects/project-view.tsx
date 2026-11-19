"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  type DeliverableKind,
  type DeliverableStatus,
  fileKindOf,
  KINDS,
} from "@convex/lib/packages";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Columns3, List, MessagesSquare, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type CSSProperties, type DragEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PageTourButton, StartPageTour } from "@/components/tours/page-tour";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { type Slot, SlotPanel } from "./slot-panel";
import { Filled, KindIcon, StatusIcon, statusLabel, STATUSES } from "./slot-status";
import { SegmentedButton, SegmentedGroup } from "@/components/ui/segmented";
import { PickList } from "@/components/ui/pick-list";

type Loaded = NonNullable<ReturnType<typeof useQuery<typeof api.projects.get>>>;
type Layout = "list" | "board";

const NEEDS_FILE: DeliverableStatus[] = ["review", "approved", "published"];
const LAYOUT_KEY = "ncat-dash:project-layout";

function savedLayout(): Layout {
  try {
    return window.localStorage.getItem(LAYOUT_KEY) === "board" ? "board" : "list";
  } catch {
    return "list";
  }
}

/** A small still of the slot's newest file, or its kind's icon while it has none. */
function Thumb({ slot, className }: { slot: Slot; className?: string }) {
  const kind = slot.url ? fileKindOf(slot.url) : null;
  return (
    <span
      className={cn(
        "bg-muted flex shrink-0 items-center justify-center overflow-hidden rounded-md",
        className,
      )}
    >
      {slot.url && kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={slot.url} alt="" loading="lazy" className="size-full object-cover" />
      ) : slot.url && kind === "video" ? (
        <video
          src={`${slot.url}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          aria-hidden="true"
          className="size-full object-cover"
        />
      ) : (
        <KindIcon kind={slot.kind} />
      )}
    </span>
  );
}

/** The slots grouped by where they stand, like Linear's issue list grouped by status. */
function SlotList({
  slots,
  selected,
  onSelect,
}: {
  slots: Slot[];
  selected: Id<"deliverables"> | null;
  onSelect: (id: Id<"deliverables">) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      {STATUSES.map(({ status, label }) => {
        const here = slots.filter((slot) => slot.status === status);
        if (here.length === 0) return null;
        return (
          <section key={status} aria-label={label} className="flex flex-col gap-1">
            <h2 className="flex items-center gap-2 px-2 pb-1 text-sm font-semibold">
              <StatusIcon status={status} />
              {label}
              <span className="text-muted-foreground font-normal tabular-nums">{here.length}</span>
            </h2>
            <ul className="flex flex-col gap-1">
              {here.map((slot) => (
                <li key={slot._id}>
                  <button
                    type="button"
                    aria-pressed={slot._id === selected}
                    onClick={() => onSelect(slot._id)}
                    className={cn(
                      "focus-visible:ring-ring/50 flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-3",
                      slot._id === selected ? "row-selected" : "bg-surface hover:bg-muted",
                    )}
                  >
                    <Thumb slot={slot} className="aspect-video h-9" />
                    <span className="min-w-0 flex-1 truncate">{slot.label}</span>
                    <span className="text-muted-foreground hidden text-xs sm:inline">
                      {slot.versions === 0
                        ? "No file"
                        : slot.versions === 1
                          ? "1 version"
                          : `${slot.versions} versions`}
                    </span>
                    <StatusIcon status={slot.status} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * The slots as a board with a column for each status, like Linear's board. A card can be
 * dragged to another column; one without a file cannot go past In progress.
 */
function SlotBoard({
  slots,
  selected,
  onSelect,
  onMove,
}: {
  slots: Slot[];
  selected: Id<"deliverables"> | null;
  onSelect: (id: Id<"deliverables">) => void;
  onMove: (id: Id<"deliverables">, status: DeliverableStatus) => void;
}) {
  const [over, setOver] = useState<DeliverableStatus | null>(null);

  function onDrop(event: DragEvent, status: DeliverableStatus) {
    event.preventDefault();
    setOver(null);
    const id = event.dataTransfer.getData("text/plain") as Id<"deliverables">;
    if (id) onMove(id, status);
  }

  return (
    <div className="grid auto-cols-[minmax(13rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
      {STATUSES.map(({ status, label }) => {
        const here = slots.filter((slot) => slot.status === status);
        return (
          <section
            key={status}
            aria-label={label}
            data-column={status}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(status);
            }}
            onDragLeave={() => setOver((current) => (current === status ? null : current))}
            onDrop={(event) => onDrop(event, status)}
            className={cn(
              "flex min-h-48 flex-col gap-2 rounded-xl p-2 transition-colors",
              over === status ? "bg-muted" : "bg-surface",
            )}
          >
            <h2 className="flex items-center gap-2 px-1 py-1 text-sm font-semibold">
              <StatusIcon status={status} />
              {label}
              <span className="text-muted-foreground font-normal tabular-nums">{here.length}</span>
            </h2>
            <ul className="flex flex-col gap-2">
              {here.map((slot) => (
                <li key={slot._id}>
                  <button
                    type="button"
                    draggable
                    aria-pressed={slot._id === selected}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/plain", slot._id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => onSelect(slot._id)}
                    className={cn(
                      "focus-visible:ring-ring/50 bg-background flex w-full flex-col gap-2 rounded-lg p-2 text-left text-sm shadow-xs outline-none transition-shadow focus-visible:ring-3",
                      slot._id === selected ? "picked-ring" : "hover:shadow-sm",
                    )}
                  >
                    {slot.url && <Thumb slot={slot} className="aspect-video w-full" />}
                    <span className="flex items-center gap-2">
                      <KindIcon kind={slot.kind} />
                      <span className="min-w-0 flex-1 truncate">{slot.label}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function AddSlot({ projectId }: { projectId: Id<"projects"> }) {
  const add = useMutation(api.projects.addSlot);
  const [kind, setKind] = useState<DeliverableKind>("short");
  const [pending, setPending] = useState(false);

  async function onAdd() {
    setPending(true);
    try {
      await add({ projectId, kind });
    } catch (caught) {
      toast.error(errorMessage(caught, "The slot could not be added."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2" data-tour-step-id="tour-project-add">
      <PickList
        aria-label="Kind of slot to add"
        size="sm"
        value={kind}
        onChange={(next) => setKind(next as DeliverableKind)}
        options={KINDS.map((entry) => ({ value: entry.kind, label: entry.label }))}
      />
      <Button size="sm" variant="outline" disabled={pending} onClick={() => void onAdd()}>
        <Plus />
        Add slot
      </Button>
    </div>
  );
}

function Header({ project }: { project: Loaded }) {
  const team = useActiveTeam();
  const router = useRouter();
  const rename = useMutation(api.projects.rename);
  const setClient = useMutation(api.projects.setClient);
  const remove = useMutation(api.projects.remove);
  const clients = useQuery(api.clients.list, { organizationId: team.id });
  const [name, setName] = useState(project.name);
  const [confirming, setConfirming] = useState(false);

  async function saveName() {
    const next = name.trim();
    if (!next || next === project.name) return setName(project.name);
    try {
      await rename({ projectId: project._id, name: next });
    } catch (caught) {
      setName(project.name);
      toast.error(errorMessage(caught, "The project could not be renamed."));
    }
  }

  async function onClient(clientId: string) {
    try {
      await setClient({
        projectId: project._id,
        clientId: clientId ? (clientId as Id<"clients">) : null,
      });
    } catch (caught) {
      toast.error(errorMessage(caught, "That could not be changed."));
    }
  }

  async function onRemove() {
    try {
      await remove({ projectId: project._id });
      router.replace("/projects", { transitionTypes: ["nav-back"] });
    } catch (caught) {
      toast.error(errorMessage(caught, "The project could not be deleted."));
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-3">
      <Button asChild variant="ghost" size="icon" className="-ml-2">
        <Link href="/projects" transitionTypes={["nav-back"]}>
          <ArrowLeft />
          <span className="sr-only">Back to projects</span>
        </Link>
      </Button>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Input
          aria-label="Project name"
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void saveName()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setName(project.name);
          }}
          className="h-9 max-w-md border-transparent px-1.5 text-xl font-semibold tracking-tight shadow-none md:text-xl hover:border-input"
        />
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 px-1.5 text-sm">
          <span>{project.package}</span>
          <label className="flex items-center gap-2" data-tour-step-id="tour-project-client">
            <span>For</span>
            <PickList
              aria-label="Client"
              size="sm"
              className="text-foreground"
              value={project.client?._id ?? ""}
              onChange={(next) => void onClient(next)}
              options={[
                { value: "", label: "Your team" },
                ...(clients ?? []).map((entry) => ({ value: entry._id, label: entry.name })),
              ]}
            />
          </label>
          <Filled filled={project.filled} total={project.total} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PageTourButton tourId="project" />
        {project.review && (
          <Button asChild size="sm" variant="outline" data-tour-step-id="tour-project-review">
            <Link href={`/review/${project.review._id}`}>
              <MessagesSquare />
              Review room
            </Link>
          </Button>
        )}
        {project.canDelete &&
          (confirming ? (
            <span className="flex items-center gap-2 text-sm">
              Delete this project?
              <Button size="sm" variant="destructive" onClick={() => void onRemove()}>
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              <Trash2 />
              Delete
            </Button>
          ))}
      </div>
    </div>
  );
}

function Project({ project }: { project: Loaded }) {
  const setStatus = useMutation(api.projects.setStatus);
  const [layout, setLayout] = useState<Layout>(savedLayout);
  const [selectedId, setSelectedId] = useState<Id<"deliverables"> | null>(null);
  const slots = project.slots as Slot[];
  const selected = slots.find((slot) => slot._id === selectedId) ?? null;

  function pickLayout(next: Layout) {
    setLayout(next);
    try {
      window.localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // Remembering the choice is a nicety; the page works without it.
    }
  }

  async function onMove(id: Id<"deliverables">, status: DeliverableStatus) {
    const slot = slots.find((entry) => entry._id === id);
    if (!slot || slot.status === status) return;
    if (slot.versions === 0 && NEEDS_FILE.includes(status)) {
      toast.error(`Put a file in ${slot.label} before moving it to ${statusLabel(status)}.`);
      return;
    }
    try {
      await setStatus({ deliverableId: id, status });
    } catch (caught) {
      toast.error(errorMessage(caught, "That could not be moved."));
    }
  }

  const select = (id: Id<"deliverables">) =>
    setSelectedId((current) => (current === id ? null : id));

  return (
    <>
      <StartPageTour tourId="project" />
      <Header key={project.name} project={project} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedGroup aria-label="Layout" data-tour-step-id="tour-project-layout">
          {(
            [
              ["list", "List", List],
              ["board", "Board", Columns3],
            ] as const
          ).map(([value, label, Icon]) => (
            <SegmentedButton
              key={value}
              pressed={layout === value}
              onClick={() => pickLayout(value)}
            >
              <Icon aria-hidden="true" />
              {label}
            </SegmentedButton>
          ))}
        </SegmentedGroup>
        <AddSlot projectId={project._id} />
      </div>

      <div
        className={cn(
          "grid gap-4 lg:grid-cols-[minmax(0,1fr)_var(--panel-width)]",
          "motion-safe:transition-[grid-template-columns] motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)]",
        )}
        style={{ "--panel-width": selected ? "24rem" : "0rem" } as CSSProperties}
      >
        <div className="min-w-0" data-tour-step-id="tour-project-slots">
          {slots.length === 0 ? (
            <p className="text-muted-foreground rounded-xl bg-surface px-4 py-3 text-sm">
              No slots yet. Add the first one above.
            </p>
          ) : layout === "board" ? (
            <SlotBoard
              slots={slots}
              selected={selectedId}
              onSelect={select}
              onMove={(id, status) => void onMove(id, status)}
            />
          ) : (
            <SlotList slots={slots} selected={selectedId} onSelect={select} />
          )}
        </div>
        <aside
          className={cn(
            "min-w-0 overflow-hidden rounded-xl bg-surface lg:self-start",
            !selected && "hidden lg:block",
          )}
        >
          {selected && (
            <SlotPanel
              key={selected._id}
              slot={selected}
              reviewId={project.review?._id ?? null}
              onClose={() => setSelectedId(null)}
            />
          )}
        </aside>
      </div>
    </>
  );
}

export function ProjectView({ projectId }: { projectId: Id<"projects"> }) {
  const project = useQuery(api.projects.get, { projectId });
  if (project === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-72 rounded-lg" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  if (project === null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground text-sm">This project no longer exists.</p>
        <Button asChild size="sm" variant="outline">
          <Link href="/projects">Back to projects</Link>
        </Button>
      </div>
    );
  }
  return <Project project={project} />;
}
