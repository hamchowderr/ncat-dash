import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import { actionOf, answerQuery, mutationOf, toastSuccess } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { LibraryItemView } from "./library-item-view";
import { LibraryView } from "./library-view";

/** The Library: every file with its short ID, where it came from, tags, stars and search. */

function item(id: string, shortId: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    _id: id,
    _creationTime: Date.UTC(2026, 10, 18),
    shortId,
    kind: "video",
    source: "upload",
    title,
    tags: [],
    rating: null,
    duration: 412,
    automationName: null,
    parent: null,
    made: 0,
    searchable: "no",
    ...extra,
  };
}

const EPISODE = item("i1", "V1", "Episode 4", { made: 2, tags: ["pricing"], searchable: "ready" });
const CLIP = item("i2", "C1", "Episode 4 clip 1", {
  source: "automation",
  automationName: "Podcast clips",
  parent: { _id: "i1", shortId: "V1", title: "Episode 4" },
  rating: 4,
  duration: 45,
});
const THEME = item("i3", "A1", "Theme", { kind: "audio", duration: 30 });

const LIBRARY = {
  items: [CLIP, THEME, EPISODE],
  searchNewFiles: false,
  filled: true,
  canChangeSettings: true,
  tags: ["pricing"],
};

beforeEach(() => {
  window.localStorage.clear();
  answerQuery(api.library.list, LIBRARY);
  actionOf(api.library.previewLinks).mockImplementation(async (args: unknown) =>
    (args as { itemIds: string[] }).itemIds.map((itemId) => ({
      itemId,
      url: `https://r2.example/${itemId}`,
    })),
  );
});

describe("the Library page", () => {
  test("shows each file with its short ID and where it came from", async () => {
    renderInApp(<LibraryView />);
    const tiles = screen.getAllByTestId("library-tile");
    expect(tiles).toHaveLength(3);
    expect(within(tiles[0]).getByText("C1")).toBeTruthy();
    expect(within(tiles[0]).getByText("Made by Podcast clips · from V1 · 0:45")).toBeTruthy();
    expect(within(tiles[2]).getByText("Uploaded · 2 made from it · 6:52")).toBeTruthy();
    expect(within(tiles[0]).getByLabelText("4 of 5 stars")).toBeTruthy();
    await waitFor(() =>
      expect(actionOf(api.library.previewLinks)).toHaveBeenCalledWith({
        organizationId: "team_1",
        itemIds: ["i2", "i3", "i1"],
      }),
    );
  });

  test("filters to clips, or to a tag", () => {
    renderInApp(<LibraryView />);
    fireEvent.click(screen.getByRole("button", { name: "Clips" }));
    expect(screen.getAllByTestId("library-tile")).toHaveLength(1);
    expect(screen.getByText("1 file")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sound" }));
    expect(screen.getByText("Theme")).toBeTruthy();
  });

  test("the list renames a file in place and gives stars", async () => {
    renderInApp(<LibraryView />);
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getAllByTestId("library-row")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Rename A1 Theme" }));
    const box = screen.getByLabelText("Name of A1");
    fireEvent.change(box, { target: { value: "Show theme" } });
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.blur(box);
    await waitFor(() =>
      expect(mutationOf(api.library.rename)).toHaveBeenCalledWith({
        itemId: "i3",
        title: "Show theme",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Stars for V1" })).getByLabelText("5 stars"),
    );
    expect(mutationOf(api.library.setRating)).toHaveBeenCalledWith({ itemId: "i1", rating: 5 });
  });

  test("offers to make the videos and sounds that are not searchable yet", async () => {
    actionOf(api.library.makeSearchable).mockResolvedValue(2);
    renderInApp(<LibraryView />);
    fireEvent.click(screen.getByRole("button", { name: "Make 2 files searchable" }));
    await waitFor(() =>
      expect(actionOf(api.library.makeSearchable)).toHaveBeenCalledWith({
        organizationId: "team_1",
        itemIds: ["i2", "i3"],
      }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("2 files are being transcribed on your toolkit.");
  });

  test("the setting for new files is the owners' and admins'", () => {
    answerQuery(api.library.list, { ...LIBRARY, canChangeSettings: false });
    renderInApp(<LibraryView />);
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByText(/Only an owner or admin can change this/)).toBeTruthy();
  });

  test("brings in the files the team already had, the first time", async () => {
    answerQuery(api.library.list, { ...LIBRARY, items: [], filled: false });
    renderInApp(<LibraryView />);
    await waitFor(() =>
      expect(mutationOf(api.library.fill)).toHaveBeenCalledWith({ organizationId: "team_1" }),
    );
    expect(screen.getByText("Nothing in the library yet")).toBeTruthy();
  });

  test("search lists the moments something was said, each a link to that moment", async () => {
    answerQuery(api.library.search, ({ text }: { text?: string }) =>
      text === "pricing"
        ? [{ ...EPISODE, moments: [{ start: 751, text: "Let's talk about pricing." }] }]
        : [],
    );
    renderInApp(<LibraryView />);
    fireEvent.change(screen.getByLabelText("Search the library"), { target: { value: "pricing" } });
    // Searched once typing pauses.
    const hit = await screen.findByTestId("library-hit");
    const moment = within(hit).getByRole("link", { name: /12:31/ });
    expect(moment.getAttribute("href")).toBe("/library/i1?t=751&q=pricing");
    expect(within(hit).getByText("Let's talk about pricing.")).toBeTruthy();
  });
});

const DETAIL = {
  ...EPISODE,
  details: { duration: 412, hasVideo: true, width: 1920, height: 1080 },
  runId: null,
  automationId: null,
  transcriptError: null,
  children: [CLIP],
  pieces: [
    { start: 0, end: 20, text: "Welcome back to the show." },
    { start: 751, end: 770, text: "Let's talk about pricing." },
  ],
};

describe("a library file", () => {
  beforeEach(() => {
    answerQuery(api.library.get, DETAIL);
    answerQuery(api.automations.list, [{ _id: "a1", name: "Podcast clips" }]);
  });

  test("shows what was made from it and what was said, and finds a word in it", () => {
    renderInApp(<LibraryItemView itemId={"i1" as never} search="pricing" />);
    const made = screen.getByRole("region", { name: "Made from this" });
    expect(within(made).getByText("C1")).toBeTruthy();
    const said = screen.getByTestId("transcript");
    // Opened from a search: only the moments with the words, the words marked.
    expect(within(said).getAllByRole("button")).toHaveLength(1);
    expect(within(said).getByText("pricing").tagName).toBe("MARK");
    fireEvent.change(screen.getByLabelText("Find in what was said"), { target: { value: "" } });
    expect(within(screen.getByTestId("transcript")).getAllByRole("button")).toHaveLength(2);
  });

  test("a moment in what was said plays the file from there", async () => {
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    const player = (await screen.findByTestId("library-player")) as HTMLVideoElement;
    fireEvent.click(within(screen.getByTestId("transcript")).getByText("12:31"));
    expect(player.currentTime).toBe(751);
    expect(player.paused).toBe(false);
  });

  test("tags are added and taken off", async () => {
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    fireEvent.change(screen.getByLabelText("Add a tag"), { target: { value: "q&a, interviews" } });
    fireEvent.submit(screen.getByLabelText("Add a tag").closest("form")!);
    await waitFor(() =>
      expect(mutationOf(api.library.setTags)).toHaveBeenCalledWith({
        itemId: "i1",
        tags: ["pricing", "q&a", "interviews"],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove the tag pricing" }));
    expect(mutationOf(api.library.setTags)).toHaveBeenLastCalledWith({ itemId: "i1", tags: [] });
  });

  test("a file that is not searchable yet offers to be", async () => {
    answerQuery(api.library.get, { ...DETAIL, searchable: "no", pieces: [] });
    actionOf(api.library.makeSearchable).mockResolvedValue(1);
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: "Make searchable" }));
    await waitFor(() =>
      expect(actionOf(api.library.makeSearchable)).toHaveBeenCalledWith({
        organizationId: "team_1",
        itemIds: ["i1"],
      }),
    );
  });

  test("a clip says what it was made from", () => {
    answerQuery(api.library.get, { ...DETAIL, ...CLIP, children: [], pieces: [] });
    renderInApp(<LibraryItemView itemId={"i2" as never} />);
    expect(screen.getByRole("link", { name: "V1 Episode 4" }).getAttribute("href")).toBe(
      "/library/i1",
    );
    expect(screen.getByText("Made by Podcast clips")).toBeTruthy();
  });
});
