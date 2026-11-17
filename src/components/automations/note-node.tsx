"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { type Node, NodeResizer, type NodeProps } from "@xyflow/react";
import { useMutation } from "convex/react";
import { StickyNote, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const NOTE_PREFIX = "note:";

export type NoteNodeData = { noteId: Id<"automationNotes">; text: string; readOnly?: boolean };
export type NoteFlowNode = Node<NoteNodeData, "note">;

/** A saved note as the canvas holds it. */
export function noteFlowNode(note: {
  _id: Id<"automationNotes">;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}): NoteFlowNode {
  return {
    id: `${NOTE_PREFIX}${note._id}`,
    type: "note",
    position: { x: note.x, y: note.y },
    width: note.width,
    height: note.height,
    // Known before the note is drawn, so resizing starts from the size it has.
    measured: { width: note.width, height: note.height },
    data: { noteId: note._id, text: note.text },
    // Notes sit behind the steps and never take part in the flow.
    zIndex: -1,
    connectable: false,
  };
}

/** How long typing pauses before a note is saved. */
const SAVE_AFTER_MS = 600;

/**
 * A sticky note on the canvas, for the team. It saves as it is typed, and can be dragged
 * by its top strip and resized from its corners once chosen.
 */
function NoteNode({ data, selected }: NodeProps<NoteFlowNode>) {
  const update = useMutation(api.notes.update);
  const remove = useMutation(api.notes.remove);
  const [text, setText] = useState(data.text);
  const typing = useRef(false);
  const pending = useRef<{
    timer: ReturnType<typeof setTimeout>;
    text: string;
    noteId: Id<"automationNotes">;
  } | null>(null);

  // A teammate's change shows here, unless this person is typing in the note.
  useEffect(() => {
    if (!typing.current) setText(data.text);
  }, [data.text]);

  // Saves what is waiting straight away: on leaving the note, and when it goes away.
  const flush = useCallback(() => {
    const waiting = pending.current;
    if (!waiting) return;
    pending.current = null;
    clearTimeout(waiting.timer);
    void update({ noteId: waiting.noteId, text: waiting.text });
  }, [update]);
  useEffect(() => flush, [flush]);

  const save = (next: string) => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = {
      text: next,
      noteId: data.noteId,
      timer: setTimeout(flush, SAVE_AFTER_MS),
    };
  };

  return (
    <div
      data-note={data.noteId}
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-lg border border-amber-300/70 bg-amber-50 shadow-sm dark:border-amber-500/30 dark:bg-amber-950/60",
        selected && "ring-ring/50 ring-3",
      )}
    >
      {!data.readOnly && (
        <NodeResizer
          isVisible={selected}
          minWidth={120}
          minHeight={80}
          maxWidth={800}
          maxHeight={800}
          lineClassName="!border-transparent"
          handleClassName="!size-2.5 !rounded-sm !border-amber-400 !bg-background"
        />
      )}
      <div className="flex h-7 shrink-0 cursor-grab items-center gap-1.5 px-2 text-amber-700 active:cursor-grabbing dark:text-amber-300">
        <StickyNote className="size-3.5" aria-hidden="true" />
        <span className="text-[11px] font-medium">Note</span>
        {!data.readOnly && selected && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="nodrag ml-auto size-6 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900"
            onClick={() => void remove({ noteId: data.noteId })}
          >
            <Trash2 className="size-3.5" />
            <span className="sr-only">Remove note</span>
          </Button>
        )}
      </div>
      {data.readOnly ? (
        <p className="min-h-0 flex-1 overflow-auto px-2.5 pb-2 text-sm whitespace-pre-wrap text-amber-950 dark:text-amber-50">
          {text}
        </p>
      ) : (
        <textarea
          aria-label="Note"
          value={text}
          maxLength={2000}
          placeholder="Write a note for your team"
          onFocus={() => (typing.current = true)}
          onBlur={() => {
            typing.current = false;
            flush();
          }}
          onChange={(event) => {
            setText(event.target.value);
            save(event.target.value);
          }}
          className="nodrag nowheel min-h-0 flex-1 resize-none bg-transparent px-2.5 pb-2 text-sm text-amber-950 outline-none placeholder:text-amber-700/60 dark:text-amber-50 dark:placeholder:text-amber-300/50"
        />
      )}
    </div>
  );
}

export const noteNodeTypes = { note: NoteNode };
