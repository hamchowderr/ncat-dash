"use client";

import {
  type AutomationEdge,
  type AutomationNode,
  type Chapter,
  checkedName,
  cleanupSentence,
  footageSummary,
  clipsKeepShape,
  clock,
  frameSize,
  getPlatform,
  languageOf,
  showNotes,
  youtubeChapters,
} from "@takewon/automation-core";
import { Check, CircleAlert, CircleCheck, Copy, Download, ListPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { nodeTitle } from "@/lib/automations";

import type { RunDetails } from "./run-steps";

type RunStep = RunDetails["steps"][number];

const VIDEO = /\.(mp4|mov|webm|mkv|m4v)(\?|$)/i;

/** "37 s", "1 min 5 s". */
function length(seconds: number): string {
  const whole = Math.round(seconds);
  return whole < 60 ? `${whole} s` : `${Math.floor(whole / 60)} min ${whole % 60} s`;
}

/**
 * What the Best moments and Chapters steps of a run picked: the moments with their clips,
 * and the chapters to copy into a description or download as show notes. Nothing shows
 * until a step has picked something.
 */
export function PicksPanel({
  run,
  busy,
  onFindMore,
}: {
  run: RunDetails;
  busy: boolean;
  /** Runs the automation again on the same video; moments already picked are skipped. */
  onFindMore: () => void;
}) {
  const nodes = run.nodes as AutomationNode[];
  const active = run.status === "running" || run.status === "waiting";
  const shown = run.steps.flatMap((step) => {
    const node = nodes.find((candidate) => candidate.id === step.nodeId);
    if (!node) return [];
    if (node.kind === "moments" && step.moments?.length) return [{ node, step }];
    if (node.kind === "chapters" && step.chapters?.length) return [{ node, step }];
    if (node.kind === "broll" && step.cutaways?.length) return [{ node, step }];
    if (node.kind === "cleanup" && step.cleaned?.length) return [{ node, step }];
    if (node.kind === "footage-check" && step.footage?.files.length) return [{ node, step }];
    if (node.kind === "subtitles" && step.status === "done" && step.subtitles?.length) {
      return [{ node, step }];
    }
    if (step.disclosures?.length) return [{ node, step }];
    return [];
  });
  if (shown.length === 0) return null;
  return (
    <div className="grid gap-4">
      {shown.map(({ node, step }) =>
        node.kind === "moments" ? (
          <MomentsSection
            key={step._id}
            title={nodeTitle(node)}
            shape={clipShape(node, nodes, run.edges as AutomationEdge[])}
            step={step}
            canFindMore={!active && !run.testOf}
            busy={busy}
            onFindMore={onFindMore}
          />
        ) : node.kind === "broll" ? (
          <CutawaysSection key={step._id} title={nodeTitle(node)} step={step} />
        ) : node.kind === "cleanup" ? (
          <CleanupSection key={step._id} title={nodeTitle(node)} step={step} />
        ) : node.kind === "footage-check" ? (
          <FootageSection key={step._id} title={nodeTitle(node)} step={step} />
        ) : node.kind === "subtitles" ? (
          <SubtitlesSection key={step._id} title={nodeTitle(node)} step={step} />
        ) : step.disclosures?.length ? (
          <DisclosureSection key={step._id} title={nodeTitle(node)} step={step} />
        ) : (
          <ChaptersSection key={step._id} title={nodeTitle(node)} step={step} />
        ),
      )}
    </div>
  );
}

/**
 * The subtitle files a Translate Subtitles step wrote: one row per video, one link per
 * language. A video with no speech heard has no files, and the note says so.
 */
function SubtitlesSection({ title, step }: { title: string; step: RunStep }) {
  const files = step.subtitles ?? [];
  const videos = [...new Set(files.map((file) => file.source))];
  return (
    <section aria-label={title} className="bg-surface rounded-xl">
      <header className="grid px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-muted-foreground text-xs">
          SRT files to upload beside each video. They are kept in Files under Subtitles.
        </p>
      </header>
      <ul className="grid gap-1 px-4 pb-4">
        {videos.map((video) => {
          const made = files.filter((file) => file.source === video && file.link);
          const name = files.find((file) => file.source === video)?.name ?? "";
          return (
            <li key={video} className="bg-background grid gap-2 rounded-lg px-3 py-2">
              <p className="truncate text-sm">{name.replace(/\.[^.]+\.srt$/, "")}</p>
              {made.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {made.map((file) => (
                    <a
                      key={file.language}
                      href={file.link}
                      target="_blank"
                      rel="noreferrer"
                      download={file.name}
                      className="bg-muted hover:bg-accent flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
                    >
                      <Download className="size-3" />
                      {languageOf(file.language)?.name ?? file.language}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">No speech was heard in this video.</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A take's file code as it reads: "hook02" is "Hook 2". */
function takeName(label: string | null): string {
  if (!label) return "Cleaned video";
  const hook = /^hook0?(\d)$/.exec(label);
  return hook ? `Hook ${hook[1]}` : label === "body" ? "Body" : label;
}

/**
 * What Clean Up Pauses And Retakes took out of each video, how long it was and is now, and
 * the files it made: one cleaned video, or each hook take and the body.
 */
function CleanupSection({ title, step }: { title: string; step: RunStep }) {
  const cleaned = step.cleaned ?? [];
  // The step's files, in the order its plans were made.
  const files = step.jobs.flatMap((job) => job.outputs);
  let at = 0;
  return (
    <section aria-label={title} className="bg-surface rounded-xl">
      <header className="grid px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-muted-foreground text-xs">No AI: pauses and retakes found by rules.</p>
      </header>
      <ul className="grid gap-1 px-4 pb-4">
        {cleaned.map((one) => {
          const made = one.labels.map((label) => ({ label, url: files[at++] }));
          return (
            <li key={one.source} className="bg-background grid gap-2 rounded-lg px-3 py-2">
              <p className="text-sm">{cleanupSentence(one)}</p>
              <p className="text-muted-foreground text-xs tabular-nums">
                {length(one.before)} down to {length(one.after)}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {made.map(({ label, url }, index) =>
                  url ? (
                    <a
                      key={`${label}-${index}`}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="bg-muted hover:bg-accent rounded-md px-2 py-1 text-xs font-medium"
                    >
                      {takeName(label)}
                    </a>
                  ) : (
                    <span
                      key={`${label}-${index}`}
                      className="bg-muted text-muted-foreground rounded-md px-2 py-1 text-xs"
                    >
                      {takeName(label)}
                    </span>
                  ),
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A file's name from its address: "Boots ad.mp4" from ".../Boots%20ad.mp4?x=1". */
function fileName(url: string): string {
  const last = url.split(/[?#]/)[0].split("/").pop() ?? url;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * The paid-ad disclosure a Length Cuts or Hook And Ending Variants step kept in every cut
 * of each video, as it was said, or that none was heard, so the team can have the creator
 * add one before the ads go out.
 */
function DisclosureSection({ title, step }: { title: string; step: RunStep }) {
  const notes = step.disclosures ?? [];
  return (
    <section aria-label={`${title}: paid-ad disclosure`} className="bg-surface rounded-xl">
      <header className="grid px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-muted-foreground text-xs">
          Paid-ad disclosure, found in what was said. No AI.
        </p>
      </header>
      <ul className="grid gap-1 px-4 pb-4">
        {notes.map((note, index) => (
          <li
            key={`${note.source}-${index}`}
            className="bg-background grid gap-1 rounded-lg px-3 py-2"
          >
            <p className="text-muted-foreground truncate text-xs">{fileName(note.source)}</p>
            {note.text ? (
              <p className="text-sm">
                Kept in every cut: <q className="font-medium">{note.text}</q>
              </p>
            ) : (
              <p className="text-sm">
                No disclosure was heard, so the cuts have none. A paid creator&apos;s ad should say
                it is one, like &ldquo;paid partnership with&hellip;&rdquo;.
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What Check Footage found in each file before editing: its size and length, and every
 * problem in plain words, or that it is fine. Says whether the run stopped, and where the
 * note for the creator was left.
 */
function FootageSection({ title, step }: { title: string; step: RunStep }) {
  const footage = step.footage!;
  const bad = footage.files.filter((file) => file.problems.length > 0).length;
  return (
    <section aria-label={title} className="bg-surface rounded-xl">
      <header className="grid px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-muted-foreground text-xs text-pretty">
          {footageSummary(footage.files)}{" "}
          {bad > 0 && (footage.stopped ? "Editing did not start. " : "Editing went ahead. ")}
          No AI: measured by your toolkit, judged by rules.
          {footage.note ? ` A note for the creator is in ${footage.note}.` : ""}
        </p>
      </header>
      <ul className="grid gap-1 px-4 pb-4">
        {footage.files.map((file) => {
          const fine = file.problems.length === 0;
          const facts = [
            file.width && file.height ? `${file.width}×${file.height}` : null,
            typeof file.duration === "number" ? length(file.duration) : null,
            typeof file.loudness === "number" ? `${Math.round(file.loudness)} LUFS` : null,
          ].filter(Boolean);
          return (
            <li
              key={file.url}
              className="bg-background grid grid-cols-[auto_1fr] gap-x-3 rounded-lg px-3 py-2"
            >
              {fine ? (
                <CircleCheck className="mt-0.5 size-4 text-emerald-600" aria-label="Fine" />
              ) : (
                <CircleAlert className="mt-0.5 size-4 text-amber-600" aria-label="Needs a look" />
              )}
              <div className="grid gap-1">
                <p className="text-sm font-medium break-all">
                  {checkedName(file)}
                  {facts.length > 0 && (
                    <span className="text-muted-foreground font-normal tabular-nums">
                      {" "}
                      · {facts.join(" · ")}
                    </span>
                  )}
                </p>
                {fine ? (
                  <p className="text-muted-foreground text-xs">Fine to edit.</p>
                ) : (
                  <ul className="grid gap-0.5 text-xs text-pretty">
                    {file.problems.map((problem) => (
                      <li key={problem.kind}>{problem.says}</li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The clips' own width over height: the platform's frame, or the video's when the clips go
 * on to Follow the speaker in their original shape (taken as 16:9 until one loads).
 */
function clipShape(node: AutomationNode, nodes: AutomationNode[], edges: AutomationEdge[]) {
  const size = clipsKeepShape(node.id, nodes, edges)
    ? null
    : frameSize(getPlatform(node.input.platform)?.frame);
  return size ? size.width / size.height : 16 / 9;
}

function MomentsSection({
  title,
  shape,
  step,
  canFindMore,
  busy,
  onFindMore,
}: {
  title: string;
  /** Width over height of the clips. */
  shape: number;
  step: RunStep;
  canFindMore: boolean;
  busy: boolean;
  onFindMore: () => void;
}) {
  const moments = step.moments ?? [];
  const cutting = step.stage === "cut" && step.status === "running";
  return (
    <section aria-label={title} className="bg-surface rounded-xl">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="grid">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-muted-foreground text-xs">
            {moments.length} {moments.length === 1 ? "moment" : "moments"}, best first. Each clip
            starts and ends on whole words.
            {step.pickNote ? ` ${step.pickNote}` : ""}
          </p>
        </div>
        {canFindMore && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onFindMore}>
            <ListPlus />
            Find more moments
          </Button>
        )}
      </header>
      <ol
        className="grid gap-3 px-4 pb-4"
        // Tall clips sit side by side like a feed; wide ones get room to be seen.
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${shape < 1 ? 13 : 18}rem, 1fr))`,
        }}
      >
        {moments.map((moment, index) => {
          const job = step.jobs[index];
          const clip = job?.status === "done" ? job.outputs.find((url) => VIDEO.test(url)) : null;
          return (
            <li key={`${moment.source}-${moment.start}`} className="bg-background rounded-lg">
              {clip ? (
                <video
                  src={clip}
                  controls
                  preload="metadata"
                  style={{ aspectRatio: shape }}
                  className="w-full rounded-t-lg bg-black object-cover"
                />
              ) : (
                <div
                  style={{ aspectRatio: shape }}
                  className="bg-muted text-muted-foreground flex w-full items-center justify-center rounded-t-lg text-xs"
                >
                  {job?.status === "failed"
                    ? "This clip could not be cut"
                    : cutting
                      ? "Cutting…"
                      : "Not cut"}
                </div>
              )}
              <div className="grid gap-1 p-3">
                <p className="text-sm font-medium text-pretty">
                  <span className="text-muted-foreground tabular-nums">{index + 1}.</span>{" "}
                  {moment.title}
                </p>
                <p className="text-muted-foreground text-xs tabular-nums">
                  {clock(moment.start)} to {clock(moment.end)} · {length(moment.end - moment.start)}
                </p>
                {moment.why && <p className="text-xs text-pretty">{moment.why}</p>}
                <p
                  className="text-muted-foreground line-clamp-3 text-xs text-pretty"
                  title={moment.text}
                >
                  “{moment.text}”
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ChaptersSection({ title, step }: { title: string; step: RunStep }) {
  const [copied, setCopied] = useState(false);
  const all = step.chapters ?? [];
  // One list per video, in the order they reached the step.
  const videos = [...new Set(all.map((chapter) => chapter.source))];
  const chaptersOf = (source: string): Chapter[] =>
    all.filter((chapter) => chapter.source === source);

  async function copy() {
    try {
      await navigator.clipboard.writeText(
        videos.map((v) => youtubeChapters(chaptersOf(v))).join("\n\n"),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy. Select the chapters and copy them instead.");
    }
  }

  return (
    <section aria-label={title} className="bg-surface rounded-xl">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="grid">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-muted-foreground text-xs">
            {all.length} chapters, each starting on a whole sentence. Paste them into a YouTube
            description and they show on the video&apos;s timeline.
            {step.pickNote ? ` ${step.pickNote}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy YouTube chapters"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              download("Show notes.md", videos.map((v) => showNotes(chaptersOf(v))).join("\n"))
            }
          >
            <Download />
            Download show notes
          </Button>
        </div>
      </header>
      <ol className="grid gap-1 px-4 pb-4">
        {all.map((chapter) => (
          <li
            key={`${chapter.source}-${chapter.start}`}
            className="bg-background grid grid-cols-[4.5rem_1fr] gap-x-3 rounded-lg px-3 py-2"
          >
            <span className="text-muted-foreground text-sm tabular-nums">
              {clock(chapter.start)}
            </span>
            <div className="grid gap-1">
              <p className="text-sm font-medium">{chapter.title}</p>
              {chapter.bullets.length > 0 && (
                <ul className="text-muted-foreground list-disc pl-4 text-xs">
                  {chapter.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * What Add B-Roll laid over the video: each cutaway, the words it covers, and where its
 * footage is from. Stock clips name their site and maker and link their page, as the sites
 * ask.
 */
function CutawaysSection({ title, step }: { title: string; step: RunStep }) {
  const cutaways = step.cutaways ?? [];
  return (
    <section aria-label={title} className="bg-surface rounded-xl">
      <header className="grid px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-muted-foreground text-xs">
          {cutaways.length} {cutaways.length === 1 ? "cutaway" : "cutaways"} over the video, while
          the voice carries on.
          {step.pickNote ? ` ${step.pickNote}` : ""}
        </p>
      </header>
      <ol className="grid gap-1 px-4 pb-4">
        {cutaways.map((cut) => (
          <li
            key={`${cut.source}-${cut.start}`}
            className="bg-background grid grid-cols-[6.5rem_1fr] gap-x-3 rounded-lg px-3 py-2"
          >
            <span className="text-muted-foreground text-sm tabular-nums">
              {clock(cut.start)} to {clock(cut.end)}
            </span>
            <div className="grid gap-1">
              <p className="text-sm font-medium">
                {cut.kind === "library" ? (
                  <>
                    {cut.title}{" "}
                    <span className="text-muted-foreground font-normal">
                      · {cut.ref} in your library
                    </span>
                  </>
                ) : (
                  <>
                    {cut.credit ? (
                      <a
                        href={cut.credit.page}
                        target="_blank"
                        rel="noreferrer"
                        className="underline-offset-2 hover:underline"
                      >
                        {cut.title || "Stock clip"}
                      </a>
                    ) : (
                      cut.title || "Stock clip"
                    )}{" "}
                    {cut.credit && (
                      <span className="text-muted-foreground font-normal">
                        · {cut.credit.by ? `${cut.credit.by} on ` : ""}
                        {cut.credit.site}
                      </span>
                    )}
                  </>
                )}
              </p>
              <p
                className="text-muted-foreground line-clamp-2 text-xs text-pretty"
                title={cut.said}
              >
                “{cut.said}”
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
