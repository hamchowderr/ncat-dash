"use client";

import { ArrowRight, Server, SkipForward, type LucideIcon } from "lucide-react";

const choice =
  "bg-surface hover:bg-muted focus-visible:ring-ring/50 flex w-full items-center gap-3 rounded-xl p-4 text-left outline-none transition-[background-color,transform] duration-150 hover:-translate-y-px focus-visible:ring-3 motion-reduce:transition-none motion-reduce:hover:translate-y-0";

function Choice({
  icon: Icon,
  title,
  detail,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={choice} onClick={onClick}>
      <span className="bg-background grid size-10 shrink-0 place-items-center rounded-lg">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground text-sm">{detail}</span>
      </span>
      <ArrowRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
    </button>
  );
}

/**
 * Whether the person already runs an NCA Toolkit. Yes goes to the address and key form;
 * No skips every toolkit field and carries on setting up. One question, two answers, as
 * in Linear's and Vercel's setup screens.
 */
export function HaveToolkitQuestion({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  return (
    <>
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Do You Have A Toolkit?</h1>
        <p className="text-muted-foreground">
          The NCA Toolkit does the media work and keeps your files. If you have not set one up yet,
          carry on without it and connect it later from Home.
        </p>
      </div>
      <div className="grid gap-2">
        <Choice
          icon={Server}
          title="Yes, I Have One"
          detail="It runs on my server or an always-on machine. I have its address and API key."
          onClick={onYes}
        />
        <Choice
          icon={SkipForward}
          title="No, Not Yet"
          detail="Skip the toolkit for now and finish setting up."
          onClick={onNo}
        />
      </div>
    </>
  );
}
