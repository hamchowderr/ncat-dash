import { api } from "@convex/_generated/api";
import { readScript, statusOf, type Part, type Scene } from "@convex/lib/storyboard";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { LESSON_STORYBOARD } from "../../../e2e/fixtures/lesson-storyboard";
import {
  actionOf,
  answerQuery,
  mutationOf,
  place,
  replaced,
  toastError,
  toastSuccess,
} from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { ProjectView } from "@/components/projects/project-view";
import { StoryboardView } from "./storyboard-view";

const PROJECT = "p1" as never;

/** The storyboard query's answer for a script, with the files given by take number. */
function boardFor(text: string, files: Record<number, Partial<Record<Part, string>>> = {}) {
  let number = 0;
  const totals = Object.fromEntries(
    ["you", "graphic", "recording", "screen"].map((part) => [part, { done: 0, all: 0 }]),
  ) as Record<Part, { done: number; all: number }>;
  const chapters = readScript(text).chapters.map((chapter, index) => {
    const takes = chapter.takes.map((take) => {
      number += 1;
      const has = files[number] ?? {};
      for (const part of take.parts) {
        totals[part].all += 1;
        if (has[part]) totals[part].done += 1;
      }
      return {
        _id: `t${number}`,
        number,
        line: take.line,
        scene: take.scene as Scene,
        parts: take.parts,
        files: has,
        status: statusOf(take.parts, has),
      };
    });
    return {
      _id: `c${index + 1}`,
      title: chapter.title,
      takes,
      needs: Object.fromEntries(
        (["you", "graphic", "recording", "screen"] as Part[]).map((part) => [
          part,
          takes.filter((take) => take.parts.includes(part)).length,
        ]),
      ),
      seconds: 30,
      ready: takes.length > 0 && takes.every((take) => take.status.tone === "done"),
    };
  });
  return {
    _id: "sb1",
    organizationId: TEAM.id,
    projectId: "p1",
    libraryItemId: null,
    aspect: "16:9",
    source: "From the page AI-Assisted Development, Part 1",
    cuts: [{ what: "Full lesson", where: "YouTube · 16:9 · about 16 min" }],
    chapters,
    takeCount: number,
    seconds: 960,
    length: "about 16 min",
    totals,
    canDelete: true,
    updatedAt: 0,
  };
}

afterEach(() => vi.useRealTimers());

describe("before a project has a storyboard", () => {
  test("a pasted script is counted as it is typed and makes the storyboard", async () => {
    answerQuery(api.storyboards.get, null);
    const user = userEvent.setup();
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    expect(screen.getByText("Plan the video line by line")).toBeTruthy();
    const make = screen.getByRole("button", { name: "Make the storyboard" });
    expect(make).toHaveProperty("disabled", true);
    const box = screen.getByRole("textbox", { name: "Script" });
    await user.click(box);
    await user.paste(LESSON_STORYBOARD);
    expect(screen.getByText(/15 chapters · 59 takes · about \d+ min/)).toBeTruthy();
    await user.click(make);
    expect(mutationOf(api.storyboards.create)).toHaveBeenCalledWith({
      projectId: PROJECT,
      script: LESSON_STORYBOARD,
    });
  });

  test("can start empty, and says so when it fails", async () => {
    answerQuery(api.storyboards.get, null);
    mutationOf(api.storyboards.create).mockRejectedValueOnce(new Error("nope"));
    const user = userEvent.setup();
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    await user.click(screen.getByRole("button", { name: "Start empty" }));
    expect(mutationOf(api.storyboards.create)).toHaveBeenCalledWith({ projectId: PROJECT });
    expect(toastError).toHaveBeenCalled();
  });
});

describe("a storyboard", () => {
  test("shows the chapters, the first chapter's takes and how far along each part is", () => {
    answerQuery(
      api.storyboards.get,
      boardFor(LESSON_STORYBOARD, { 1: { you: "https://f/a.mp4" } }),
    );
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    expect(screen.getByText(/15 chapters · 59 takes · about 16 min/)).toBeTruthy();
    const chapters = screen.getByRole("navigation", { name: "Chapters" });
    expect(within(chapters).getAllByRole("listitem")).toHaveLength(15);
    const progress = screen.getByRole("list", { name: "Progress" });
    expect(progress.textContent).toContain("Takes from you1 of 59");
    const takes = screen.getByRole("list", { name: "Takes" });
    const rows = within(takes).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Take 1");
    expect(rows[0].textContent).toContain("Take in");
    expect(rows[1].textContent).toContain("Waiting for your take");
    expect(within(rows[1]).getByRole("img", { name: "Panel layout" })).toBeTruthy();
    const preview = screen.getByRole("complementary", { name: "Preview" });
    expect(preview.textContent).toContain("1 of 2 takes have a file");
    expect(within(preview).getByText("Full lesson")).toBeTruthy();
  });

  test("picking a chapter shows its takes, with what only you can make named first", async () => {
    answerQuery(api.storyboards.get, boardFor(LESSON_STORYBOARD));
    const user = userEvent.setup();
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    await user.click(screen.getByRole("button", { name: /A thread for every job/ }));
    expect(
      screen.getByRole("button", { name: /A thread for every job/ }).getAttribute("aria-current"),
    ).toBe("true");
    const takes = screen.getByRole("list", { name: "Takes" });
    const ten = within(takes)
      .getAllByRole("listitem")
      .find((row) => row.getAttribute("data-take") === "10")!;
    expect(ten.textContent).toContain("Needs your screen");
    expect(ten.textContent).toContain("Your screen");
  });

  test("a take opens in place to change its line, scene and parts, and to link its file", async () => {
    answerQuery(api.storyboards.get, boardFor(LESSON_STORYBOARD));
    const user = userEvent.setup();
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    const first = screen
      .getAllByRole("listitem")
      .find((row) => row.getAttribute("data-take") === "1")!;
    await user.click(within(first).getByRole("button", { name: /Take 1/ }));

    const line = within(first).getByRole("textbox", { name: "What is said" });
    await user.clear(line);
    await user.type(line, "A shorter first line.");
    await user.tab();
    expect(mutationOf(api.storyboards.updateTake)).toHaveBeenCalledWith({
      takeId: "t1",
      line: "A shorter first line.",
    });

    await user.click(within(first).getByRole("button", { name: "Graphic" }));
    expect(mutationOf(api.storyboards.updateTake)).toHaveBeenLastCalledWith({
      takeId: "t1",
      parts: ["you", "graphic"],
    });

    await user.click(within(first).getByRole("button", { name: "Link" }));
    await user.type(
      within(first).getByRole("textbox", { name: "You file link" }),
      "https://f/take-1.mp4",
    );
    await user.click(within(first).getByRole("button", { name: "Add" }));
    expect(mutationOf(api.storyboards.setTakeFile)).toHaveBeenCalledWith({
      takeId: "t1",
      part: "you",
      url: "https://f/take-1.mp4",
    });

    await user.click(within(first).getByRole("button", { name: "Move down" }));
    expect(mutationOf(api.storyboards.moveTake)).toHaveBeenCalledWith({
      takeId: "t1",
      direction: "down",
    });
    // The very first take of the video cannot go further up.
    expect(within(first).getByRole("button", { name: "Move up" })).toHaveProperty("disabled", true);
  });

  test("a take with its file in can have it taken out again", async () => {
    answerQuery(
      api.storyboards.get,
      boardFor(LESSON_STORYBOARD, { 1: { you: "https://f/cold-open.mp4" } }),
    );
    const user = userEvent.setup();
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    const first = screen
      .getAllByRole("listitem")
      .find((row) => row.getAttribute("data-take") === "1")!;
    await user.click(within(first).getByRole("button", { name: /Take 1/ }));
    expect(within(first).getByText("cold-open.mp4")).toBeTruthy();
    await user.click(within(first).getByRole("button", { name: "Take out the you file" }));
    expect(mutationOf(api.storyboards.setTakeFile)).toHaveBeenCalledWith({
      takeId: "t1",
      part: "you",
      url: null,
    });
  });

  test("takes and chapters are added, and chapters renamed and moved", async () => {
    answerQuery(api.storyboards.get, boardFor(LESSON_STORYBOARD));
    const user = userEvent.setup();
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    await user.type(screen.getByRole("textbox", { name: "New take's line" }), "One more line.");
    await user.click(screen.getByRole("button", { name: "Add take" }));
    expect(mutationOf(api.storyboards.addTake)).toHaveBeenCalledWith({
      chapterId: "c1",
      line: "One more line.",
    });

    const name = screen.getByRole("textbox", { name: "Chapter name" });
    await user.clear(name);
    await user.type(name, "The cold open{Enter}");
    expect(mutationOf(api.storyboards.renameChapter)).toHaveBeenCalledWith({
      chapterId: "c1",
      title: "The cold open",
    });
    expect(screen.getByRole("button", { name: "Move chapter up" })).toHaveProperty(
      "disabled",
      true,
    );
    await user.click(screen.getByRole("button", { name: "Move chapter down" }));
    expect(mutationOf(api.storyboards.moveChapter)).toHaveBeenCalledWith({
      chapterId: "c1",
      direction: "down",
    });

    mutationOf(api.storyboards.addChapter).mockResolvedValueOnce("c16");
    await user.click(screen.getByRole("button", { name: "Add chapter" }));
    expect(mutationOf(api.storyboards.addChapter)).toHaveBeenCalledWith({ storyboardId: "sb1" });

    await user.click(screen.getByRole("button", { name: "Delete chapter" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(mutationOf(api.storyboards.removeChapter)).toHaveBeenCalledWith({ chapterId: "c1" });
  });

  test("cuts are added and taken off", async () => {
    answerQuery(api.storyboards.get, boardFor(LESSON_STORYBOARD));
    const user = userEvent.setup();
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    const cuts = screen.getByRole("region", { name: "Cuts from this storyboard" });
    await user.type(within(cuts).getByRole("textbox", { name: "Cut" }), "Short lessons");
    await user.type(within(cuts).getByRole("textbox", { name: "Where it goes" }), "YouTube · 16:9");
    await user.click(within(cuts).getByRole("button", { name: "Add" }));
    expect(mutationOf(api.storyboards.addCut)).toHaveBeenCalledWith({
      storyboardId: "sb1",
      what: "Short lessons",
      where: "YouTube · 16:9",
    });
    await user.click(within(cuts).getByRole("button", { name: "Take Full lesson off the list" }));
    expect(mutationOf(api.storyboards.removeCut)).toHaveBeenCalledWith({
      storyboardId: "sb1",
      index: 0,
    });
  });

  test("a next cut typed while one saves is kept, and a cut that fails comes back", async () => {
    answerQuery(api.storyboards.get, boardFor(LESSON_STORYBOARD));
    let save!: () => void;
    mutationOf(api.storyboards.addCut).mockImplementationOnce(
      () => new Promise<null>((resolve) => (save = () => resolve(null))),
    );
    const user = userEvent.setup();
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    const cuts = screen.getByRole("region", { name: "Cuts from this storyboard" });
    const what = within(cuts).getByRole("textbox", { name: "Cut" });
    await user.type(what, "Full lesson");
    await user.click(within(cuts).getByRole("button", { name: "Add" }));
    await user.type(what, "Short lessons");
    await act(async () => save());
    expect(what).toHaveValue("Short lessons");

    mutationOf(api.storyboards.addCut).mockRejectedValueOnce(new Error("offline"));
    await user.click(within(cuts).getByRole("button", { name: "Add" }));
    expect(what).toHaveValue("Short lessons");
    expect(toastError).toHaveBeenCalled();
  });

  test("the whole script can be edited as text and saved", async () => {
    answerQuery(api.storyboards.get, boardFor(LESSON_STORYBOARD));
    answerQuery(api.storyboards.script, "## Cold open\n[Full Screen · You] First line.");
    mutationOf(api.storyboards.writeFromScript).mockResolvedValueOnce({ chapters: 1, takes: 2 });
    const user = userEvent.setup();
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    await user.click(screen.getByRole("radio", { name: "Script" }));
    const box = screen.getByRole("textbox", { name: "Script" });
    expect((box as HTMLTextAreaElement).value).toContain("[Full Screen · You] First line.");
    expect(screen.getByRole("button", { name: "Save script" })).toHaveProperty("disabled", true);
    await user.type(box, "\nA second line.");
    expect(screen.getByText(/1 chapter · 2 takes/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save script" }));
    expect(mutationOf(api.storyboards.writeFromScript)).toHaveBeenCalledWith({
      storyboardId: "sb1",
      script: "## Cold open\n[Full Screen · You] First line.\nA second line.",
    });
  });

  test("the preview plays the chapter through, showing a card for a take with no file", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    answerQuery(api.storyboards.get, boardFor(LESSON_STORYBOARD));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    const preview = screen.getByRole("complementary", { name: "Preview" });
    expect(within(preview).getByTestId("take-card").textContent).toContain(
      "never known how to code",
    );
    await user.click(within(preview).getByRole("button", { name: "Play chapter" }));
    expect(within(preview).getByText("Take 1 · 1 of 2")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(within(preview).getByText("Take 2 · 2 of 2")).toBeTruthy();
    expect(within(preview).getByTestId("take-card").textContent).toContain(
      "This is how the work is set up",
    );
  });

  test("the shape can be changed", async () => {
    answerQuery(api.storyboards.get, boardFor(LESSON_STORYBOARD));
    const user = userEvent.setup();
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    await user.click(screen.getByRole("combobox", { name: "Shape" }));
    await user.click(await screen.findByRole("option", { name: "9:16" }));
    expect(mutationOf(api.storyboards.setDetails)).toHaveBeenCalledWith({
      storyboardId: "sb1",
      aspect: "9:16",
    });
  });
});

describe("the project page", () => {
  const project = {
    _id: "p1",
    organizationId: TEAM.id,
    name: "Part 1: AnyPress",
    package: "Start empty",
    client: null,
    review: null,
    createdAt: 0,
    updatedAt: 0,
    canDelete: true,
    total: 0,
    filled: 0,
    counts: { todo: 0, in_progress: 0, review: 0, approved: 0, published: 0 },
    slots: [],
  };

  test("opens on the slots, and the Storyboard tab is kept in the address", async () => {
    answerQuery(api.projects.get, project);
    answerQuery(api.clients.list, []);
    answerQuery(api.storyboards.get, null);
    place.pathname = "/projects/p1";
    const user = userEvent.setup();
    renderInApp(<ProjectView projectId={PROJECT} />);
    expect(screen.getByRole("tab", { name: "Slots" }).getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("tab", { name: "Storyboard" }));
    expect(replaced).toHaveBeenCalledWith("/projects/p1?view=storyboard", { scroll: false });
  });

  test("shows the storyboard when the address asks for it", () => {
    answerQuery(api.projects.get, project);
    answerQuery(api.clients.list, []);
    answerQuery(api.storyboards.get, null);
    place.pathname = "/projects/p1";
    place.search = "view=storyboard";
    renderInApp(<ProjectView projectId={PROJECT} />);
    expect(screen.getByRole("tab", { name: "Storyboard" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByText("Plan the video line by line")).toBeTruthy();
  });
});

describe("making the storyboard into a finished video", () => {
  const VIDEO = {
    _id: "v1",
    _creationTime: 0,
    title: "Part 1: AnyPress",
    chapterId: null,
    aspect: "16:9",
    status: "working",
    total: 5,
    made: 2,
    joining: false,
    skipped: [3, 9],
    plain: [4],
    error: null,
    file: null,
    finishedAt: null,
  };

  test("starts the whole video, or just the chapter on screen", async () => {
    answerQuery(api.storyboards.get, boardFor(LESSON_STORYBOARD));
    answerQuery(api.storyboardVideos.list, []);
    mutationOf(api.storyboardVideos.start).mockResolvedValue({
      videoId: "v1",
      takes: 2,
      skipped: [],
      plain: [],
    });
    const user = userEvent.setup();
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    const section = screen.getByRole("region", { name: "Finished video" });
    await user.click(within(section).getByRole("button", { name: "Make the video" }));
    expect(mutationOf(api.storyboardVideos.start)).toHaveBeenCalledWith({ storyboardId: "sb1" });
    expect(toastSuccess).toHaveBeenCalledWith("Making 2 takes into one video.");
    await user.click(within(section).getByRole("button", { name: "Just this chapter" }));
    expect(mutationOf(api.storyboardVideos.start)).toHaveBeenLastCalledWith({
      storyboardId: "sb1",
      chapterId: "c1",
    });
  });

  test("shows how far a video is, and what was left out or shown plainly", () => {
    answerQuery(api.storyboards.get, boardFor(LESSON_STORYBOARD));
    answerQuery(api.storyboardVideos.list, [VIDEO]);
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    const section = screen.getByRole("region", { name: "Finished video" });
    expect(section.textContent).toContain("Making the takes: 2 of 5 done");
    expect(section.textContent).toContain("Left out takes 3 and 9");
    expect(section.textContent).toContain("Shown Full Screen for now: take 4");
    // One video at a time.
    expect(within(section).getByRole("button", { name: "Make the video" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  test("a made video plays in place and opens in the Library; a failed one says why", async () => {
    answerQuery(api.storyboards.get, boardFor(LESSON_STORYBOARD));
    actionOf(api.library.previewLinks).mockResolvedValue([
      { itemId: "li1", url: "https://cdn.example/joined.mp4" },
    ]);
    answerQuery(api.storyboardVideos.list, [
      {
        ...VIDEO,
        status: "done",
        made: 5,
        skipped: [],
        plain: [],
        file: { _id: "li1", shortId: "V12", title: "Part 1: AnyPress" },
      },
      { ...VIDEO, _id: "v0", status: "failed", error: "Take 5 could not be made." },
    ]);
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    const section = screen.getByRole("region", { name: "Finished video" });
    expect(within(section).getByRole("link", { name: "Open V12 in your Library" })).toHaveProperty(
      "href",
      expect.stringContaining("/library/li1"),
    );
    expect(section.textContent).toContain("Take 5 could not be made.");
    await act(async () => {});
    expect(section.querySelector("video")?.getAttribute("src")).toBe(
      "https://cdn.example/joined.mp4",
    );
  });
});

describe("matching recorded takes to the lines", () => {
  test("picks recordings and says what was put in, picked and still missing", async () => {
    answerQuery(api.storyboards.get, boardFor(LESSON_STORYBOARD));
    answerQuery(api.storyboards.uploadDrafts, [
      {
        storyboardId: "d1",
        libraryItemId: "li1",
        shortId: "V3",
        title: "Monday takes",
        duration: 60,
      },
      {
        storyboardId: "d2",
        libraryItemId: "li2",
        shortId: "V4",
        title: "Tuesday takes",
        duration: 90,
      },
    ]);
    actionOf(api.storyboardMatch.match).mockResolvedValue({
      matched: 12,
      picked: [1, 5],
      missing: [4],
      notReady: [],
    });
    const user = userEvent.setup();
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    await user.click(screen.getByRole("button", { name: "Match takes" }));
    const panel = screen.getByRole("region", { name: "Match takes" });
    const go = within(panel).getByRole("button", { name: "Match 0 recordings" });
    expect(go).toHaveProperty("disabled", true);
    await user.click(within(panel).getByRole("checkbox", { name: /Monday takes/ }));
    await user.click(within(panel).getByRole("checkbox", { name: /Tuesday takes/ }));
    await user.click(within(panel).getByRole("button", { name: "Match 2 recordings" }));
    expect(actionOf(api.storyboardMatch.match)).toHaveBeenCalledWith({
      storyboardId: "sb1",
      libraryItemIds: ["li1", "li2"],
    });
    expect(panel.textContent).toContain(
      "Put in 12 takes. Picked the best of several for takes 1 and 5. Not found yet: take 4.",
    );
  });

  test("can pick again for lines that have a take, and says when nothing is transcribed", async () => {
    answerQuery(api.storyboards.get, boardFor(LESSON_STORYBOARD));
    answerQuery(api.storyboards.uploadDrafts, []);
    const user = userEvent.setup();
    renderInApp(<StoryboardView projectId={PROJECT} organizationId={TEAM.id} />);
    await user.click(screen.getByRole("button", { name: "Match takes" }));
    const panel = screen.getByRole("region", { name: "Match takes" });
    expect(panel.textContent).toContain("No recordings with their words in yet.");
    await user.click(
      within(panel).getByRole("checkbox", {
        name: "Pick again for lines that already have a take",
      }),
    );
    await user.click(within(panel).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("region", { name: "Match takes" })).toBeNull();
  });
});
