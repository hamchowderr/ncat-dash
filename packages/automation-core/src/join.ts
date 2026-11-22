import type { AutomationEdge, AutomationNode } from "./graph";

/**
 * How a step treats files when two or more lines meet at it.
 * - "all": waits for every line, then works on all their files (the default).
 * - "source": waits for every line; each file from the first line is paired with the file
 *   from the other lines that started from the same upload.
 * - "position": waits for every line; first file with first file, second with second.
 * - "first": starts as soon as one line finishes, with only that line's files.
 */
export type JoinMode = "all" | "source" | "position" | "first";

export const JOIN_MODES: { value: JoinMode; title: string; description: string }[] = [
  {
    value: "all",
    title: "Wait for all, then use every file",
    description: "Waits for every line, then works on all of their files.",
  },
  {
    value: "source",
    title: "Pair files from the same upload",
    description:
      "Waits for every line. Each file from the first line is paired with the file from the other line that started from the same upload.",
  },
  {
    value: "position",
    title: "Pair files in order",
    description:
      "Waits for every line. The first file from each line goes together, then the second, and so on.",
  },
  {
    value: "first",
    title: "Use whichever line finishes first",
    description:
      "Starts as soon as one line finishes, with only its files. Files from the slower lines are not used.",
  },
];

/** How a node treats files when lines meet at it. */
export function joinOf(node: AutomationNode): JoinMode {
  return node.join ?? "all";
}

/** Whether a node pairs files from the lines that meet at it. */
export function pairs(node: AutomationNode): boolean {
  const mode = joinOf(node);
  return mode === "source" || mode === "position";
}

/** How many lines meet at a node. */
export function linesInto(nodeId: string, edges: AutomationEdge[]): number {
  return new Set(edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source)).size;
}

type Traced = { url: string; source: string | null };

/**
 * The partner of each main file among `others`: the one that started from the same upload
 * ("source"), or the one in the same place ("position"). Null where there is none.
 */
export function partnersOf(
  mode: "source" | "position",
  main: Traced[],
  others: Traced[],
): (string | null)[] {
  if (mode === "position") return main.map((_, index) => others[index]?.url ?? null);
  return main.map((file) => {
    if (file.source === null) return null;
    return others.find((other) => other.source === file.source)?.url ?? null;
  });
}
