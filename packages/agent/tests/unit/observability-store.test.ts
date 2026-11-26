import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createObservabilityStore,
  OBSERVABILITY_TABLES,
  observabilityExporters,
  observabilityRetention,
  startObservabilityPruning,
} from "../../src/mastra/lib/observability-store";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "observability-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("observability store", () => {
  it("keeps every observability table for the same age", () => {
    expect(observabilityRetention("14d")).toEqual({
      observability: Object.fromEntries(OBSERVABILITY_TABLES.map((t) => [t, { maxAge: "14d" }])),
    });
  });

  it("writes to the path it is given, not the working directory", async () => {
    const file = path.join(tempDir(), "observability.duckdb");
    const store = createObservabilityStore({ path: file, retention: "14d" });
    const obs = await store.getStore("observability");
    await obs?.init();
    expect(existsSync(file)).toBe(true);
    await store.close?.();
  });

  it("trims logs older than the retention age and keeps newer ones", async () => {
    const file = path.join(tempDir(), "observability.duckdb");
    const store = createObservabilityStore({ path: file, retention: "1d" });
    const obs = await store.getStore("observability");
    if (!obs) throw new Error("no observability store");
    await obs.init();
    const now = Date.now();
    await obs.batchCreateLogs({
      logs: [
        {
          logId: "old",
          timestamp: new Date(now - 3 * 86_400_000),
          level: "warn",
          message: "old log",
        },
        { logId: "new", timestamp: new Date(now - 60_000), level: "warn", message: "new log" },
      ],
    });

    const results = await store.prune();
    const logs = results.find((r) => r.table === "log_events");
    expect(logs?.deleted).toBe(1);

    const kept = await obs.listLogs({});
    expect(kept.logs.map((l) => l.message)).toEqual(["new log"]);
    await store.close?.();
  });
});

describe("startObservabilityPruning", () => {
  it("prunes at once and then on every tick, and stops when asked", async () => {
    vi.useFakeTimers();
    try {
      const prune = vi
        .fn()
        .mockResolvedValue([
          { domain: "observability", table: "span_events", deleted: 2, done: true },
        ]);
      const logger = { info: vi.fn(), warn: vi.fn() };
      const stop = startObservabilityPruning({ prune }, logger, 1000);
      await vi.advanceTimersByTimeAsync(0);
      expect(prune).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith("Old traces and logs trimmed", { deleted: 2 });
      await vi.advanceTimersByTimeAsync(2000);
      expect(prune).toHaveBeenCalledTimes(3);
      stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(prune).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs a failed prune and keeps going", async () => {
    vi.useFakeTimers();
    try {
      const prune = vi.fn().mockRejectedValueOnce(new Error("locked")).mockResolvedValue([]);
      const logger = { info: vi.fn(), warn: vi.fn() };
      const stop = startObservabilityPruning({ prune }, logger, 1000);
      await vi.advanceTimersByTimeAsync(0);
      expect(logger.warn).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1000);
      expect(prune).toHaveBeenCalledTimes(2);
      expect(logger.info).not.toHaveBeenCalled();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("agent image", () => {
  it("keeps the observability file on the /data volume", () => {
    const dockerfile = readFileSync(path.resolve(__dirname, "../../Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/OBSERVABILITY_DB_PATH=\/data\/observability\.duckdb/);
    expect(dockerfile).toMatch(/VOLUME \/data/);
  });
});

describe("observabilityExporters", () => {
  it("keeps runs in the agent store only, with no PostHog token", () => {
    expect(observabilityExporters({}).map((e) => e.name)).toEqual(["mastra-storage-exporter"]);
  });

  it("also sends runs to PostHog when a project token is set", () => {
    const names = observabilityExporters({
      POSTHOG_API_KEY: "phc_test",
      POSTHOG_HOST: "https://us.i.posthog.com",
    }).map((e) => e.name);
    expect(names).toEqual(["mastra-storage-exporter", "posthog"]);
  });
});
