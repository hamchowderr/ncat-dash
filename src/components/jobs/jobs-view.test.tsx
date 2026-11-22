import { api } from "@convex/_generated/api";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { answerQuery } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { JobsView } from "./jobs-view";

const NOW = Date.now();

function job(id: string, over: Record<string, unknown> = {}) {
  return {
    _id: id,
    _creationTime: NOW - 5 * 60_000,
    stepId: "video.thumbnail",
    status: "done",
    input: { video_url: "https://example.test/a.mp4" },
    outputs: [{ url: "https://example.test/a.jpg" }, { url: "https://example.test/b.jpg" }],
    startedAt: NOW - 5 * 60_000,
    finishedAt: NOW - 5 * 60_000 + 12_000,
    ...over,
  };
}

describe("the Jobs page", () => {
  test("lists each job as a row with when it started, how long it took and what it made", () => {
    answerQuery(api.jobs.list, [job("j1"), job("j2", { status: "failed", outputs: [] })]);
    renderInApp(<JobsView />);
    const first = document.querySelector("[data-job='j1']") as HTMLElement;
    expect(first).toHaveTextContent("Started 5 minutes ago");
    expect(first).toHaveTextContent("Took 12s");
    expect(within(first).getByTitle("2 files made")).toBeInTheDocument();
    expect(within(first).getByText("Done")).toBeInTheDocument();
    const second = document.querySelector("[data-job='j2']") as HTMLElement;
    expect(within(second).getByText("Failed")).toBeInTheDocument();
    expect(within(second).queryByTitle(/files? made/)).not.toBeInTheDocument();
    expect(within(first).getByRole("button", { name: /More for the .* job/ })).toBeInTheDocument();
  });

  test("a job's name opens its details", () => {
    answerQuery(api.jobs.list, [job("j1")]);
    answerQuery(api.jobs.get, null);
    renderInApp(<JobsView />);
    fireEvent.click(screen.getByRole("button", { name: /job, started/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Run this step again");
  });

  test("nothing run yet points to the steps", () => {
    answerQuery(api.jobs.list, []);
    renderInApp(<JobsView />);
    expect(screen.getByRole("link", { name: "Browse steps" })).toHaveAttribute("href", "/steps");
  });
});
