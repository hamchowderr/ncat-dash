import { describe, expect, it } from "vitest";
import { batchReport, changeText, duration, trendReport } from "../src/report";
import { result } from "./fixtures";

describe("duration", () => {
  it("says lengths plainly", () => {
    expect(duration(null)).toBe("not finished");
    expect(duration(44.6)).toBe("45 s");
    expect(duration(130)).toBe("2 min 10 s");
    expect(duration(180)).toBe("3 min");
    expect(duration(3900)).toBe("1 h 5 min");
    expect(duration(7200)).toBe("2 h");
  });
});

describe("changeText", () => {
  it("says how it compares", () => {
    expect(changeText({ verdict: "first", before: null, change: null, earlierRuns: 0 })).toBe(
      "first run",
    );
    expect(changeText({ verdict: "slower", before: 100, change: 0.5, earlierRuns: 3 })).toBe(
      "**50% slower** (before: 1 min 40 s)",
    );
    expect(changeText({ verdict: "faster", before: 100, change: -0.3, earlierRuns: 3 })).toBe(
      "30% faster (before: 1 min 40 s)",
    );
  });
});

describe("batchReport", () => {
  const earlier = [result({ at: "2026-11-01T10:00:00.000Z", batch: "old", seconds: 100 })];

  it("lists every run with its time, its slowest step and how it compares", () => {
    const report = batchReport(
      [
        result({ at: "2026-11-21T20:00:00.000Z", batch: "new", seconds: 200 }),
        result({
          at: "2026-11-21T20:10:00.000Z",
          batch: "new",
          readyMadeId: "vertical-blur-captions",
          readyMadeName: "Vertical with a blurred background, captioned",
          status: "waiting",
          seconds: 80,
        }),
        result({
          at: "2026-11-21T20:20:00.000Z",
          batch: "new",
          status: "failed",
          seconds: null,
          error: "toolkit down",
          steps: [],
        }),
      ],
      earlier,
    );
    expect(report).toContain("# Speed test, Sat, 21 Nov 2026 20:00 UTC");
    expect(report).toContain(
      "| Caption every new upload | 40 s vertical talking head | 3 min 20 s | 5.0x | Add captions (1 min 39 s) | **100% slower** (before: 1 min 40 s) |",
    );
    expect(report).toContain("1 min 20 s to approval");
    expect(report).toContain("**1 run is slower than before:**");
    expect(report).toContain(
      "**Didn't finish:** Caption every new upload on the 40 s vertical talking head (toolkit down).",
    );
    expect(report).toContain("- Add captions: 1 min 39 s (2 toolkit jobs)");
    expect(report).toContain("Toolkit build 219, 6 cores. Its CPU before each run: 2% to 2%.");
  });

  it("says when nothing ran, and when the toolkit wasn't asked", () => {
    expect(batchReport([], [])).toContain("Nothing ran.");
    expect(batchReport([result({ toolkit: null })], [])).toContain("wasn't read");
  });
});

describe("trendReport", () => {
  it("puts each pair's time in a column per batch", () => {
    const history = [
      result({ at: "2026-11-01T10:00:00.000Z", batch: "a", seconds: 100 }),
      result({ at: "2026-11-02T10:00:00.000Z", batch: "b", seconds: 90 }),
      result({
        at: "2026-11-02T10:05:00.000Z",
        batch: "b",
        readyMadeId: "social-clips",
        readyMadeName: "Clips for social",
        seconds: 300,
      }),
    ];
    const report = trendReport(history);
    expect(report).toContain("| Ready-made, video | 2026-11-01 10:00 | 2026-11-02 10:00 |");
    expect(report).toContain(
      "| Caption every new upload, 40 s vertical talking head | 1 min 40 s | 1 min 30 s |",
    );
    expect(report).toContain("| Clips for social, 40 s vertical talking head |  | 5 min |");
    expect(trendReport([])).toContain("No runs yet.");
  });
});
