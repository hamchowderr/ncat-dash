import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test } from "vitest";

import { actionOf, answerQuery, mutationOf, toastSuccess } from "@/test/convex";
import { pick, renderInApp } from "@/test/render";

import { LibraryItemView } from "./library-item-view";
import { LibraryView } from "./library-view";
import { missingTourTargets } from "@/test/tours";
import { LIBRARY_TOUR } from "./library-tour";

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
    client: null,
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
  clients: [],
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

const ACME = { _id: "c1", name: "Acme Coffee" };

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

  test("shows who each file is for, and filters to one client or the team's own", () => {
    answerQuery(api.library.list, {
      ...LIBRARY,
      items: [{ ...CLIP, client: ACME }, THEME, { ...EPISODE, client: ACME }],
      clients: [ACME],
    });
    renderInApp(<LibraryView />);
    expect(
      within(screen.getAllByTestId("library-tile")[0]!).getByText(
        "Acme Coffee · Made by Podcast clips · from V1 · 0:45",
      ),
    ).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Client" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Acme Coffee" }));
    expect(screen.getAllByTestId("library-tile")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Client: Acme Coffee" })).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Client: Acme Coffee" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Your team" }));
    const tiles = screen.getAllByTestId("library-tile");
    expect(tiles).toHaveLength(1);
    expect(within(tiles[0]!).getByText("Theme")).toBeTruthy();
    // The list has a Client column.
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByRole("columnheader", { name: "Client" })).toBeTruthy();
  });

  test("a team with no clients sees no client filter or column", () => {
    answerQuery(api.library.list, { ...LIBRARY, clients: [] });
    renderInApp(<LibraryView />);
    expect(screen.queryByRole("button", { name: "Client" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.queryByRole("columnheader", { name: "Client" })).toBeNull();
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

  test("offers to transcribe what automations made, never what was brought in", async () => {
    actionOf(api.library.makeSearchable).mockResolvedValue(1);
    renderInApp(<LibraryView />);
    // The clip (made by an automation) is offered; the uploaded theme is caught up by itself.
    fireEvent.click(screen.getByRole("button", { name: "Transcribe 1 file" }));
    await waitFor(() =>
      expect(actionOf(api.library.makeSearchable)).toHaveBeenCalledWith({
        organizationId: "team_1",
        itemIds: ["i2"],
      }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("1 file is being transcribed on your toolkit.");
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
  captionFormat: null,
  captionsFor: null,
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

  test("shows the words as SRT or VTT, ready to copy", async () => {
    answerQuery(api.library.get, {
      ...DETAIL,
      pieces: [
        {
          start: 0,
          end: 1.6,
          text: "Welcome back everyone.",
          words: [
            { t: "Welcome", s: 0, e: 0.5 },
            { t: "back", s: 0.6, e: 0.9 },
            { t: "everyone.", s: 1, e: 1.6 },
          ],
        },
        { start: 751, end: 754, text: "Let's talk about pricing." },
      ],
    });
    const user = userEvent.setup();
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    await user.click(screen.getByRole("radio", { name: "SRT" }));
    const srt = screen.getByTestId("subtitle-text");
    expect(srt.textContent).toBe(
      "1\n00:00:00,000 --> 00:00:01,600\nWelcome back everyone.\n\n" +
        "2\n00:12:31,000 --> 00:12:34,000\nLet's talk about pricing.\n",
    );
    // Finding words is for reading the transcript, not the file.
    expect(screen.queryByLabelText("Find in what was said")).toBeNull();
    await user.click(screen.getByRole("radio", { name: "VTT" }));
    expect(screen.getByTestId("subtitle-text").textContent).toMatch(
      /^WEBVTT\n\n00:00:00\.000 --> 00:00:01\.600\nWelcome back everyone\./,
    );
    expect(screen.getByRole("button", { name: "Copy WebVTT" })).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "Transcript" }));
    expect(screen.getByTestId("transcript")).toBeTruthy();
  });

  test("downloads the words as SRT, WebVTT or plain text, named after the file", async () => {
    const saved: { name: string; type: string; text: string }[] = [];
    const created = URL.createObjectURL;
    const revoked = URL.revokeObjectURL;
    let last: Blob | null = null;
    URL.createObjectURL = (blob: Blob) => {
      last = blob;
      return "blob:transcript";
    };
    URL.revokeObjectURL = () => {};
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      const blob = last!;
      saved.push({ name: this.download, type: blob.type, text: "" });
    };
    try {
      const user = userEvent.setup();
      renderInApp(<LibraryItemView itemId={"i1" as never} />);
      for (const label of [
        "SRT subtitles (.srt)",
        "WebVTT subtitles (.vtt)",
        "Plain text (.txt)",
      ]) {
        await user.click(screen.getByRole("button", { name: "Download" }));
        await user.click(await screen.findByRole("menuitem", { name: label }));
      }
    } finally {
      URL.createObjectURL = created;
      URL.revokeObjectURL = revoked;
      HTMLAnchorElement.prototype.click = click;
    }
    expect(saved.map((one) => [one.name, one.type])).toEqual([
      ["Episode 4.srt", "application/x-subrip;charset=utf-8"],
      ["Episode 4.vtt", "text/vtt;charset=utf-8"],
      ["Episode 4.txt", "text/plain;charset=utf-8"],
    ]);
  });

  test("no SRT or download until there are words", () => {
    answerQuery(api.library.get, { ...DETAIL, searchable: "working", pieces: [] });
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    expect(screen.queryByRole("radio", { name: "SRT" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    expect(screen.getByText(/The words, SRT and VTT show here when it is done/)).toBeTruthy();
  });

  test("a moment in what was said plays the file from there", async () => {
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    const player = (await screen.findByTestId("library-player")) as HTMLVideoElement;
    fireEvent.click(within(screen.getByTestId("transcript")).getByText("12:31"));
    expect(player.currentTime).toBe(751);
    expect(player.paused).toBe(false);
  });

  test("says which client a file is for, and changes it", async () => {
    answerQuery(api.clients.list, [ACME]);
    answerQuery(api.library.get, { ...DETAIL, client: ACME });
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    const picker = screen.getByLabelText("Client");
    expect(picker).toHaveTextContent("Acme Coffee");
    await pick(userEvent.setup(), picker, "Your team");
    await waitFor(() =>
      expect(mutationOf(api.library.setClient)).toHaveBeenCalledWith({
        itemId: "i1",
        clientId: null,
      }),
    );
  });

  test("no client picker until the team has a client", () => {
    answerQuery(api.clients.list, []);
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    expect(screen.queryByLabelText("Client")).toBeNull();
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

  test("an uploaded file without words yet is on its way, with nothing to press", () => {
    answerQuery(api.library.get, { ...DETAIL, searchable: "no", pieces: [] });
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    expect(screen.getByText(/Being transcribed on your toolkit/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Transcribe" })).toBeNull();
  });

  test("a failed transcript can be tried again", async () => {
    answerQuery(api.library.get, {
      ...DETAIL,
      searchable: "failed",
      transcriptError: "No sound.",
      pieces: [],
    });
    actionOf(api.library.makeSearchable).mockResolvedValue(1);
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    expect(screen.getByText("The last try did not work: No sound.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(actionOf(api.library.makeSearchable)).toHaveBeenCalledWith({
        organizationId: "team_1",
        itemIds: ["i1"],
      }),
    );
  });

  test("a file an automation made can be transcribed by hand", async () => {
    answerQuery(api.library.get, {
      ...DETAIL,
      source: "automation",
      searchable: "no",
      pieces: [],
    });
    actionOf(api.library.makeSearchable).mockResolvedValue(1);
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));
    await waitFor(() =>
      expect(actionOf(api.library.makeSearchable)).toHaveBeenCalledWith({
        organizationId: "team_1",
        itemIds: ["i1"],
      }),
    );
  });

  test("a video says whether Add B-Roll may use it, and it can be set by hand", async () => {
    answerQuery(api.library.get, {
      ...DETAIL,
      broll: { use: "auto", looked: "ready", looksLike: true, usable: true },
    });
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    expect(screen.getByText(/no talking face, so Add B-Roll can use it/)).toBeTruthy();
    const picker = screen.getByRole("combobox", { name: "Use as B-Roll" });
    expect(picker.textContent).toContain("When it looks like B-Roll");
    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole("option", { name: "Never" }));
    await waitFor(() =>
      expect(mutationOf(api.broll.setUse)).toHaveBeenCalledWith({
        organizationId: "team_1",
        itemId: "i1",
        use: "no",
      }),
    );
  });

  test("a sound file has no B-Roll setting", () => {
    answerQuery(api.library.get, { ...DETAIL, broll: null });
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    expect(screen.queryByText("Use as B-Roll")).toBeNull();
  });

  test("a clip says what it was made from", () => {
    answerQuery(api.library.get, { ...DETAIL, ...CLIP, children: [], pieces: [] });
    renderInApp(<LibraryItemView itemId={"i2" as never} />);
    expect(screen.getByRole("link", { name: "V1 Episode 4" }).getAttribute("href")).toBe(
      "/library/i1",
    );
    expect(screen.getByText("Made by Podcast clips")).toBeTruthy();
  });

  test("a caption file shows its lines, each opening the video it captions at that moment", () => {
    answerQuery(api.library.get, {
      ...DETAIL,
      ...item("i4", "F1", "Episode 4 clip 1", {
        kind: "other",
        source: "automation",
        searchable: "ready",
      }),
      details: null,
      children: [],
      captionFormat: "srt",
      captionsFor: { _id: "i2", shortId: "C1", title: "Episode 4 clip 1" },
      pieces: [
        { start: 1, end: 3, text: "Welcome back." },
        { start: 4.5, end: 7, text: "Let's talk about pricing." },
      ],
    });
    renderInApp(<LibraryItemView itemId={"i4" as never} />);
    const section = screen.getByRole("region", { name: "What the captions say" });
    expect(
      within(section).getByRole("link", { name: "C1 Episode 4 clip 1" }).getAttribute("href"),
    ).toBe("/library/i2");
    const lines = within(screen.getByTestId("transcript")).getAllByRole("link");
    expect(lines.map((line) => line.getAttribute("href"))).toEqual([
      "/library/i2?t=1",
      "/library/i2?t=4",
    ]);
    expect(lines[1]!.textContent).toBe("0:04Let's talk about pricing.");
    expect(screen.queryByRole("button", { name: "Make searchable" })).toBeNull();
  });

  test("a caption file that could not be read offers to read it again", async () => {
    answerQuery(api.library.get, {
      ...DETAIL,
      ...item("i4", "F1", "Captions", { kind: "other", searchable: "failed" }),
      details: null,
      children: [],
      captionFormat: "ass",
      transcriptError: "The caption file could not be read.",
      pieces: [],
    });
    actionOf(api.library.makeSearchable).mockResolvedValue(1);
    renderInApp(<LibraryItemView itemId={"i4" as never} />);
    expect(screen.getByText(/could not be read/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(actionOf(api.library.makeSearchable)).toHaveBeenCalledWith({
        organizationId: "team_1",
        itemIds: ["i4"],
      }),
    );
  });
});

describe("the tour of the library", () => {
  test("has a place on the page for every part it points at, files and filters too", () => {
    renderInApp(<LibraryView />);
    expect(missingTourTargets(LIBRARY_TOUR, { includeOptional: true })).toEqual([]);
  });
});
