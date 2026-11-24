"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  CONTENT_KINDS,
  POSTING_APPS,
  type PostingAppId,
  type Starter,
  STARTERS,
  recordsMeetings,
  suggestedStarters,
} from "@takewon/automation-core";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  Briefcase,
  Check,
  Church,
  Gamepad2,
  type LucideIcon,
  Megaphone,
  Mic,
  Music,
  Presentation,
  Rocket,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";

import { FlowStrip } from "@/components/automations/flow-strip";
import { AppTile, type ConnectedApp } from "@/components/brand-logos";
import { FileRuns } from "@/components/library/file-runs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { UploadingRow } from "@/components/uploads/upload-media";
import { errorMessage } from "@/lib/catalog";
import { useSendFile } from "@/lib/send-file";
import { cn } from "@/lib/utils";

import { PostingAppLogo } from "./posting-app-logo";

const KIND_ICONS: Record<string, LucideIcon> = {
  coaching: Presentation,
  podcast: Mic,
  talks: Church,
  music: Music,
  streams: Gamepad2,
  clients: Briefcase,
  entrepreneurs: Rocket,
  business: Megaphone,
};

const tile =
  "choice-tile focus-visible:ring-ring/50 flex items-center gap-3 rounded-xl p-3.5 text-left focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-60";

type Stage = "kinds" | "apps" | "turn-on" | "upload";
const STAGES: Stage[] = ["kinds", "apps", "turn-on", "upload"];

type Made = {
  starterId: string;
  name: string;
  automationId: Id<"automations"> | null;
  on: boolean;
  problem: string | null;
};

/** The tick at the end of a picked tile, so a choice reads at a glance. */
// Steps that pick something with AI once per video; every other step is plain editing.
const usesAi = (starter: Starter) =>
  starter.nodes.some((node) => node.kind === "moments" || node.kind === "chapters");

function Picked({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-primary text-primary-foreground grid size-5 shrink-0 place-items-center rounded-full transition-[opacity,transform] duration-150 motion-reduce:transition-none",
        on ? "scale-100 opacity-100" : "scale-75 opacity-0",
      )}
    >
      <Check className="size-3" strokeWidth={3} />
    </span>
  );
}

function Heading({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h1 className="text-3xl font-bold text-balance">{title}</h1>
      <p className="text-muted-foreground text-pretty">{children}</p>
    </div>
  );
}

/**
 * Asks what the team makes and where it posts, switches on the ready-made automations
 * that fit, then takes a first upload so they start on something real. Modeled on the
 * way Opus Clip and Descript ask what you make before your first project, one question
 * per screen as in Linear's setup.
 */
export function ContentGoalsFlow({
  organizationId,
  stepsBefore = 0,
  stepsTotal = STAGES.length,
  hasToolkit = true,
  onFinish,
}: {
  organizationId: string;
  /** Setting-up steps already done before these, for the "Step 4 of 7" line. */
  stepsBefore?: number;
  stepsTotal?: number;
  /** Without a toolkit there is nowhere to upload to, so the last screen says what is next. */
  hasToolkit?: boolean;
  onFinish: () => void;
}) {
  const saved = useQuery(api.contentGoals.get, { organizationId });
  const save = useMutation(api.contentGoals.save);
  const turnOn = useMutation(api.contentGoals.turnOn);
  const [stage, setStage] = useState<Stage>("kinds");
  const [kinds, setKinds] = useState<string[] | null>(null);
  const [apps, setApps] = useState<PostingAppId[] | null>(null);
  // Nothing is picked until they tick it.
  const [picked, setPicked] = useState<string[]>([]);
  const [made, setMade] = useState<Made[]>([]);
  const [busy, setBusy] = useState(false);

  if (saved === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  // What this visit has picked, starting from what was saved before.
  const pickedKinds = kinds ?? saved.kinds;
  const pickedApps = apps ?? (saved.apps as PostingAppId[]);
  const suggested = suggestedStarters(pickedKinds);
  const isOn = (starter: Starter) => picked.includes(starter.id);
  const chosen = suggested.filter(isOn);
  const step = stepsBefore + STAGES.indexOf(stage) + 1;

  const toggle = <T extends string>(list: T[], id: T) =>
    list.includes(id) ? list.filter((each) => each !== id) : [...list, id];

  async function saveAnswers() {
    setBusy(true);
    try {
      // A member who is not an owner or admin still gets the suggestions; the team's
      // answers are left for those who manage it.
      if (saved?.canEdit) await save({ organizationId, kinds: pickedKinds, apps: pickedApps });
      setStage("turn-on");
    } catch (caught) {
      toast.error(errorMessage(caught, "Your answers could not be saved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function switchOn() {
    setBusy(true);
    try {
      setMade(await turnOn({ organizationId, starterIds: chosen.map((starter) => starter.id) }));
      setStage("upload");
    } catch (caught) {
      toast.error(errorMessage(caught, "The automations could not be added. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        Step {step} of {stepsTotal}
      </p>

      {stage === "kinds" && (
        <>
          <Heading title="What Do You Make?">
            Pick everything that fits. We&apos;ll suggest ready-made automations made for it on each
            video you upload, ready to run with one press.
          </Heading>
          <div role="group" aria-label="What you make" className="grid gap-2 sm:grid-cols-2">
            {CONTENT_KINDS.map((kind) => {
              const Icon = KIND_ICONS[kind.id] ?? Presentation;
              const on = pickedKinds.includes(kind.id);
              return (
                <button
                  key={kind.id}
                  type="button"
                  aria-pressed={on}
                  className={tile}
                  onClick={() => setKinds(toggle(pickedKinds, kind.id))}
                >
                  <span
                    className={cn(
                      "grid size-10 shrink-0 place-items-center rounded-lg transition-colors",
                      on ? "bg-primary text-primary-foreground" : "bg-background",
                    )}
                  >
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="grid flex-1 gap-0.5">
                    <span className="text-sm font-medium">{kind.label}</span>
                    <span className="text-muted-foreground text-sm">{kind.detail}</span>
                  </span>
                  <Picked on={on} />
                </button>
              );
            })}
          </div>
          <div className="flex justify-end">
            <Button disabled={pickedKinds.length === 0} onClick={() => setStage("apps")}>
              Continue
              <ArrowRight />
            </Button>
          </div>
        </>
      )}

      {stage === "apps" && (
        <>
          <Heading title="Where do you post?">
            Clips are made to fit the first one you pick. The agent makes clips for all of them
            without asking. You can change this later in Settings, under Agent.
          </Heading>
          <div
            role="group"
            aria-label="Where you post"
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          >
            {POSTING_APPS.map((app) => (
              <button
                key={app.id}
                type="button"
                aria-pressed={pickedApps.includes(app.id)}
                className={tile}
                onClick={() => setApps(toggle(pickedApps, app.id))}
              >
                <PostingAppLogo app={app.id} />
                <span className="flex-1 text-sm font-medium">{app.label}</span>
                <Picked on={pickedApps.includes(app.id)} />
              </button>
            ))}
          </div>
          <div className="flex justify-between gap-3">
            <Button variant="ghost" onClick={() => setStage("kinds")}>
              Back
            </Button>
            <Button disabled={busy} onClick={saveAnswers}>
              {pickedApps.length === 0 ? "Continue without one" : "Continue"}
              <ArrowRight />
            </Button>
          </div>
        </>
      )}

      {stage === "turn-on" && (
        <>
          <Heading title="Suggest these on your uploads">
            One for each kind of content you make, none ticked. Tick any you want. None of them runs
            by itself: each shows on your uploads, ready to run with one press.
          </Heading>
          <ul className="grid gap-2" aria-label="Ready-made automations for you">
            {suggested.map((starter) => (
              <li key={starter.id}>
                <SuggestedRow
                  starter={starter}
                  on={isOn(starter)}
                  onToggle={() => setPicked(toggle(picked, starter.id))}
                />
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-sm">
            These are picked for what you make.{" "}
            <Link href="/automations/new" className="text-foreground underline underline-offset-4">
              See all {STARTERS.length} ready-made automations
            </Link>
            , any of which you can switch on later.
          </p>
          <div className="flex justify-between gap-3">
            <Button variant="ghost" onClick={() => setStage("apps")}>
              Back
            </Button>
            <Button
              disabled={busy}
              onClick={chosen.length > 0 ? switchOn : () => setStage("upload")}
            >
              {chosen.length === 0
                ? "Continue without these"
                : chosen.length === 1
                  ? "Add 1 automation"
                  : `Add ${chosen.length} automations`}
              <ArrowRight />
            </Button>
          </div>
        </>
      )}

      {stage === "upload" &&
        (hasToolkit ? (
          <FirstUpload
            organizationId={organizationId}
            made={made}
            meetings={recordsMeetings(pickedKinds)}
            onFinish={onFinish}
          />
        ) : (
          <ToolkitNext made={made} onFinish={onFinish} />
        ))}
    </div>
  );
}

/** The last screen: one recording in, and the runs it starts as they begin. */
function FirstUpload({
  organizationId,
  made,
  meetings,
  onFinish,
}: {
  organizationId: string;
  made: Made[];
  /** The team records in online meetings, so connecting a meeting app is offered too. */
  meetings: boolean;
  onFinish: () => void;
}) {
  const startUpload = useAction(api.storage.startUpload);
  const sendFile = useSendFile();
  const finishUpload = useMutation(api.storage.finishUpload);
  const removeUpload = useMutation(api.storage.removeUpload);
  const input = useRef<HTMLInputElement>(null);
  const [going, setGoing] = useState<{ name: string; percent: number } | null>(null);
  const [uploaded, setUploaded] = useState<{ id: Id<"uploads">; name: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const on = made.filter((each) => each.on);

  async function send(file: File) {
    let uploadId: Id<"uploads"> | null = null;
    try {
      const started = await startUpload({
        organizationId,
        fileName: file.name,
        contentType: file.type,
        size: file.size,
      });
      uploadId = started.uploadId;
      setGoing({ name: file.name, percent: 0 });
      await sendFile(started, file, (percent) => setGoing({ name: file.name, percent }));
      await finishUpload({ uploadId: started.uploadId });
      setUploaded({ id: started.uploadId, name: file.name });
    } catch (caught) {
      if (uploadId) await removeUpload({ uploadId });
      toast.error(
        errorMessage(
          caught,
          `${file.name} did not upload. Check your bucket's CORS rule allows PUT from this site.`,
        ),
      );
    } finally {
      setGoing(null);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void send(file);
  }

  return (
    <>
      <Heading title="Upload your first recording">
        It goes into your content library and is transcribed, so you can search for what was said.
        {on.length > 0 && " The automations you picked show on it, ready to run with one press."}
      </Heading>

      <MadeList made={made} />

      {uploaded ? (
        <section
          aria-label="What your upload started"
          className="bg-surface grid gap-3 rounded-xl p-4"
        >
          <p className="text-sm">
            <span className="font-medium">{uploaded.name}</span> is in your library.
          </p>
          {on.length > 0 && <FileRuns uploadId={uploaded.id} />}
        </section>
      ) : going ? (
        <UploadingRow name={going.name} percent={going.percent} />
      ) : (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          data-dragging={dragging}
          className="bg-surface data-[dragging=true]:bg-accent/50 flex flex-col items-center gap-3 rounded-xl p-8 text-center transition-colors"
        >
          <UploadCloud className="text-muted-foreground size-8" aria-hidden="true" />
          <p className="text-sm">Drop a recording here, or choose it from your computer.</p>
          <p className="text-muted-foreground max-w-sm text-sm text-pretty">
            Start with one about 5 minutes long, so you have something to work with in a few
            minutes. Longer recordings work too; they just take a bit longer.
          </p>
          <input
            ref={input}
            type="file"
            accept="video/*,audio/*"
            className="sr-only"
            aria-label="Choose a recording to upload"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void send(file);
              event.target.value = "";
            }}
          />
          <Button size="sm" onClick={() => input.current?.click()}>
            Choose a recording
          </Button>
        </div>
      )}

      {meetings && <MeetingApps />}

      <div className="flex justify-end">
        {uploaded ? (
          <Button onClick={onFinish}>
            Go to the dashboard
            <ArrowRight />
          </Button>
        ) : (
          <Button variant="ghost" onClick={onFinish} disabled={going !== null}>
            Skip for now
          </Button>
        )}
      </div>
    </>
  );
}

const MEETING_APPS = [
  { app: "zoom", name: "Zoom" },
  { app: "google-meet", name: "Google Meet" },
  { app: "microsoft", name: "Microsoft 365" },
] as const satisfies readonly { app: ConnectedApp; name: string }[];

/**
 * For teams that record calls: connect a meeting app and each recording comes in by itself,
 * like an upload. Each opens its page in a new tab, so setting up stays where it is.
 */
function MeetingApps() {
  return (
    <section aria-labelledby="meeting-apps" className="grid gap-3">
      <div className="grid gap-1">
        <h2 id="meeting-apps" className="text-sm font-medium">
          Record your sessions on a call?
        </h2>
        <p className="text-muted-foreground text-sm">
          Connect your meeting app and each recording comes in by itself, like an upload.
        </p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-3">
        {MEETING_APPS.map(({ app, name }) => (
          <li key={app}>
            <a
              href={`/settings/integrations/${app}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`Connect ${name} (opens in a new tab)`}
              className="bg-surface hover:bg-muted flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors"
            >
              <AppTile app={app} small />
              {name}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What the turn-on screen made: each one on, or made but off with the reason. */
/** One ready-made to tick on the "Suggest these on your uploads" screen. */
function SuggestedRow({
  starter,
  on,
  onToggle,
}: {
  starter: Starter;
  on: boolean;
  onToggle: () => void;
}) {
  const id = `suggested-${starter.id}`;
  return (
    <label
      htmlFor={id}
      title={starter.description}
      className={cn(
        "bg-surface hover:bg-muted flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 transition-colors",
        on && "bg-primary/10 hover:bg-primary/15",
      )}
    >
      <Checkbox id={id} checked={on} onCheckedChange={onToggle} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
          {starter.name}
          {usesAi(starter) && (
            <span className="text-muted-foreground text-xs font-normal">AI picks the moments</span>
          )}
        </span>
        <span className="text-muted-foreground truncate text-sm">{starter.description}</span>
      </span>
      <FlowStrip
        trigger={starter.trigger}
        nodes={starter.nodes}
        edges={starter.edges}
        size="sm"
        className="hidden shrink-0 sm:flex"
      />
    </label>
  );
}

function MadeList({ made }: { made: Made[] }) {
  if (made.length === 0) return null;
  const on = made.filter((each) => each.on);
  const off = made.filter((each) => !each.on);
  return (
    <ul className="grid gap-1.5 text-sm" aria-label="Your automations">
      {on.map((each) => (
        <li key={each.starterId} className="flex items-center gap-2">
          <span className="bg-emerald-600 size-2 rounded-full" aria-hidden="true" />
          <span>
            <span className="font-medium">{each.name}</span> is ready for your uploads
          </span>
        </li>
      ))}
      {off.map((each) => (
        <li key={each.starterId} className="flex items-start gap-2">
          <span
            className="bg-muted-foreground/50 mt-1.5 size-2 shrink-0 rounded-full"
            aria-hidden="true"
          />
          <span>
            <span className="font-medium">{each.name}</span> is made but off.{" "}
            <span className="text-muted-foreground">{each.problem}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The last screen for a team that set up without a toolkit: what is switched on, and that
 * it all starts once a toolkit is connected, since uploads are kept in the toolkit's storage.
 */
function ToolkitNext({ made, onFinish }: { made: Made[]; onFinish: () => void }) {
  const router = useRouter();
  return (
    <>
      <Heading title="Connect A Toolkit When You're Ready">
        Uploads and finished files are kept in your toolkit&apos;s storage, so recordings go in once
        one is connected.
        {made.some((each) => each.on) &&
          " The automations you switched on then start on them by themselves."}{" "}
        Connect it any time in Settings, under Toolkit.
      </Heading>
      <MadeList made={made} />
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="ghost" onClick={() => router.replace("/settings/toolkit")}>
          Connect A Toolkit
        </Button>
        <Button onClick={onFinish}>
          Go to the dashboard
          <ArrowRight />
        </Button>
      </div>
    </>
  );
}
