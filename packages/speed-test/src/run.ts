import type { SpeedResult, ToolkitState } from "./history";
import type { Backend } from "./kontifi";
import { automationName, type PlanItem, timeLimitMs } from "./plan";
import { isSettled, timeRun } from "./timings";

export interface RunOptions {
  backend: Backend;
  plan: PlanItem[];
  /** Where the dashboard runs, kept with each result. */
  dashboard: string;
  batch?: string;
  note?: string;
  /** Called with each result as soon as its run has settled, to save it at once. */
  onResult?: (result: SpeedResult) => Promise<void> | void;
  log?: (line: string) => void;
  /** How often to look at a running run. */
  pollMs?: number;
  /**
   * The toolkit counts as busy above this CPU, or while it works on any job. The test
   * waits for it to be quiet before each run, so it neither piles work on the shared
   * server nor times a run that queued behind someone else's.
   */
  busyCpuPercent?: number;
  /** How long to wait for a quiet toolkit before running anyway (and saying so). */
  quietWaitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isBusy = (state: ToolkitState | null, cpu: number) =>
  state !== null && (state.cpuPercent > cpu || state.jobsRunning > 0);

/**
 * Runs every item of the plan, one after another, and times each from what the dashboard
 * recorded. Never two at once: on a shared server that would slow both down and the
 * numbers would mean nothing.
 */
export async function runSpeedTest(options: RunOptions): Promise<SpeedResult[]> {
  const {
    backend,
    plan,
    log = () => {},
    pollMs = 10_000,
    busyCpuPercent = 50,
    quietWaitMs = 10 * 60_000,
    now = Date.now,
    sleep = realSleep,
  } = options;
  const batch = options.batch ?? new Date(now()).toISOString();
  const results: SpeedResult[] = [];
  const automations = new Map<string, string>();
  for (const [index, item] of plan.entries()) {
    const label = `${index + 1}/${plan.length} ${item.readyMadeName} on the ${item.clip.name}`;
    let automationId = automations.get(item.readyMadeId);
    const at = () => new Date(now()).toISOString();
    // A run that can't start (the copy doesn't have that ready-made yet, say) is recorded
    // as failed, and the rest still run.
    const couldNotStart = async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const reason = /"message":"([^"]+)"/.exec(message)?.[1] ?? message.split("\n")[0];
      const result: SpeedResult = {
        at: at(),
        batch,
        clipId: item.clip.id,
        clipName: item.clip.name,
        clipSeconds: item.clip.seconds,
        readyMadeId: item.readyMadeId,
        readyMadeName: item.readyMadeName,
        status: "failed",
        seconds: null,
        firstStepAfter: null,
        steps: [],
        retries: 0,
        error: `couldn't start: ${reason}`,
        toolkit: null,
        runId: "",
        dashboard: options.dashboard,
        ...(options.note ? { note: options.note } : {}),
      };
      results.push(result);
      await options.onResult?.(result);
      log(`${label}: couldn't start (${reason})`);
    };
    if (!automationId) {
      try {
        automationId = await backend.automationFor(
          item.readyMadeId,
          automationName(item.readyMadeName),
        );
      } catch (error) {
        await couldNotStart(error);
        continue;
      }
      automations.set(item.readyMadeId, automationId);
    }

    let toolkit = await backend.toolkit();
    const quietBy = now() + quietWaitMs;
    while (isBusy(toolkit, busyCpuPercent) && now() < quietBy) {
      log(
        `${label}: the toolkit is busy (CPU ${toolkit!.cpuPercent}%, ${toolkit!.jobsRunning} jobs), waiting`,
      );
      await sleep(30_000);
      toolkit = await backend.toolkit();
    }
    const busyNote = isBusy(toolkit, busyCpuPercent)
      ? "The toolkit was still busy when this run started, so it is slower than it should be."
      : undefined;

    const startedAt = at();
    let runId: string;
    try {
      runId = await backend.start(automationId, item.clip.url);
    } catch (error) {
      await couldNotStart(error);
      continue;
    }
    log(`${label}: started`);
    const giveUpAt = now() + timeLimitMs(item.clip);
    let view = await backend.run(runId);
    let tooSlow = false;
    while (!view || !isSettled(view)) {
      if (now() > giveUpAt) {
        tooSlow = true;
        await backend.cancel(runId);
        view = await backend.run(runId);
        break;
      }
      await sleep(pollMs);
      view = await backend.run(runId);
    }
    const time = view ? timeRun(view) : null;
    const result: SpeedResult = {
      at: startedAt,
      batch,
      clipId: item.clip.id,
      clipName: item.clip.name,
      clipSeconds: item.clip.seconds,
      readyMadeId: item.readyMadeId,
      readyMadeName: item.readyMadeName,
      status: tooSlow
        ? "too-slow"
        : ((time?.status === "running" ? "cancelled" : time?.status) ?? "failed"),
      seconds: tooSlow
        ? Math.round((now() - Date.parse(startedAt)) / 1000)
        : (time?.seconds ?? null),
      firstStepAfter: time?.firstStepAfter ?? null,
      steps: time?.steps ?? [],
      retries: time?.retries ?? 0,
      error: tooSlow
        ? "stopped at the time limit"
        : (time?.error ?? (view ? null : "the run went missing")),
      toolkit,
      runId,
      dashboard: options.dashboard,
      ...(options.note || busyNote
        ? { note: [options.note, busyNote].filter(Boolean).join(" ") }
        : {}),
    };
    results.push(result);
    await options.onResult?.(result);
    log(`${label}: ${result.status}${result.seconds !== null ? ` in ${result.seconds} s` : ""}`);
  }
  return results;
}
