"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { type Dimensions, type NodeChange, NodeChangeset, type XYPosition } from "@xyflow/react";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/catalog";

import { NOTE_PREFIX, type NoteFlowNode, noteFlowNode } from "./note-node";

/** What this person has done to a note that the saved copy does not show yet. */
type Local = Partial<Pick<NoteFlowNode, "position" | "width" | "height" | "selected" | "dragging">>;

export const isNoteId = (id: string) => id.startsWith(NOTE_PREFIX);
const noteIdOf = (id: string) => id.slice(NOTE_PREFIX.length) as Id<"automationNotes">;

/**
 * The automation's sticky notes as canvas nodes. They are saved as they change, apart
 * from the automation and its drafts, so teammates see them straight away. While a note
 * is dragged or resized here, this person's copy wins until the change is saved.
 */
export function useCanvasNotes(automationId: Id<"automations">) {
  const saved = useQuery(api.notes.list, { automationId });
  const add = useMutation(api.notes.add);
  const update = useMutation(api.notes.update);
  const remove = useMutation(api.notes.remove);
  const [local, setLocal] = useState<Record<string, Local>>({});

  const noteNodes = useMemo(
    () =>
      (saved ?? []).map((note) => ({
        ...noteFlowNode(note),
        ...local[`${NOTE_PREFIX}${note._id}`],
      })),
    [saved, local],
  );

  const forget = (id: string, keys: (keyof Local)[]) =>
    setLocal((current) => {
      const kept = { ...current[id] };
      for (const key of keys) delete kept[key];
      return { ...current, [id]: kept };
    });

  const keep = async (
    id: string,
    place: Record<string, number | undefined>,
    keys: (keyof Local)[],
  ) => {
    try {
      await update({ noteId: noteIdOf(id), ...place });
    } catch (error) {
      toast.error(errorMessage(error, "The note could not be saved."));
    }
    forget(id, keys);
  };

  /** Takes the canvas's changes to notes. Moves and sizes are saved when they end. */
  function onNoteChanges(changes: NodeChange<NoteFlowNode>[]) {
    const next = new NodeChangeset(changes).applyTo(noteNodes);
    setLocal((current) => {
      const updated = { ...current };
      for (const change of changes) {
        const node = next.find((candidate) => candidate.id === change.id);
        if (!node) continue;
        const own = { ...updated[change.id] };
        if (change.type === "select") own.selected = change.selected;
        if (change.type === "position" && change.position) {
          own.position = change.position;
          own.dragging = change.dragging;
        }
        if (change.type === "dimensions" && change.resizing !== undefined && change.dimensions) {
          own.width = change.dimensions.width;
          own.height = change.dimensions.height;
        }
        updated[change.id] = own;
      }
      return updated;
    });
    // A resize has ended: keep where the note now sits and how big it is.
    for (const change of changes) {
      if (change.type !== "dimensions" || change.resizing !== false || !change.dimensions) continue;
      const node = next.find((candidate) => candidate.id === change.id);
      void keep(change.id, { x: node?.position.x, y: node?.position.y, ...change.dimensions }, [
        "width",
        "height",
        "position",
      ]);
    }
  }

  /** A note has been put down after dragging. */
  function onNoteDragStop(id: string, position: XYPosition) {
    void keep(id, { x: position.x, y: position.y }, ["position", "dragging"]);
  }

  async function addNote(position: XYPosition) {
    try {
      const noteId = await add({ automationId, x: position.x, y: position.y });
      // The new note is chosen, ready to be written in.
      setLocal((current) => {
        const cleared = Object.fromEntries(
          Object.entries(current).map(([id, own]) => [id, { ...own, selected: false }]),
        );
        return { ...cleared, [`${NOTE_PREFIX}${noteId}`]: { selected: true } };
      });
    } catch (error) {
      toast.error(errorMessage(error, "The note could not be added."));
    }
  }

  async function removeNotes(ids: string[]) {
    for (const id of ids) {
      try {
        await remove({ noteId: noteIdOf(id) });
      } catch (error) {
        toast.error(errorMessage(error, "The note could not be removed."));
      }
    }
  }

  return { noteNodes, onNoteChanges, onNoteDragStop, addNote, removeNotes };
}

const NOTE_SIZE = { width: 220, height: 140 };

/**
 * Where a new note goes: in the middle of what the canvas shows, unless that would cover
 * a step or another note, and then just below everything, so nothing is hidden.
 */
export function notePlace(
  middle: XYPosition,
  taken: {
    position: XYPosition;
    width?: number;
    height?: number;
    measured?: Partial<Dimensions>;
  }[],
): XYPosition {
  const wanted = { x: middle.x - NOTE_SIZE.width / 2, y: middle.y - NOTE_SIZE.height / 2 };
  const boxes = taken.map((node) => ({
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? node.width ?? 160,
    height: node.measured?.height ?? node.height ?? 140,
  }));
  const covers = boxes.some(
    (box) =>
      wanted.x < box.x + box.width &&
      wanted.x + NOTE_SIZE.width > box.x &&
      wanted.y < box.y + box.height &&
      wanted.y + NOTE_SIZE.height > box.y,
  );
  if (!covers || boxes.length === 0) return wanted;
  return {
    x: Math.min(...boxes.map((box) => box.x)),
    y: Math.max(...boxes.map((box) => box.y + box.height)) + 40,
  };
}
