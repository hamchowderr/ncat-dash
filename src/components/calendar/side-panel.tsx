"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { DeliverableKind, DeliverableStatus } from "@convex/lib/packages";
import { CALENDAR_PLATFORMS, WEEKDAYS } from "@takewon/automation-core";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Check, Clapperboard, ListOrdered, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { type DragEvent, type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { KindIcon, StatusIcon, statusLabel } from "@/components/projects/slot-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/catalog";
import { useActiveTeam } from "@/lib/team-context";
import { cn } from "@/lib/utils";

import { dayKey, DUE_HOUR, fromInputValue, timeLabel, toInputValue } from "./dates";
import { type LibraryFile, LibraryPicker, PickedFiles } from "./library-picker";
import { movePostLocally, setDueLocally } from "./optimistic";
import { type Dragged, type Due, PlatformMark, type Post, type Waiting } from "./entries";
import { SegmentedButton, SegmentedGroup } from "@/components/ui/segmented";
import { PickList } from "@/components/ui/pick-list";
import { myTimeZone } from "@/lib/time-zone";

export type Panel =
  | { mode: "waiting" }
  | { mode: "slots" }
  | { mode: "add"; at?: number; platform?: string }
  | { mode: "post"; id: Id<"calendarPosts"> }
  | { mode: "due"; id: Id<"deliverables"> };

type Client = { _id: Id<"clients">; name: string };

const longDate = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

async function attempt(work: () => Promise<unknown>, failure: string) {
  try {
    await work();
    return true;
  } catch (caught) {
    toast.error(errorMessage(caught, failure));
    return false;
  }
}

function Heading({ children, onBack }: { children: ReactNode; onBack?: () => void }) {
  return (
    <div className="flex items-center gap-2">
      {onBack && (
        <Button size="icon-sm" variant="ghost" aria-label="Back" onClick={onBack}>
          <ArrowLeft />
        </Button>
      )}
      <h2 className="flex-1 text-sm font-semibold">{children}</h2>
    </div>
  );
}

function PlatformSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <PickList
      id={id}
      className="w-full"
      value={value}
      onChange={onChange}
      options={CALENDAR_PLATFORMS.map((platform) => ({
        value: platform.id,
        label: platform.label,
      }))}
    />
  );
}

function ClientSelect({
  id,
  clients,
  value,
  onChange,
  none,
}: {
  id: string;
  clients: Client[];
  value: string;
  onChange: (value: string) => void;
  none: string;
}) {
  return (
    <PickList
      id={id}
      className="w-full"
      value={value}
      onChange={onChange}
      options={[
        { value: "", label: none },
        ...clients.map((client) => ({ value: client._id, label: client.name })),
      ]}
    />
  );
}

function Field({
  id,
  label,
  children,
  hint,
}: {
  id: string;
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

/** A post waiting in the side list, ready to drag onto a day. */
function WaitingPost({
  post,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  post: Post;
  onOpen: () => void;
  onDragStart: (dragged: Dragged) => void;
  onDragEnd: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        draggable
        onDragStart={(event) => {
          onDragStart({ type: "post", id: post._id, at: null });
          event.dataTransfer?.setData("text/plain", post._id);
        }}
        onDragEnd={onDragEnd}
        onClick={onOpen}
        className="bg-background focus-visible:ring-ring/50 flex w-full cursor-grab items-center gap-2 rounded-lg p-2 text-left text-sm shadow-xs outline-none transition-shadow hover:shadow-sm focus-visible:ring-3 active:cursor-grabbing"
      >
        <PlatformMark platform={post.platform} className="size-4" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{post.title}</span>
          {(post.file || post.client) && (
            <span className="text-muted-foreground truncate text-xs">
              {[post.file?.shortId, post.client?.name].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function WaitingDeliverable({
  due,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  due: Due;
  onOpen: () => void;
  onDragStart: (dragged: Dragged) => void;
  onDragEnd: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        draggable
        onDragStart={(event) => {
          onDragStart({ type: "due", id: due._id, at: null });
          event.dataTransfer?.setData("text/plain", due._id);
        }}
        onDragEnd={onDragEnd}
        onClick={onOpen}
        className="bg-background focus-visible:ring-ring/50 flex w-full cursor-grab items-center gap-2 rounded-lg p-2 text-left text-sm shadow-xs outline-none transition-shadow hover:shadow-sm focus-visible:ring-3 active:cursor-grabbing"
      >
        <KindIcon kind={due.kind as DeliverableKind} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{due.label}</span>
          <span className="text-muted-foreground truncate text-xs">{due.project.name}</span>
        </span>
        <StatusIcon status={due.status as DeliverableStatus} />
      </button>
    </li>
  );
}

function Group({
  title,
  count,
  children,
  action,
}: {
  title: string;
  count: number;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-muted-foreground flex-1 text-xs font-medium">
          {title} <span className="tabular-nums">{count}</span>
        </h3>
        {action}
      </div>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </section>
  );
}

/**
 * The side list, like Vidflow's: posts with no time (the queue first) and project slots
 * with no due date. Drag one onto a day; drag something from the calendar here to take
 * its time off again.
 */
function WaitingList({
  waiting,
  hasSlots,
  setPanel,
  onDragStart,
  onDragEnd,
}: {
  waiting: Waiting | undefined;
  hasSlots: boolean;
  setPanel: (panel: Panel) => void;
  onDragStart: (dragged: Dragged) => void;
  onDragEnd: () => void;
}) {
  const team = useActiveTeam();
  const fill = useMutation(api.calendar.fill);
  if (waiting === undefined) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-12 rounded-lg" />
        <Skeleton className="h-12 rounded-lg" />
      </div>
    );
  }
  const queued = waiting.posts.filter((post) => post.queued);
  const loose = waiting.posts.filter((post) => !post.queued);
  const shared = { onDragStart, onDragEnd };
  return (
    <div className="flex flex-col gap-5">
      <Button
        size="sm"
        className="self-start"
        data-tour-step-id="tour-calendar-add"
        onClick={() => setPanel({ mode: "add" })}
      >
        <Plus />
        Add Post
      </Button>
      {queued.length > 0 && (
        <Group
          title="Queue"
          count={queued.length}
          action={
            hasSlots && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  void attempt(async () => {
                    const placed = await fill({ organizationId: team.id });
                    if (placed === 0) toast.info("No free slot fits what is queued.");
                  }, "The slots could not be filled.")
                }
              >
                Fill Slots
              </Button>
            )
          }
        >
          {queued.map((post) => (
            <WaitingPost
              key={post._id}
              post={post}
              onOpen={() => setPanel({ mode: "post", id: post._id })}
              {...shared}
            />
          ))}
        </Group>
      )}
      {queued.length > 0 && !hasSlots && (
        <p className="text-muted-foreground -mt-3 text-xs">
          Queued posts go to the next free time of a repeating slot for their platform. Add one
          under Repeating Slots.
        </p>
      )}
      <Group title="Posts" count={loose.length}>
        {loose.map((post) => (
          <WaitingPost
            key={post._id}
            post={post}
            onOpen={() => setPanel({ mode: "post", id: post._id })}
            {...shared}
          />
        ))}
      </Group>
      {waiting.posts.length === 0 && (
        <p className="text-muted-foreground -mt-3 text-sm">
          Nothing waiting. Add a post, or drag one off the calendar to take its time off.
        </p>
      )}
      <Group title="Project Slots" count={waiting.deliverables.length}>
        {waiting.deliverables.map((due) => (
          <WaitingDeliverable
            key={due._id}
            due={due}
            onOpen={() => setPanel({ mode: "due", id: due._id })}
            {...shared}
          />
        ))}
      </Group>
      {waiting.deliverables.length === 0 && (
        <p className="text-muted-foreground -mt-3 text-sm">
          Every project slot has a due date, or there are no projects yet.
        </p>
      )}
    </div>
  );
}

type When = "queue" | "later" | "time";

function AddPost({
  start,
  clients,
  onDone,
}: {
  start: { at?: number; platform?: string };
  clients: Client[];
  onDone: (postIds: Id<"calendarPosts">[]) => void;
}) {
  const team = useActiveTeam();
  const add = useMutation(api.calendar.addPost);
  const addMany = useMutation(api.calendar.addPosts);
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState(start.platform ?? CALENDAR_PLATFORMS[0].id);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [clientId, setClientId] = useState("");
  const [when, setWhen] = useState<When>(start.at ? "time" : "queue");
  const [at, setAt] = useState(start.at ? toInputValue(start.at) : "");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    let postIds: Id<"calendarPosts">[] = [];
    const time = when === "time" ? fromInputValue(at) : null;
    if (when === "time" && time === null) {
      toast.error("Pick a day and time.");
      setPending(false);
      return;
    }
    const shared = {
      organizationId: team.id,
      platform,
      at: time,
      queue: when === "queue",
      ...(clientId ? { clientId: clientId as Id<"clients"> } : {}),
    };
    await attempt(async () => {
      postIds =
        files.length > 0
          ? await addMany({
              ...shared,
              ...(title.trim() ? { title } : {}),
              itemIds: files.map((file) => file._id),
            })
          : [await add({ ...shared, title })];
    }, "The post could not be added.");
    setPending(false);
    if (postIds.length > 0) onDone(postIds);
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span id="post-files" className="text-sm font-medium">
          From Your Library
        </span>
        {files.length > 0 && (
          <PickedFiles
            files={files}
            onRemove={(file) =>
              setFiles((current) => current.filter((entry) => entry._id !== file._id))
            }
          />
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-describedby="post-files"
          className="self-start"
          onClick={() => setChoosing(true)}
        >
          <Clapperboard />
          {files.length === 0 ? "Choose Videos" : "Change Videos"}
        </Button>
        <p className="text-muted-foreground text-xs">
          {files.length > 1
            ? "Each one becomes its own post, named after its file unless a title is given."
            : "Optional. A post takes its file's name when the title is left empty."}
        </p>
        {choosing && (
          <LibraryPicker picked={files} onPick={setFiles} onClose={() => setChoosing(false)} />
        )}
      </div>
      <Field id="post-title" label="Title">
        <Input
          id="post-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={files.length > 0 ? files[0].title : "Episode 12 teaser"}
        />
      </Field>
      <Field id="post-platform" label="Where">
        <PlatformSelect id="post-platform" value={platform} onChange={setPlatform} />
      </Field>
      {clients.length > 0 && (
        <Field id="post-client" label="For">
          <ClientSelect
            id="post-client"
            clients={clients}
            value={clientId}
            onChange={setClientId}
            none="The team"
          />
        </Field>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">When</legend>
        {(
          [
            ["queue", "Next Free Slot"],
            ["later", "Not Scheduled Yet"],
            ["time", "Pick A Time"],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className="choice-tile has-focus-visible:ring-ring/50 flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm has-focus-visible:ring-3"
          >
            <input
              type="radio"
              name="post-when"
              value={value}
              checked={when === value}
              onChange={() => setWhen(value)}
              className="accent-foreground"
            />
            {label}
          </label>
        ))}
        {when === "time" && (
          <Input
            type="datetime-local"
            aria-label="Day and time"
            value={at}
            onChange={(event) => setAt(event.target.value)}
          />
        )}
      </fieldset>
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        {files.length > 1 ? `Add ${files.length} Posts` : "Add Post"}
      </Button>
    </form>
  );
}

function PostDetails({ post, onClose }: { post: Post; onClose: () => void }) {
  const move = useMutation(api.calendar.movePost).withOptimisticUpdate(movePostLocally);
  const queue = useMutation(api.calendar.queuePost);
  const update = useMutation(api.calendar.updatePost);
  const remove = useMutation(api.calendar.removePost);
  const [title, setTitle] = useState(post.title);

  async function saveTitle() {
    if (title.trim() === post.title) return;
    const saved = await attempt(
      () => update({ postId: post._id, title }),
      "The title could not be saved.",
    );
    if (!saved) setTitle(post.title);
  }

  return (
    <div className="flex flex-col gap-4">
      <Field id="detail-title" label="Title">
        <Input
          id="detail-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void saveTitle()}
          onKeyDown={(event) => {
            if (event.key === "Enter") void saveTitle();
          }}
        />
      </Field>
      <Field id="detail-platform" label="Where">
        <PlatformSelect
          id="detail-platform"
          value={post.platform}
          onChange={(platform) =>
            void attempt(() => update({ postId: post._id, platform }), "It could not be moved.")
          }
        />
      </Field>
      <Field
        id="detail-when"
        label="When"
        hint={
          post.queued
            ? "Queued for the next free slot."
            : post.at === null
              ? "Not scheduled yet."
              : undefined
        }
      >
        <Input
          id="detail-when"
          type="datetime-local"
          value={post.at === null ? "" : toInputValue(post.at)}
          onChange={(event) => {
            const at = fromInputValue(event.target.value);
            if (at !== null)
              void attempt(() => move({ postId: post._id, at }), "It could not be moved.");
          }}
        />
      </Field>
      {post.file && (
        <p className="text-sm">
          <Link href={`/library/${post.file._id}`} className="underline underline-offset-4">
            {post.file.shortId} · {post.file.title}
          </Link>
        </p>
      )}
      {post.client && <p className="text-muted-foreground text-sm">For {post.client.name}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={post.status === "posted" ? "outline" : "default"}
          onClick={() =>
            void attempt(
              () => update({ postId: post._id, posted: post.status !== "posted" }),
              "It could not be marked.",
            )
          }
        >
          <Check />
          {post.status === "posted" ? "Mark Not Posted" : "Mark Posted"}
        </Button>
        {!post.queued && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void attempt(async () => {
                const { placed } = await queue({ postId: post._id });
                toast.info(
                  placed ? "It took the next free slot." : "Queued. No free slot fits it yet.",
                );
              }, "It could not be queued.")
            }
          >
            <ListOrdered />
            Add To Queue
          </Button>
        )}
        {post.at !== null && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void attempt(() => move({ postId: post._id, at: null }), "It could not be moved.")
            }
          >
            Take Off Calendar
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          onClick={() =>
            void attempt(async () => {
              await remove({ postId: post._id });
              onClose();
            }, "It could not be removed.")
          }
        >
          <Trash2 />
          Remove
        </Button>
      </div>
    </div>
  );
}

function DueDetails({ due }: { due: Due }) {
  const setDue = useMutation(api.calendar.setDue).withOptimisticUpdate(setDueLocally);
  const value = due.dueAt === null ? "" : dayKey(due.dueAt);
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-sm">
        <StatusIcon status={due.status as DeliverableStatus} />
        {statusLabel(due.status as DeliverableStatus)}
      </p>
      <p className="text-sm">
        <Link href={`/projects/${due.project._id}`} className="underline underline-offset-4">
          {due.project.name}
        </Link>
      </p>
      <Field id="due-day" label="Due">
        <Input
          id="due-day"
          type="date"
          value={value}
          onChange={(event) => {
            if (!event.target.value) return;
            const [y, m, d] = event.target.value.split("-").map(Number);
            const dueAt = new Date(y, m - 1, d, DUE_HOUR).getTime();
            void attempt(
              () => setDue({ deliverableId: due._id, dueAt }),
              "The due date could not be saved.",
            );
          }}
        />
      </Field>
      {due.dueAt !== null && (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() =>
            void attempt(
              () => setDue({ deliverableId: due._id, dueAt: null }),
              "It could not be cleared.",
            )
          }
        >
          Clear Due Date
        </Button>
      )}
    </div>
  );
}

/** The team's repeating slots, and a form to add one, like "Mondays at 10:00 for Instagram". */
function RepeatingSlots({ clients }: { clients: Client[] }) {
  const team = useActiveTeam();
  const slots = useQuery(api.calendar.slots, { organizationId: team.id });
  const add = useMutation(api.calendar.addSlot);
  const remove = useMutation(api.calendar.removeSlot);
  const [weekday, setWeekday] = useState(1);
  const [time, setTime] = useState("10:00");
  const [platform, setPlatform] = useState<string>(CALENDAR_PLATFORMS[0].id);
  const [clientId, setClientId] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    await attempt(async () => {
      const { placed } = await add({
        organizationId: team.id,
        weekday,
        time,
        timeZone: myTimeZone(),
        platform,
        ...(clientId ? { clientId: clientId as Id<"clients"> } : {}),
      });
      if (placed > 0)
        toast.info(
          placed === 1 ? "1 queued post took a time." : `${placed} queued posts took a time.`,
        );
    }, "The slot could not be added.");
    setPending(false);
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted-foreground text-sm">
        Times you post every week. Queued posts fill the next free one for their platform.
      </p>
      {slots === undefined ? (
        <Skeleton className="h-12 rounded-lg" />
      ) : slots.length === 0 ? (
        <p className="text-muted-foreground text-sm">No repeating slots yet.</p>
      ) : (
        <ul aria-label="Repeating slots" className="flex flex-col gap-1.5">
          {slots.map((slot) => (
            <li
              key={slot._id}
              className="bg-background flex items-center gap-2 rounded-lg p-2 text-sm shadow-xs"
            >
              <PlatformMark platform={slot.platform} className="size-4" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">
                  {WEEKDAYS[slot.weekday]}s at {slot.time}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {[slot.client?.name, slot.timeZone.replace(/_/g, " ")]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${WEEKDAYS[slot.weekday]}s at ${slot.time}`}
                onClick={() =>
                  void attempt(() => remove({ slotId: slot._id }), "The slot could not be removed.")
                }
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Add A Slot</h3>
        <div className="grid grid-cols-2 gap-2">
          <Field id="slot-day" label="Day">
            <PickList
              id="slot-day"
              className="w-full"
              value={String(weekday)}
              onChange={(next) => setWeekday(Number(next))}
              options={WEEKDAYS.map((name, index) => ({ value: String(index), label: name }))}
            />
          </Field>
          <Field id="slot-time" label="Time">
            <Input
              id="slot-time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </Field>
        </div>
        <Field id="slot-platform" label="Where">
          <PlatformSelect id="slot-platform" value={platform} onChange={setPlatform} />
        </Field>
        {clients.length > 0 && (
          <Field id="slot-client" label="For">
            <ClientSelect
              id="slot-client"
              clients={clients}
              value={clientId}
              onChange={setClientId}
              none="Anyone"
            />
          </Field>
        )}
        <Button type="submit" size="sm" variant="outline" disabled={pending} className="self-start">
          <Plus />
          Add Slot
        </Button>
      </form>
    </div>
  );
}

/**
 * The panel beside the calendar. It pushes the calendar aside rather than covering it, and
 * is also where dragged items go to lose their time.
 */
export function SidePanel({
  panel,
  setPanel,
  waiting,
  posts,
  dues,
  clients,
  hasSlots,
  dragging,
  onDragStart,
  onDragEnd,
  onUnschedule,
}: {
  panel: Panel;
  setPanel: (panel: Panel) => void;
  waiting: Waiting | undefined;
  posts: Post[];
  dues: Due[];
  clients: Client[];
  hasSlots: boolean;
  dragging: boolean;
  onDragStart: (dragged: Dragged) => void;
  onDragEnd: () => void;
  onUnschedule: () => void;
}) {
  const [over, setOver] = useState(false);
  const back = () => setPanel({ mode: "waiting" });
  const tabs = panel.mode === "waiting" || panel.mode === "slots";

  const drop = {
    onDragOver: (event: DragEvent) => {
      if (!dragging) return;
      event.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setOver(false);
      onUnschedule();
    },
  };

  let body: ReactNode;
  if (panel.mode === "waiting") {
    body = (
      <WaitingList
        waiting={waiting}
        hasSlots={hasSlots}
        setPanel={setPanel}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    );
  } else if (panel.mode === "slots") {
    body = <RepeatingSlots clients={clients} />;
  } else if (panel.mode === "add") {
    body = (
      <>
        <Heading onBack={back}>New Post</Heading>
        {panel.at && (
          <p className="text-muted-foreground -mt-2 text-xs">
            {longDate.format(panel.at)} at {timeLabel(panel.at)}
          </p>
        )}
        <AddPost
          key={`${panel.at}-${panel.platform}`}
          start={panel}
          clients={clients}
          onDone={(ids) => {
            if (ids.length === 1) {
              setPanel({ mode: "post", id: ids[0] });
            } else {
              toast.success(`${ids.length} posts added.`);
              back();
            }
          }}
        />
      </>
    );
  } else if (panel.mode === "post") {
    const post = posts.find((entry) => entry._id === panel.id);
    body = (
      <>
        <Heading onBack={back}>Post</Heading>
        {post ? (
          <PostDetails key={post._id} post={post} onClose={back} />
        ) : (
          <p className="text-muted-foreground text-sm">That post is gone.</p>
        )}
      </>
    );
  } else {
    const due = dues.find((entry) => entry._id === panel.id);
    body = (
      <>
        <Heading onBack={back}>{due?.label ?? "Project Slot"}</Heading>
        {due ? (
          <DueDetails due={due} />
        ) : (
          <p className="text-muted-foreground text-sm">That slot is gone.</p>
        )}
      </>
    );
  }

  return (
    <aside
      aria-label="Side list"
      data-tour-step-id="tour-calendar-waiting"
      {...drop}
      className={cn(
        "flex w-full shrink-0 flex-col gap-4 self-start rounded-xl p-3 transition-colors lg:sticky lg:top-4 lg:max-h-[calc(100svh-2rem)] lg:w-72 lg:overflow-y-auto",
        over ? "bg-muted" : "bg-surface",
      )}
    >
      {tabs && dragging && (
        // Takes the place of the switch above, at its height, so nothing below moves.
        <p className="bg-background text-muted-foreground flex h-[2.125rem] items-center justify-center rounded-lg text-sm">
          Drop here to take it off the calendar
        </p>
      )}
      {tabs && !dragging && (
        <SegmentedGroup aria-label="Side list view">
          {(
            [
              ["waiting", "Not Scheduled"],
              ["slots", "Repeating Slots"],
            ] as const
          ).map(([mode, label]) => (
            <SegmentedButton
              key={mode}
              pressed={panel.mode === mode}
              data-tour-step-id={mode === "slots" ? "tour-calendar-slots" : undefined}
              onClick={() => setPanel({ mode })}
              className="flex-1 px-2"
            >
              {label}
            </SegmentedButton>
          ))}
        </SegmentedGroup>
      )}
      {body}
    </aside>
  );
}
