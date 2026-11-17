"use client";

import { explainFailure } from "@ncat-dash/automation-core";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * Why a step failed, in one short line, with the full text from the toolkit folded away
 * behind "Show details". FFmpeg failures arrive as a long log; only its cause is shown.
 */
export function FailureText({
  text,
  lead,
  className,
}: {
  text: string | null | undefined;
  /** Words before the reason, such as "The last try failed: ". */
  lead?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { reason, details } = explainFailure(text);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("min-w-0", className)}>
      <span className="break-words">
        {lead}
        {reason}
      </span>
      {details && (
        <>
          {" "}
          <CollapsibleTrigger className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 align-baseline text-xs font-medium underline-offset-2 hover:underline">
            {open ? "Hide details" : "Show details"}
            <ChevronDown
              aria-hidden
              className={cn("size-3 transition-transform", open && "rotate-180")}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="text-muted-foreground bg-muted/60 mt-2 max-h-64 overflow-auto rounded-md p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
              {details}
            </pre>
          </CollapsibleContent>
        </>
      )}
    </Collapsible>
  );
}
