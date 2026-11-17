import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { act, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";
import { describe, expect, test, vi } from "vitest";

import { answerQuery, mutationOf } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { notePlace, useCanvasNotes } from "./canvas-notes";
import { type NoteFlowNode, noteFlowNode, noteNodeTypes } from "./note-node";

const AUTOMATION = "automation1" as Id<"automations">;
const NOTE = {
  _id: "note1" as Id<"automationNotes">,
  text: "Captions only run for clips under a minute.",
  x: 100,
  y: 50,
  width: 220,
  height: 140,
};

function showNote(selected: boolean, data: Partial<NoteFlowNode["data"]> = {}) {
  const Note = noteNodeTypes.note;
  const node = noteFlowNode(NOTE);
  const props = {
    id: node.id,
    type: "note",
    data: { ...node.data, ...data },
    selected,
    dragging: false,
    draggable: true,
    selectable: true,
    deletable: true,
    isConnectable: false,
    zIndex: -1,
    positionAbsoluteX: NOTE.x,
    positionAbsoluteY: NOTE.y,
  } as unknown as NodeProps<NoteFlowNode>;
  renderInApp(
    <ReactFlowProvider>
      <Note {...props} />
    </ReactFlowProvider>,
  );
}

describe("a note on the canvas", () => {
  test("shows what the team wrote, and saves new writing once typing pauses", async () => {
    vi.useFakeTimers();
    try {
      showNote(false);
      const box = screen.getByRole("textbox", { name: "Note" });
      expect((box as HTMLTextAreaElement).value).toBe(NOTE.text);
      fireEvent.focus(box);
      fireEvent.change(box, { target: { value: "Captions first." } });
      fireEvent.change(box, { target: { value: "Captions first, then clips." } });
      expect(mutationOf(api.notes.update)).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTime(700));
      expect(mutationOf(api.notes.update)).toHaveBeenCalledOnce();
      expect(mutationOf(api.notes.update)).toHaveBeenCalledWith({
        noteId: NOTE._id,
        text: "Captions first, then clips.",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("saves straight away when the person leaves it", () => {
    showNote(false);
    const box = screen.getByRole("textbox", { name: "Note" });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "Ask Sam before posting." } });
    fireEvent.blur(box);
    expect(mutationOf(api.notes.update)).toHaveBeenCalledWith({
      noteId: NOTE._id,
      text: "Ask Sam before posting.",
    });
  });

  test("can be removed once chosen", () => {
    showNote(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove note" }));
    expect(mutationOf(api.notes.remove)).toHaveBeenCalledWith({ noteId: NOTE._id });
  });

  test("offers no remove button until chosen", () => {
    showNote(false);
    expect(screen.queryByRole("button", { name: "Remove note" })).toBeNull();
  });

  test("can be shown to read only", () => {
    showNote(false, { readOnly: true });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(NOTE.text)).toBeTruthy();
  });
});

describe("the canvas's notes", () => {
  test("follow a drag at once and save where the note was put down", async () => {
    answerQuery(api.notes.list, [NOTE]);
    const { result } = renderHook(() => useCanvasNotes(AUTOMATION));
    const id = result.current.noteNodes[0].id;
    expect(result.current.noteNodes[0].position).toEqual({ x: 100, y: 50 });

    act(() =>
      result.current.onNoteChanges([
        { id, type: "position", position: { x: 400, y: 260 }, dragging: true },
      ]),
    );
    expect(result.current.noteNodes[0].position).toEqual({ x: 400, y: 260 });

    await act(async () => result.current.onNoteDragStop(id, { x: 400, y: 260 }));
    expect(mutationOf(api.notes.update)).toHaveBeenCalledWith({ noteId: NOTE._id, x: 400, y: 260 });
  });

  test("save a note's new size when resizing ends", async () => {
    answerQuery(api.notes.list, [NOTE]);
    const { result } = renderHook(() => useCanvasNotes(AUTOMATION));
    const id = result.current.noteNodes[0].id;
    act(() =>
      result.current.onNoteChanges([
        { id, type: "dimensions", resizing: true, dimensions: { width: 300, height: 200 } },
      ]),
    );
    expect(result.current.noteNodes[0]).toMatchObject({ width: 300, height: 200 });
    await act(async () =>
      result.current.onNoteChanges([
        { id, type: "dimensions", resizing: false, dimensions: { width: 300, height: 200 } },
      ]),
    );
    await waitFor(() =>
      expect(mutationOf(api.notes.update)).toHaveBeenCalledWith({
        noteId: NOTE._id,
        x: 100,
        y: 50,
        width: 300,
        height: 200,
      }),
    );
  });

  test("add a note where asked, and choose it to write in", async () => {
    answerQuery(api.notes.list, [NOTE]);
    mutationOf(api.notes.add).mockResolvedValue("note2");
    const { result, rerender } = renderHook(() => useCanvasNotes(AUTOMATION));
    await act(async () => result.current.addNote({ x: 10, y: 20 }));
    expect(mutationOf(api.notes.add)).toHaveBeenCalledWith({
      automationId: AUTOMATION,
      x: 10,
      y: 20,
    });

    answerQuery(api.notes.list, [NOTE, { ...NOTE, _id: "note2", text: "", x: 10, y: 20 }]);
    rerender();
    expect(result.current.noteNodes.map((node) => node.selected ?? false)).toEqual([false, true]);
  });

  test("remove the notes deleted on the canvas", async () => {
    answerQuery(api.notes.list, [NOTE]);
    const { result } = renderHook(() => useCanvasNotes(AUTOMATION));
    await act(async () => result.current.removeNotes([result.current.noteNodes[0].id]));
    expect(mutationOf(api.notes.remove)).toHaveBeenCalledWith({ noteId: NOTE._id });
  });
});

describe("where a new note goes", () => {
  const step = (x: number, y: number) => ({
    position: { x, y },
    measured: { width: 160, height: 140 },
  });

  test("in the middle of the canvas when that is free", () => {
    expect(notePlace({ x: 500, y: 300 }, [step(0, 0)])).toEqual({ x: 390, y: 230 });
  });

  test("clear of the words below a step", () => {
    expect(notePlace({ x: 80, y: 260 }, [step(0, 0)])).toEqual({ x: 0, y: 228 });
  });

  test("below everything when the middle would cover a step", () => {
    expect(notePlace({ x: 80, y: 70 }, [step(0, 0), step(300, 200)])).toEqual({ x: 0, y: 428 });
  });
});
