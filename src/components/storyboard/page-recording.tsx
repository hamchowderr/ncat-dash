"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { describeStep, isUnderWay, STATUS_WORDS } from "@convex/lib/pageRecording";
import { useAction, useMutation, useQuery } from "convex/react";
import { Check, Loader2, MonitorPlay, Repeat2, Search } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PickList } from "@/components/ui/pick-list";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/catalog";

import type { Board, Take } from "./types";

type SignInId = Id<"recordingSignIns">;

/** Picked in "Sign in as" to set up a new sign-in in place. */
const ADD = "__add__";

function waitWords(place: number | null) {
  if (!place) return STATUS_WORDS.queued;
  return place === 1
    ? `${STATUS_WORDS.queued}, next up`
    : `${STATUS_WORDS.queued}, ${place} in line`;
}

function seconds(ms: number | null) {
  if (!ms) return "";
  const whole = Math.max(1, Math.round(ms / 1000));
  return `, ${whole} second${whole === 1 ? "" : "s"}`;
}

/**
 * Setting up a saved sign-in: the site's sign-in page opens in a browser the person drives
 * from a new tab, they sign in there themselves, and "I'm signed in" keeps it. It is
 * theirs alone unless they share it with the team, for a team account everyone may use.
 */
function AddSignIn({
  organizationId,
  onSaved,
  onCancel,
}: {
  organizationId: string;
  onSaved: (id: SignInId) => void;
  onCancel: () => void;
}) {
  const start = useAction(api.pageRecordings.startSignIn);
  const finish = useAction(api.pageRecordings.finishSignIn);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ signInId: SignInId; liveViewUrl: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function onStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const started = await start({
        organizationId,
        name: name.trim(),
        url: url.trim(),
        shared,
      });
      setOpen(started);
      window.open(started.liveViewUrl, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setProblem(errorMessage(caught, "The sign-in page could not be opened."));
    } finally {
      setBusy(false);
    }
  }

  async function onFinished() {
    if (!open) return;
    setBusy(true);
    setProblem(null);
    try {
      await finish({ signInId: open.signInId });
      toast.success(`Signed in as ${name.trim()}. Recordings can use it now.`);
      onSaved(open.signInId);
    } catch (caught) {
      setProblem(errorMessage(caught, "The sign-in could not be kept."));
    } finally {
      setBusy(false);
    }
  }

  if (open) {
    return (
      <div
        className="bg-surface flex flex-col gap-2 rounded-lg p-3 text-sm"
        aria-label="New sign-in"
      >
        <p>
          Sign in on the page that opened in a new tab, the way you always do. Your password goes
          only to the site. Come back here when you are in.
        </p>
        {problem && (
          <p role="alert" className="text-destructive">
            {problem}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => void onFinished()}>
            {busy ? "Keeping it…" : "I'm signed in"}
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href={open.liveViewUrl} target="_blank" rel="noopener noreferrer">
              Open the sign-in page again
            </a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => void onStart(event)}
      className="bg-surface flex flex-col gap-2 rounded-lg p-3 text-sm"
      aria-label="New sign-in"
    >
      <label className="flex flex-col gap-1">
        <span className="font-medium">Name it</span>
        <Input
          value={name}
          maxLength={80}
          placeholder="Example Studio admin"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">The site&apos;s sign-in page</span>
        <Input
          value={url}
          placeholder="https://app.example.com/login"
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>
      <label className="flex items-start gap-2">
        <Checkbox
          className="mt-0.5"
          checked={shared}
          onCheckedChange={(on) => setShared(on === true)}
          aria-describedby="sign-in-shared-hint"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">Share with the team</span>
          <span id="sign-in-shared-hint" className="text-muted-foreground text-xs">
            Only for a team account everyone may use. Left off, only you can record with it.
          </span>
        </span>
      </label>
      {problem && (
        <p role="alert" className="text-destructive">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || !name.trim() || !url.trim()}>
          {busy ? "Opening…" : "Open the sign-in page"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** What the agent should record: the page, what to show on it, and who to be signed in as. */
function RecordForm({
  take,
  organizationId,
  start,
  onDone,
}: {
  take: Take;
  organizationId: string;
  start: { url: string; notes: string; signInId: SignInId | null };
  onDone: () => void;
}) {
  const record = useMutation(api.pageRecordings.record);
  const signIns = useQuery(api.pageRecordings.signIns, { organizationId });
  const removeSignIn = useMutation(api.pageRecordings.removeSignIn);
  const shareSignIn = useMutation(api.pageRecordings.shareSignIn);
  const [url, setUrl] = useState(start.url);
  const [notes, setNotes] = useState(start.notes);
  const [signIn, setSignIn] = useState<string>(start.signInId ?? "");
  const [busy, setBusy] = useState(false);
  const saved = (signIns ?? []).filter((entry) => entry.status === "saved");
  const picked = saved.find((entry) => entry._id === signIn) ?? null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await record({
        takeId: take._id,
        url: url.trim(),
        notes: notes.trim(),
        signInId: signIn && signIn !== ADD ? (signIn as SignInId) : null,
      });
      onDone();
    } catch (caught) {
      toast.error(errorMessage(caught, "The recording could not start."));
    } finally {
      setBusy(false);
    }
  }

  async function onShare(id: SignInId, shared: boolean) {
    try {
      await shareSignIn({ signInId: id, shared });
    } catch (caught) {
      toast.error(errorMessage(caught, "The sign-in could not be changed."));
    }
  }

  async function onRemove(id: SignInId) {
    try {
      await removeSignIn({ signInId: id });
      setSignIn("");
    } catch (caught) {
      toast.error(errorMessage(caught, "The sign-in could not be removed."));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(event) => void onSubmit(event)}
        className="flex flex-col gap-3 text-sm"
        aria-label="Record the page"
      >
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1">
            <span className="font-medium">Page address</span>
            <Input
              value={url}
              autoFocus
              placeholder="https://example.com/pricing"
              aria-describedby="page-address-hint"
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <span id="page-address-hint" className="text-muted-foreground text-xs">
            Leave it empty and the agent searches for the page. You check what it found before it is
            recorded.
          </span>
        </div>
        <label className="flex flex-col gap-1">
          <span className="font-medium">What to show</span>
          <Textarea
            value={notes}
            maxLength={2000}
            placeholder={take.line}
            onChange={(event) => setNotes(event.target.value)}
          />
          <span className="text-muted-foreground text-xs">
            Leave it empty to show what the line says.
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Sign in as</span>
          <PickList
            aria-label="Sign in as"
            size="sm"
            value={signIn}
            onChange={setSignIn}
            options={[
              { value: "", label: "Nobody, the page is public" },
              ...saved.map((entry) => ({
                value: entry._id,
                label: entry.mine
                  ? `${entry.name}${entry.shared ? " (shared with the team)" : " (yours)"}`
                  : `${entry.name} (team account)`,
              })),
              { value: ADD, label: "Add a sign-in" },
            ]}
          />
          {picked?.mine && (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void onShare(picked._id, !picked.shared)}
              >
                {picked.shared ? "Stop sharing with the team" : "Share with the team"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void onRemove(picked._id)}
              >
                Remove this sign-in
              </Button>
            </>
          )}
        </div>
        {signIn !== ADD && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {url.trim() ? <MonitorPlay /> : <Search />}
              {busy ? "Starting…" : url.trim() ? "Record" : "Find the page"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          </div>
        )}
      </form>
      {signIn === ADD && (
        <AddSignIn
          organizationId={organizationId}
          onSaved={(id) => setSignIn(id)}
          onCancel={() => setSignIn("")}
        />
      )}
    </div>
  );
}

/**
 * A take's page recording, under its "Page recording" file: record the page with the
 * agent, see where it stands, play the same clicks again, and read what they are.
 */
export function PageRecording({
  take,
  boardId,
  organizationId,
}: {
  take: Take;
  boardId: Board["_id"];
  organizationId: string;
}) {
  const rows = useQuery(api.pageRecordings.forStoryboard, { storyboardId: boardId });
  const record = useMutation(api.pageRecordings.record);
  const [form, setForm] = useState(false);
  const [clicks, setClicks] = useState(false);
  if (rows === undefined) return null;
  const row = rows.find((entry) => entry.takeId === take._id) ?? null;

  async function again(how: "again" | "findAnother" = "again") {
    if (!row) return;
    try {
      await record({
        takeId: take._id,
        url: how === "again" ? row.url : "",
        notes: row.notes,
        signInId: row.signInId,
        ...(how === "again" ? { again: true } : { findAnother: true }),
      });
    } catch (caught) {
      toast.error(errorMessage(caught, "The recording could not start."));
    }
  }

  if (form) {
    return (
      <RecordForm
        take={take}
        organizationId={organizationId}
        start={{ url: row?.url ?? "", notes: row?.notes ?? "", signInId: row?.signInId ?? null }}
        onDone={() => setForm(false)}
      />
    );
  }

  if (!row) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Or let the agent record it from a web page.</span>
        <Button size="sm" variant="outline" onClick={() => setForm(true)}>
          <MonitorPlay />
          Record the page
        </Button>
      </div>
    );
  }

  const underWay = isUnderWay(row.status);
  return (
    <div className="flex flex-col gap-2 text-sm" aria-label="Where the recording stands">
      <div className="flex flex-wrap items-center gap-2">
        {underWay && <Loader2 className="text-muted-foreground size-4 animate-spin" aria-hidden />}
        <span
          role="status"
          className={row.status === "failed" ? "text-destructive font-medium" : "font-medium"}
        >
          {row.status === "queued"
            ? waitWords(row.place)
            : `${STATUS_WORDS[row.status]}${row.status === "done" ? seconds(row.durationMs) : ""}`}
        </span>
        <span className="text-muted-foreground min-w-0 truncate">
          {row.url || "No address given, the agent searches for the page"}
        </span>
      </div>
      {row.status === "failed" && row.problem && (
        <p className="text-muted-foreground">{row.problem}</p>
      )}
      {row.status === "found" && (
        <div className="flex flex-col gap-2">
          {row.previewUrl && (
            // A picture from the agent's browser, kept in Convex storage: not a Next image.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.previewUrl}
              alt={`The page the agent found: ${row.pageTitle ?? row.url}`}
              className="bg-muted w-full max-w-md rounded-md"
            />
          )}
          <p>
            {row.pageTitle && <span className="font-medium">{row.pageTitle} </span>}
            <a
              href={row.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground break-all underline underline-offset-2"
            >
              {row.url}
            </a>
          </p>
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" onClick={() => void again()}>
              <Check />
              Record this
            </Button>
            <Button size="sm" variant="outline" onClick={() => void again("findAnother")}>
              <Search />
              Find another page
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setForm(true)}>
              Give the address
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={clicks}
              onClick={() => setClicks((shown) => !shown)}
            >
              {clicks ? "Hide the clicks" : `Show the clicks (${row.steps.length})`}
            </Button>
          </div>
        </div>
      )}
      {!underWay && row.status !== "found" && (
        <div className="flex flex-wrap items-center gap-1">
          {row.steps.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => void again()}>
              <Repeat2 />
              Record again the same way
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setForm(true)}>
            <MonitorPlay />
            {row.steps.length > 0 ? "Record with new clicks" : "Try again"}
          </Button>
          {row.steps.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={clicks}
              onClick={() => setClicks((shown) => !shown)}
            >
              {clicks ? "Hide the clicks" : `Show the clicks (${row.steps.length})`}
            </Button>
          )}
        </div>
      )}
      {clicks && row.steps.length > 0 && (
        <ol className="text-muted-foreground list-decimal pl-5" aria-label="The clicks">
          {row.steps.map((step, index) => (
            <li key={index}>{describeStep(step)}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
