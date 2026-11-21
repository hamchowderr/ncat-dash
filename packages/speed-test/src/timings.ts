import { type AutomationNode, nodeTypeOf } from "@ncat-dash/automation-core";

/** The part of a run, as the dashboard's runs.get gives it, that the speed test reads. */
export interface RunView {
  status: "running" | "waiting" | "done" | "failed" | "cancelled";
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  retries: number;
  nodes: Pick<AutomationNode, "id" | "kind" | "stepId" | "label">[];
  steps: {
    nodeId: string;
    status: string;
    startedAt: number | null;
    finishedAt: number | null;
    retries: number;
    error?: string | null;
    jobs: unknown[];
  }[];
}

export interface StepTime {
  nodeId: string;
  name: string;
  status: string;
  /** From the step starting to it ending. Null while it is still going. */
  seconds: number | null;
  /** How many toolkit jobs it sent: one per file it worked on, per stage. */
  jobs: number;
  retries: number;
}

export interface RunTime {
  /** "waiting": the run reached an approval, which is where the work ends. */
  status: RunView["status"];
  /** From the run starting to its last step ending. Null while it is still going. */
  seconds: number | null;
  /** From the run starting to its first step starting. */
  firstStepAfter: number | null;
  steps: StepTime[];
  retries: number;
  error: string | null;
}

const seconds = (from: number, to: number) => Math.round((to - from) / 100) / 10;

/** A step's name as the canvas shows it. */
function nameOf(node: RunView["nodes"][number] | undefined, nodeId: string): string {
  if (!node) return nodeId;
  return node.label ?? nodeTypeOf(node as AutomationNode)?.title ?? nodeId;
}

/** How long a run and each of its steps took, from what the dashboard recorded. */
export function timeRun(run: RunView): RunTime {
  const nodes = new Map(run.nodes.map((node) => [node.id, node]));
  const started = run.steps
    .filter((step) => step.startedAt !== null)
    .sort((a, b) => a.startedAt! - b.startedAt!);
  const steps: StepTime[] = started
    // An approval is a person's time, not the machine's.
    .filter((step) => nodes.get(step.nodeId)?.kind !== "approval")
    .map((step) => ({
      nodeId: step.nodeId,
      name: nameOf(nodes.get(step.nodeId), step.nodeId),
      status: step.status,
      seconds: step.finishedAt === null ? null : seconds(step.startedAt!, step.finishedAt),
      jobs: step.jobs.length,
      retries: step.retries,
    }));
  const lastEnd = Math.max(
    ...started
      .filter((step) => nodes.get(step.nodeId)?.kind !== "approval")
      .map((step) => step.finishedAt ?? 0),
    0,
  );
  const end =
    run.status === "waiting"
      ? lastEnd || null
      : run.status === "running"
        ? null
        : (run.finishedAt ?? (lastEnd || null));
  return {
    status: run.status,
    seconds: end === null ? null : seconds(run.startedAt, end),
    firstStepAfter: started[0] ? seconds(run.startedAt, started[0].startedAt!) : null,
    steps,
    retries: run.retries,
    error: run.error,
  };
}

/** Whether the run has got as far as it will without a person: ended, or at an approval. */
export function isSettled(run: RunView): boolean {
  if (run.status === "running") return false;
  if (run.status !== "waiting") return true;
  // A run waits at an approval, and also at a Wait step; only the approval is the end.
  const approvals = new Set(run.nodes.filter((n) => n.kind === "approval").map((n) => n.id));
  return run.steps.some((step) => approvals.has(step.nodeId) && step.status === "waiting_approval");
}
