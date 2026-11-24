import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { actionOf, answerQuery } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { FileRuns, runLine } from "./file-runs";

const ITEM = "item1" as Id<"libraryItems">;

const run = (overrides: Record<string, unknown>) => ({
  _id: "run1",
  automationId: "auto1",
  automationName: "Podcast clips",
  status: "done",
  byHand: false,
  followed: false,
  startedAt: 1,
  finishedAt: 2,
  made: 3,
  ...overrides,
});

describe("automations on a file", () => {
  test("says how each run started and what it made", () => {
    expect(runLine({ byHand: false, followed: false, made: 0 })).toBe("Ran by itself");
    expect(runLine({ byHand: true, followed: false, made: 1 })).toBe("Run by hand · made 1 file");
    expect(runLine({ byHand: false, followed: true, made: 4 })).toBe(
      "Followed another · made 4 files",
    );
  });

  test("lists each run with its status, linking to it, then suggestions one press away", async () => {
    answerQuery(api.library.runsOnFile, {
      itemId: ITEM,
      runs: [
        run({}),
        run({ _id: "run2", automationName: "Captions", status: "running", made: 0 }),
        run({ _id: "run3", automationName: "Thumbnails", status: "failed", made: 0 }),
      ],
      suggested: [{ _id: "auto9", name: "Sermon pack" }],
    });
    renderInApp(<FileRuns itemId={ITEM} />);
    const ran = screen.getByRole("list", { name: "Ran on this file" });
    const rows = within(ran).getAllByRole("link");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Podcast clipsDoneRan by itself · made 3 files",
      "CaptionsRunningRan by itself",
      "ThumbnailsFailedRan by itself",
    ]);
    expect(rows[0].getAttribute("href")).toBe("/automations/auto1/runs/run1");
    expect(
      within(rows[2]).getByText("Failed").closest("[data-status]")?.getAttribute("data-status"),
    ).toBe("failed");
    fireEvent.click(screen.getByRole("button", { name: "Run Sermon pack on this file" }));
    await waitFor(() =>
      expect(actionOf(api.library.runAutomation)).toHaveBeenCalledWith({
        itemId: ITEM,
        automationId: "auto9",
      }),
    );
  });

  test("says so when nothing ran yet, and shows nothing for a file an automation made", () => {
    answerQuery(api.library.runsOnFile, { itemId: ITEM, runs: [], suggested: [] });
    const { unmount } = renderInApp(<FileRuns itemId={ITEM} />);
    expect(screen.getByText(/None yet/)).toBeTruthy();
    unmount();
    answerQuery(api.library.runsOnFile, null);
    renderInApp(<FileRuns itemId={ITEM} />);
    expect(screen.queryByRole("region", { name: "Automations on this file" })).toBeNull();
  });
});
