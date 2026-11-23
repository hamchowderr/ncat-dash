import type { StepsOnClipboard } from "@takewon/automation-core";
import { readStored, writeStored } from "@/lib/stored";

const KEY = "copied-steps";

// Kept here too, for when the browser will not store it.
let held: StepsOnClipboard | null = null;

/**
 * Steps copied on one canvas, ready to paste on any other the person opens. Kept in the
 * browser, not the system clipboard, so pasting needs no permission prompt.
 */
export function copiedSteps(): StepsOnClipboard | null {
  try {
    const stored = readStored(KEY);
    if (stored) return JSON.parse(stored) as StepsOnClipboard;
  } catch {
    // Storage is blocked or the value is not ours; use what this page holds.
  }
  return held;
}

export function holdSteps(steps: StepsOnClipboard): void {
  held = steps;
  try {
    writeStored(KEY, JSON.stringify(steps));
  } catch {
    // Pasting still works on this page.
  }
}
