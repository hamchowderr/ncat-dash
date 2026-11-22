"use client";

import {
  captionCues,
  toPlainTranscript,
  toSrt,
  toVtt,
  transcriptFileName,
  type TimedPiece,
} from "@ncat-dash/automation-core";
import { Copy, Download } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type TranscriptFormat = "srt" | "vtt" | "txt";

const FORMATS: { format: TranscriptFormat; label: string; type: string }[] = [
  { format: "srt", label: "SRT subtitles (.srt)", type: "application/x-subrip" },
  { format: "vtt", label: "WebVTT subtitles (.vtt)", type: "text/vtt" },
  { format: "txt", label: "Plain text (.txt)", type: "text/plain" },
];

/** The transcript written out in one format, as the file would hold it. */
export function transcriptText(pieces: TimedPiece[], format: TranscriptFormat): string {
  if (format === "txt") return toPlainTranscript(pieces);
  const cues = captionCues(pieces);
  return format === "srt" ? toSrt(cues) : toVtt(cues);
}

function save(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Saves the transcript as SRT, WebVTT or plain text, named after the file. */
export function TranscriptDownload({ pieces, title }: { pieces: TimedPiece[]; title: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm">
          <Download />
          Download
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {FORMATS.map((one) => (
          <DropdownMenuItem
            key={one.format}
            onSelect={() =>
              save(
                transcriptText(pieces, one.format),
                transcriptFileName(title, one.format),
                one.type,
              )
            }
          >
            {one.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The SRT or WebVTT file to read, cue by cue, with a button to copy all of it. */
export function SubtitleText({ pieces, format }: { pieces: TimedPiece[]; format: "srt" | "vtt" }) {
  const text = useMemo(() => transcriptText(pieces, format), [pieces, format]);
  const name = format === "srt" ? "SRT" : "WebVTT";
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${name} copied.`);
    } catch {
      toast.error(`The ${name} could not be copied.`);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <pre
        className="bg-surface max-h-[32rem] overflow-auto rounded-xl px-5 py-4 font-mono text-[13px] leading-relaxed whitespace-pre-wrap"
        aria-label={`${name} text`}
        data-testid="subtitle-text"
      >
        {text}
      </pre>
      <div>
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => void copy()}>
          <Copy />
          Copy {name}
        </Button>
      </div>
    </div>
  );
}
