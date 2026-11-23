import { api } from "@convex/_generated/api";
import { statusOf } from "@convex/lib/storyboard";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { actionOf, answerQuery, mutationOf, toastError, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { StoryboardView, UploadStoryboard } from "./storyboard-view";

const PROJECT = "p1" as never;
const ITEM = "i1" as never;

/** An upload's draft: two chapters, each line with its own clip of the upload. */
function draft(overrides: Record<string, unknown> = {}) {
  const take = (number: number, line: string, start: number, end: number) => {
    const files = { you: `upload:u1#t=${start},${end}` };
    return {
      _id: `t${number}`,
      number,
      line,
      scene: "full" as const,
      parts: ["you" as const],
      files,
      status: statusOf(["you"], files),
    };
  };
  const needs = { you: 2, graphic: 0, recording: 0, screen: 0 };
  return {
    _id: "sb9",
    projectId: null,
    libraryItemId: "i1",
    aspect: "9:16",
    source: "Drafted from lesson.mp4",
    cuts: [],
    chapters: [
      {
        _id: "c1",
        title: "Welcome to the course",
        takes: [
          take(1, "Welcome to the course.", 0, 1.6),
          take(2, "So the first thing you do is open the folder.", 5.42, 9.57),
        ],
        needs,
        seconds: 5,
        ready: true,
      },
      {
        _id: "c2",
        title: "Step two is the upload",
        takes: [
          take(3, "Step two is the upload.", 14.92, 16.67),
          take(4, "It takes a minute.", 17.42, 18.97),
        ],
        needs,
        seconds: 4,
        ready: true,
      },
    ],
    takeCount: 4,
    seconds: 9,
    length: "about 9 s",
    totals: {
      you: { done: 4, all: 4 },
      graphic: { done: 0, all: 0 },
      recording: { done: 0, all: 0 },
      screen: { done: 0, all: 0 },
    },
    canDelete: true,
    updatedAt: 0,
    ...overrides,
  };
}

const DRAFTS = [
  { storyboardId: "sb9", libraryItemId: "i1", shortId: "V3", title: "lesson.mp4", duration: 30 },
  { storyboardId: "sb8", libraryItemId: "i2", shortId: "V2", title: "part two.mp4", duration: 60 },
];

describe("an upload's storyboard", () => {
  test("shows the draft's chapters, every line Full Screen with its clip already in", () => {
    answerQuery(api.storyboards.forUpload, draft());
    renderInApp(<UploadStoryboard libraryItemId={ITEM} transcribed />);
    expect(screen.getByText(/Drafted from lesson\.mp4/)).toBeTruthy();
    expect(screen.getByText(/2 chapters · 4 takes/)).toBeTruthy();
    const chapters = screen.getByRole("navigation", { name: "Chapters" });
    expect(chapters.textContent).toContain("Welcome to the course");
    expect(chapters.textContent).toContain("Step two is the upload");
    expect(screen.getByText("So the first thing you do is open the folder.")).toBeTruthy();
    expect(screen.getAllByText("Take in").length).toBeGreaterThan(0);
  });

  test("names a line's clip by where it is in the upload", async () => {
    answerQuery(api.storyboards.forUpload, draft());
    const user = userEvent.setup();
    renderInApp(<UploadStoryboard libraryItemId={ITEM} transcribed />);
    await user.click(screen.getByText("So the first thing you do is open the folder."));
    expect(await screen.findByText("From the upload, 0:05 to 0:09")).toBeTruthy();
  });

  test("can be drafted again from the transcript, after saying the changes go", async () => {
    answerQuery(api.storyboards.forUpload, draft());
    const user = userEvent.setup();
    renderInApp(<UploadStoryboard libraryItemId={ITEM} transcribed />);
    await user.click(screen.getByRole("button", { name: "Draft again" }));
    expect(screen.getByText("Your changes to it go.")).toBeTruthy();
    expect(mutationOf(api.storyboards.draftAgain)).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Draft again" }));
    expect(mutationOf(api.storyboards.draftAgain)).toHaveBeenCalledWith({ libraryItemId: ITEM });
  });

  test("says when it is still to come", () => {
    answerQuery(api.storyboards.forUpload, null);
    const { unmount } = renderInApp(<UploadStoryboard libraryItemId={ITEM} transcribed={false} />);
    expect(
      screen.getByText("The storyboard is drafted from what was said once the transcript is in."),
    ).toBeTruthy();
    unmount();
    renderInApp(<UploadStoryboard libraryItemId={ITEM} transcribed />);
    expect(screen.getByText("The storyboard is being drafted from what was said.")).toBeTruthy();
  });
});

describe("a project gathers uploads' drafts", () => {
  test("a project with no storyboard can start from an upload", async () => {
    answerQuery(api.storyboards.get, null);
    answerQuery(api.storyboards.uploadDrafts, DRAFTS);
    const user = userEvent.setup();
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    await user.click(screen.getByRole("button", { name: "Start from an upload" }));
    await user.click(await screen.findByRole("menuitem", { name: /lesson\.mp4/ }));
    expect(mutationOf(api.storyboards.gatherUploadDraft)).toHaveBeenCalledWith({
      projectId: PROJECT,
      libraryItemId: "i1",
    });
  });

  test("a storyboard adds more uploads' lines, and says when that fails", async () => {
    answerQuery(api.storyboards.get, draft({ projectId: "p1", libraryItemId: null }));
    answerQuery(api.storyboards.uploadDrafts, DRAFTS);
    mutationOf(api.storyboards.gatherUploadDraft).mockRejectedValueOnce(new Error("too many"));
    const user = userEvent.setup();
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    await user.click(screen.getByRole("button", { name: "Add an upload's lines" }));
    await user.click(await screen.findByRole("menuitem", { name: /part two\.mp4/ }));
    expect(mutationOf(api.storyboards.gatherUploadDraft)).toHaveBeenCalledWith({
      projectId: PROJECT,
      libraryItemId: "i2",
    });
    expect(toastError).toHaveBeenCalled();
  });

  test("offers no uploads while none has a draft", () => {
    answerQuery(api.storyboards.get, null);
    answerQuery(api.storyboards.uploadDrafts, []);
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    expect(screen.queryByRole("button", { name: "Start from an upload" })).toBeNull();
    expect(screen.getByRole("button", { name: "Start empty" })).toBeTruthy();
  });
});

describe("suggesting scenes", () => {
  test("asks the agent once when pressed and says what changed", async () => {
    answerQuery(api.storyboards.forUpload, draft());
    actionOf(api.storyboards.suggestScenes).mockResolvedValue({ scenes: 3, titles: 2 });
    const user = userEvent.setup();
    renderInApp(<UploadStoryboard libraryItemId={ITEM} transcribed />);
    expect(actionOf(api.storyboards.suggestScenes)).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Suggest scenes" }));
    expect(actionOf(api.storyboards.suggestScenes)).toHaveBeenCalledWith({ storyboardId: "sb9" });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("New scenes for 3 lines, 2 chapters renamed."),
    );
  });

  test("says so when the agent cannot suggest", async () => {
    answerQuery(api.storyboards.get, draft({ projectId: "p1", libraryItemId: null }));
    answerQuery(api.storyboards.uploadDrafts, []);
    actionOf(api.storyboards.suggestScenes).mockRejectedValueOnce(new Error("not set up"));
    const user = userEvent.setup();
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    await user.click(screen.getByRole("button", { name: "Suggest scenes" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});
