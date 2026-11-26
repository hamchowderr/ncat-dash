import { DuckDBStore } from "@mastra/duckdb";
import { MastraStorageExporter } from "@mastra/observability";
import { PosthogExporter } from "@mastra/posthog";
import type { Duration, RetentionConfig } from "@mastra/core/storage";

/**
 * Where the agent's traces, logs and metrics live, and how long they stay.
 *
 * Studio's Traces, Logs and Metrics read the observability domain, which runs on DuckDB.
 * Left to itself DuckDB writes `mastra.duckdb` in the working directory: `/app` in the
 * image, which is NOT the `/data` volume, so every redeploy used to throw the traces away
 * and nothing ever trimmed them. The path and the age limit are settings now
 * (OBSERVABILITY_DB_PATH, TRACE_RETENTION), and the image points the file at /data.
 */

/** The observability tables Mastra's DuckDB adapter can trim by age. */
export const OBSERVABILITY_TABLES = ["spans", "logs", "metrics", "scores", "feedback"] as const;

/** Keep every observability table for `maxAge`; older rows go on the next prune. */
export function observabilityRetention(maxAge: Duration): RetentionConfig {
  const policy = { maxAge };
  return {
    observability: Object.fromEntries(OBSERVABILITY_TABLES.map((table) => [table, policy])),
  } as RetentionConfig;
}

export function createObservabilityStore(options: { path: string; retention: Duration }) {
  return new DuckDBStore({
    id: "observability",
    path: options.path,
    retention: observabilityRetention(options.retention),
  });
}

type Logger = {
  info: (message: string, data?: object) => void;
  warn: (message: string, data?: object) => void;
};

/** How often old traces and logs are trimmed. Hourly keeps each prune small. */
export const PRUNE_EVERY_MS = 60 * 60 * 1000;

/**
 * How long after start the first trim waits. Mastra makes the tables as the server starts,
 * and a trim before that failed on a fresh file ("Table with name span_events does not
 * exist"). Making the tables from here instead raced Mastra's own setup and crashed the
 * server with a DuckDB write-write conflict, so the first trim just waits.
 */
export const PRUNE_FIRST_AFTER_MS = 60 * 1000;

/**
 * Trim old observability rows `firstAfterMs` after start and then every `everyMs`. The
 * timers never hold the process open, and a failed prune is logged and tried again on the
 * next tick. Returns a function that stops the timers.
 */
export function startObservabilityPruning(
  store: Pick<DuckDBStore, "prune">,
  logger: Logger,
  everyMs = PRUNE_EVERY_MS,
  firstAfterMs = PRUNE_FIRST_AFTER_MS,
): () => void {
  const prune = async () => {
    try {
      const results = await store.prune({ pauseMs: 50 });
      const deleted = results.reduce((sum, r) => sum + r.deleted, 0);
      if (deleted > 0) logger.info("Old traces and logs trimmed", { deleted });
    } catch (error) {
      logger.warn("Trimming old traces and logs failed; trying again next hour", { error });
    }
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  const first = setTimeout(() => {
    void prune();
    timer = setInterval(prune, everyMs);
    timer.unref?.();
  }, firstAfterMs);
  first.unref?.();
  return () => {
    clearTimeout(first);
    if (timer) clearInterval(timer);
  };
}

/**
 * Where agent runs are sent. Always the agent's own store (Studio's Traces). With a
 * PostHog project token in POSTHOG_API_KEY, every run also goes to PostHog's AI view
 * (model, tokens, cost, the tool calls), so runs stay readable after the 14 days here.
 */
export function observabilityExporters(settings: {
  POSTHOG_API_KEY?: string;
  POSTHOG_HOST?: string;
}) {
  const exporters: (MastraStorageExporter | PosthogExporter)[] = [new MastraStorageExporter()];
  if (settings.POSTHOG_API_KEY) {
    exporters.push(
      new PosthogExporter({ apiKey: settings.POSTHOG_API_KEY, host: settings.POSTHOG_HOST }),
    );
  }
  return exporters;
}
