import { describe, expect, test } from "vitest";

import {
  type AutomationDraft,
  exportAutomation,
  MAX_CANVAS_NOTES,
  readAutomationFile,
} from "../src";

const DRAFT: AutomationDraft = {
  name: "Clips for the week",
  trigger: { kind: "webhook" },
  nodes: [],
  edges: [],
};
const NOTE = { text: "Captions first.", x: 10, y: 20, width: 220, height: 140 };

describe("sticky notes in an automation file", () => {
  test("go out with the automation and come back in", () => {
    const { file } = exportAutomation(DRAFT, [NOTE]);
    expect(file.notes).toEqual([NOTE]);
    const read = readAutomationFile(JSON.parse(JSON.stringify(file)));
    expect(read.ok && read.canvasNotes).toEqual([NOTE]);
    expect(read.ok && read.notes).toEqual([]);
  });

  test("are left out of a file when there are none, and a file without them reads", () => {
    const { file } = exportAutomation(DRAFT);
    expect("notes" in file).toBe(false);
    const read = readAutomationFile(file);
    expect(read.ok && read.canvasNotes).toEqual([]);
  });

  test("are cleaned on the way in: sizes kept in range, long text cut, broken ones left out", () => {
    const { file } = exportAutomation(DRAFT);
    const read = readAutomationFile({
      ...file,
      notes: [
        { text: "x".repeat(5000), x: 1.4, y: 2.6, width: 5, height: 9000 },
        { text: "No place" },
        "not a note",
      ],
    });
    if (!read.ok) throw new Error(read.message);
    expect(read.canvasNotes).toEqual([
      { text: "x".repeat(2000), x: 1, y: 3, width: 120, height: 800 },
    ]);
    expect(read.notes).toEqual(["Left out 2 notes on the canvas that could not be read."]);
  });

  test(`stop at ${MAX_CANVAS_NOTES}`, () => {
    const { file } = exportAutomation(DRAFT);
    const read = readAutomationFile({ ...file, notes: Array(MAX_CANVAS_NOTES + 2).fill(NOTE) });
    expect(read.ok && read.canvasNotes).toHaveLength(MAX_CANVAS_NOTES);
  });
});
