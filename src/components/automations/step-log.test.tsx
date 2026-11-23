import { api } from "@convex/_generated/api";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { answerQuery } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { cameFrom, jobTiming, StepLog } from "./step-log";

const FILE = "https://files.example/in/episode-4.mp4";
const AT = Date.UTC(2026, 10, 22, 22, 14, 0);

const job = {
  _id: "j2",
  title: "Trim video",
  status: "done" as const,
  file: FILE,
  input: { video_url: FILE, start: "00:00:05", api_key: "hidden" },
  error: null,
  permanent: false,
  toolkitJobId: "tk-42",
  queuedAt: AT,
  sentAt: AT + 12_000,
  startedAt: AT + 12_000,
  finishedAt: AT + 53_000,
  outputs: [],
};

describe("a step's log on the run page", () => {
  test("opens to what each try sent, how long it took and how it ended", async () => {
    answerQuery(api.runs.stepLog, {
      tries: [{ at: AT, error: "The toolkit answered 503." }],
      jobs: [
        {
          ...job,
          _id: "j1",
          status: "failed",
          error: "The toolkit refused the start time.",
          permanent: true,
          toolkitJobId: null,
          finishedAt: AT + 13_000,
        },
        job,
      ],
      more: false,
      files: [],
    });
    const user = userEvent.setup();
    renderInApp(<StepLog runStepId={"s1" as never} title="Trim video" />);
    expect(screen.queryByRole("region", { name: "What Trim video sent" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show what was sent" }));
    const log = screen.getByRole("region", { name: "What Trim video sent" });
    // Each failed try, in plain words, with the toolkit's own words a click away.
    expect(within(log).getByRole("list", { name: "Tries that failed" })).toHaveTextContent(
      /^Try 1, .+: The toolkit ran into a problem of its own/,
    );
    const jobs = within(within(log).getByRole("list", { name: "Jobs" })).getAllByRole("listitem");
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toHaveTextContent("The toolkit refused it, so it was not tried again.");
    expect(jobs[1]).toHaveTextContent("Trim video · episode-4.mp4");
    expect(jobs[1]).toHaveTextContent("Toolkit job tk-42");
    expect(jobs[1]).toHaveTextContent('"start": "00:00:05"');
    expect(jobs[1]).toHaveTextContent('"api_key": "hidden"');
    await user.click(screen.getByRole("button", { name: "Hide what was sent" }));
    expect(screen.queryByRole("region", { name: "What Trim video sent" })).toBeNull();
  });

  test("lists the files a step handed on and where each came from", async () => {
    const CUT = "https://files.example/out/episode-4-trimmed.mp4";
    const BURNED = "https://files.example/out/episode-4-captioned.mp4";
    answerQuery(api.runs.stepLog, {
      tries: [],
      jobs: [job],
      more: false,
      files: [{ url: BURNED, from: CUT, source: FILE, kind: "video" }],
    });
    const user = userEvent.setup();
    renderInApp(<StepLog runStepId={"s1" as never} title="Caption video" />);
    await user.click(screen.getByRole("button", { name: "Show what was sent" }));
    expect(screen.getByRole("list", { name: "Files it handed on" })).toHaveTextContent(
      "episode-4-captioned.mp4 · made from episode-4-trimmed.mp4, which started as episode-4.mp4",
    );
  });

  test("says where a file came from in plain words", () => {
    const name = (url: string) => url.split("/").pop()!;
    expect(cameFrom({ url: FILE, from: null, source: FILE }, name)).toBe(
      "the file the run started with",
    );
    expect(cameFrom({ url: "https://x/a.mp4", from: FILE, source: FILE }, name)).toBe(
      "made from episode-4.mp4",
    );
    expect(cameFrom({ url: "https://x/a.mp4", from: null, source: null }, name)).toBe(
      "made from files that started in different places",
    );
  });

  test("says how long a job waited for a slot and how long the toolkit took", () => {
    expect(jobTiming(job)).toMatch(/^Waited 12s? for a free slot, 41s? on the toolkit$/);
    expect(jobTiming({ ...job, sentAt: null, startedAt: null, finishedAt: null })).toBe(
      "Waiting for a free slot",
    );
    expect(jobTiming({ ...job, sentAt: AT + 200 })).not.toMatch(/waited/i);
  });
});
