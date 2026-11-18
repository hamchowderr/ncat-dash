"use client";

import {
  type AutomationNode,
  type Chapter,
  clock,
  showNotes,
  youtubeChapters,
} from "@ncat-dash/automation-core";
import { Check, Copy, Download, ListPlus } from "lucide-react";
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
            step={step}
            canFindMore={!active && !run.testOf}
            busy={busy}
            onFindMore={onFindMore}
          />
        ) : (
          <ChaptersSection key={step._id} title={nodeTitle(node)} step={step} />
        ),
      )}
    </div>
  );
}

function MomentsSection({
  title,
  step,
  canFindMore,
  busy,
  onFindMore,
}: {
  title: string;
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
      <ol className="grid gap-3 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
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
                  className="aspect-video w-full rounded-t-lg bg-black object-contain"
                />
              ) : (
                <div className="bg-muted text-muted-foreground flex aspect-video w-full items-center justify-center rounded-t-lg text-xs">
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
