import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendResult, compare, parseHistory, readHistory } from "../src/history";
import { result } from "./fixtures";

const at = (day: number) => `2026-11-${String(day).padStart(2, "0")}T10:00:00.000Z`;

describe("history file", () => {
  it("keeps one result per line and reads them back oldest first", async () => {
    const dir = await mkdtemp(join(tmpdir(), "speed-"));
    const path = join(dir, "deep", "history.jsonl");
    expect(await readHistory(path)).toEqual([]);
    await appendResult(path, result({ at: at(5), runId: "late" }));
    await appendResult(path, result({ at: at(2), runId: "early" }));
    expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(2);
    expect((await readHistory(path)).map((r) => r.runId)).toEqual(["early", "late"]);
  });

  it("skips a line cut short or not a result", async () => {
    const dir = await mkdtemp(join(tmpdir(), "speed-"));
    const path = join(dir, "history.jsonl");
    await writeFile(path, `${JSON.stringify(result({ runId: "ok" }))}\n{"at":"2026\n[1,2]\n\n`);
    expect((await readHistory(path)).map((r) => r.runId)).toEqual(["ok"]);
    expect(parseHistory("")).toEqual([]);
  });
});

describe("compare", () => {
  const earlier = [90, 100, 110, 400, 105, 95].map((seconds, i) =>
    result({ at: at(i + 1), seconds }),
  );

  it("compares with the middle of the last five finished runs of the same pair", () => {
    const comparison = compare(result({ at: at(20), seconds: 104 }), earlier);
    expect(comparison).toMatchObject({ verdict: "same", before: 105, earlierRuns: 5 });
  });

  it("calls it slower only past both a quarter and 15 seconds", () => {
    expect(compare(result({ at: at(20), seconds: 140 }), earlier).verdict).toBe("slower");
    const short = [10, 10, 10].map((seconds, i) => result({ at: at(i + 1), seconds }));
    // 60% slower, but only 6 seconds: ordinary wobble.
    expect(compare(result({ at: at(20), seconds: 16 }), short).verdict).toBe("same");
    expect(compare(result({ at: at(20), seconds: 60 }), earlier).verdict).toBe("faster");
  });

  it("ignores other videos, ready-mades, dashboards, failed runs and later runs", () => {
    const others = [
      result({ at: at(1), clipId: "interview-8min-wide", seconds: 10 }),
      result({ at: at(2), readyMadeId: "social-clips", seconds: 10 }),
      result({ at: at(3), dashboard: "https://other.example", seconds: 10 }),
      result({ at: at(4), status: "failed", seconds: 10 }),
      result({ at: at(25), seconds: 10 }),
    ];
    expect(compare(result({ at: at(20) }), others)).toMatchObject({
      verdict: "first",
      earlierRuns: 0,
    });
  });

  it("counts a run that reached its approval, and has nothing to say about one with no time", () => {
    const waited = [result({ at: at(1), status: "waiting", seconds: 50 })];
    expect(compare(result({ at: at(2), seconds: 51 }), waited).verdict).toBe("same");
    expect(compare(result({ at: at(2), status: "failed", seconds: null }), waited).verdict).toBe(
      "no-time",
    );
  });
});
