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

/** Opens a tab beside the player (Radix tabs open on the pointer going down). */
function openTab(name: RegExp | string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

/** Opens the words beside the player: Details open first. */
function openWords() {
  const tab = screen.queryByRole("tab", { name: /^(Transcript|Captions)$/ });
  if (tab) fireEvent.mouseDown(tab, { button: 0 });
}

describe("a library file", () => {
  beforeEach(() => {
    answerQuery(api.library.get, DETAIL);
    answerQuery(api.automations.list, [{ _id: "a1", name: "Podcast clips" }]);
  });

  test("shows what was made from it and what was said, and finds a word in it", () => {
    renderInApp(<LibraryItemView itemId={"i1" as never} search="pricing" />);
    // The words open first; what was made from it is a tab with its count.
    expect(screen.getByRole("tab", { name: "Transcript" }).getAttribute("data-state")).toBe(
      "active",
    );
    const said = screen.getByTestId("transcript");
    // Opened from a search: only the moments with the words, the words marked.
    expect(within(said).getAllByRole("button")).toHaveLength(1);
    expect(within(said).getByText("pricing").tagName).toBe("MARK");
    fireEvent.change(screen.getByLabelText("Find in what was said"), { target: { value: "" } });
    expect(within(screen.getByTestId("transcript")).getAllByRole("button")).toHaveLength(2);
    openTab(/^Made from this/);
    const made = screen.getByRole("region", { name: "Made from this" });
    expect(within(made).getByText("C1")).toBeTruthy();
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
    openWords();
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
    await user.click(screen.getByRole("radio", { name: "Text" }));
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
      openWords();
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
    openWords();
    expect(screen.queryByRole("radio", { name: "SRT" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    expect(screen.getByText(/The words, SRT and VTT show here when it is done/)).toBeTruthy();
  });

  test("a moment in what was said plays the file from there", async () => {
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    openWords();
    const player = (await screen.findByTestId("library-player")) as HTMLVideoElement;
    fireEvent.click(within(screen.getByTestId("transcript")).getByText("12:31"));
    expect(player.currentTime).toBe(751);
    expect(player.paused).toBe(false);
  });

  test("says which client a file is for, and changes it", async () => {
    answerQuery(api.clients.list, [ACME]);
    answerQuery(api.library.get, { ...DETAIL, client: ACME });
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    openWords();
    openTab("Details");
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
    openWords();
    expect(screen.queryByLabelText("Client")).toBeNull();
  });

  test("Delete asks first, then deletes the file from storage", async () => {
    answerQuery(api.library.get, { ...DETAIL, key: "uploads/Episode 4.mp4" });
    actionOf(api.files.remove).mockResolvedValue({ removed: 1, leftBehind: 0 });
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete Episode 4?" });
    expect(confirm.textContent).toContain("from your storage and the library for good");
    expect(actionOf(api.files.remove)).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(actionOf(api.files.remove)).toHaveBeenCalledWith({
        organizationId: "team_1",
        keys: ["uploads/Episode 4.mp4"],
      }),
    );
  });

  test("an upload's page copies a link to it and says who shared it", async () => {
    answerQuery(api.library.get, {
      ...DETAIL,
      upload: { _id: "up_4", fileName: "Episode 4.mp4", size: 1000, sharedBy: "Pat Rivera" },
    });
    actionOf(api.storage.linkFor).mockResolvedValue("https://files.example/episode-4.mp4?sig=1");
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    openTab("Details");
    expect(screen.getByText("Pat Rivera")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Link copied. It works for seven days."),
    );
    expect(actionOf(api.storage.linkFor)).toHaveBeenCalledWith({ uploadId: "up_4" });
    expect(await navigator.clipboard.readText()).toBe("https://files.example/episode-4.mp4?sig=1");
  });

  test("a file made by an automation has no upload link to copy", () => {
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    openTab("Details");
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
    expect(screen.queryByText("Shared by")).toBeNull();
  });

  test("the file's numbers are labels, each with its own icon and name", () => {
    answerQuery(api.library.get, {
      ...DETAIL,
      details: {
        duration: 412,
        hasVideo: true,
        hasAudio: true,
        width: 1920,
        height: 1080,
        fps: 29.97,
        videoCodec: "h264",
        audioCodec: "aac",
        filesize: 48 * 1024 * 1024,
      },
    });
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    const facts = within(screen.getByRole("list", { name: "About the file" })).getAllByRole(
      "listitem",
    );
    expect(facts.map((fact) => fact.getAttribute("aria-label"))).toEqual([
      "Length: 6:52",
      "Picture size: 1920×1080",
      "Frame rate: 29.97 fps",
      "Format: h264",
      "Sound: aac",
      "File size: 48 MB",
    ]);
    expect(facts.every((fact) => fact.querySelector("svg"))).toBe(true);
  });

  test("a video with no sound says so", () => {
    answerQuery(api.library.get, {
      ...DETAIL,
      details: { duration: 6, hasVideo: true, hasAudio: false, width: 180, height: 320 },
    });
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    expect(screen.getByRole("listitem", { name: "Sound: No sound" })).toBeTruthy();
  });

  test("tags are added and taken off", async () => {
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    openWords();
    openTab("Details");
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
    openWords();
    expect(screen.getByText(/Being transcribed on your toolkit/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Transcribe" })).toBeNull();
  });

  test("an uploaded video has its storyboard in a tab, drafted from what was said", () => {
    answerQuery(api.library.get, DETAIL);
    answerQuery(api.storyboards.forUpload, null);
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    openWords();
    openTab("Storyboard");
    const board = screen.getByRole("region", { name: "Storyboard" });
    expect(board.textContent).toContain("a line for every sentence, each with its own clip");
  });

  test("a file an automation made has no storyboard of its own", () => {
    answerQuery(api.library.get, { ...DETAIL, source: "automation" });
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    openWords();
    expect(screen.queryByRole("tab", { name: "Storyboard" })).toBeNull();
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
    openWords();
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
    openWords();
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
    openWords();
    openTab("Details");
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
    openWords();
    expect(screen.queryByText("Use as B-Roll")).toBeNull();
  });

  test("a clip says what it was made from", () => {
    answerQuery(api.library.get, { ...DETAIL, ...CLIP, children: [], pieces: [] });
    renderInApp(<LibraryItemView itemId={"i2" as never} />);
    openWords();
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
    openWords();
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
    openWords();
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

describe("what is being done with a file, in colour", () => {
  beforeEach(() => {
    answerQuery(api.automations.list, []);
    answerQuery(api.storyboards.forUpload, null);
  });

  const chip = (name: RegExp) =>
    within(screen.getByRole("list", { name: "What is being done with this file" })).getByRole(
      "button",
      { name },
    );

  test("an upload being transcribed shows it in progress, its storyboard waiting", () => {
    answerQuery(api.library.get, {
      ...DETAIL,
      searchable: "working",
      pieces: [],
      storyboardDrafted: false,
    });
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    const said = chip(/^Transcript and SRT/);
    expect(said.getAttribute("aria-label")).toBe("Transcript and SRT: In progress");
    expect(said.getAttribute("data-state")).toBe("working");
    expect(chip(/^Storyboard/).getAttribute("aria-label")).toBe(
      "Storyboard: Waits for the transcript",
    );
    expect(chip(/^Storyboard/).getAttribute("data-state")).toBe("waiting");
  });

  test("once the words are in: ready, the storyboard drafting, then ready too", () => {
    answerQuery(api.library.get, { ...DETAIL, storyboardDrafted: false });
    const { unmount } = renderInApp(<LibraryItemView itemId={"i1" as never} />);
    expect(chip(/^Transcript and SRT/).getAttribute("data-state")).toBe("ready");
    expect(chip(/^Storyboard/).getAttribute("data-state")).toBe("working");
    unmount();
    answerQuery(api.library.get, { ...DETAIL, storyboardDrafted: true });
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    expect(chip(/^Storyboard/).getAttribute("aria-label")).toBe("Storyboard: Ready");
  });

  test("a failed transcript shows red, and a chip opens the place it shows", () => {
    answerQuery(api.library.get, {
      ...DETAIL,
      searchable: "failed",
      transcriptError: "No sound.",
      pieces: [],
      storyboardDrafted: false,
    });
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    expect(chip(/^Transcript and SRT/).getAttribute("aria-label")).toBe(
      "Transcript and SRT: Did not work",
    );
    fireEvent.click(chip(/^Storyboard/));
    expect(screen.getByRole("tab", { name: "Storyboard" }).getAttribute("data-state")).toBe(
      "active",
    );
    fireEvent.click(chip(/^Transcript and SRT/));
    expect(screen.getByText("The last try did not work: No sound.")).toBeTruthy();
  });

  test("translations and the B-Roll check have their own chips", () => {
    answerQuery(api.library.get, {
      ...DETAIL,
      storyboardDrafted: true,
      broll: { use: "auto", looked: "working", looksLike: null, usable: false },
    });
    answerQuery(api.translations.list, [
      { _id: "t1", language: "es", name: "Spanish", status: "working", cues: [], total: 4 },
    ]);
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    expect(chip(/^Spanish subtitles/).getAttribute("data-state")).toBe("working");
    expect(chip(/^B-Roll check/).getAttribute("aria-label")).toBe("B-Roll check: In progress");
    fireEvent.click(chip(/^B-Roll check/));
    expect(screen.getByRole("combobox", { name: "Use as B-Roll" })).toBeTruthy();
  });

  test("a picture has no chips and opens on its details", () => {
    answerQuery(api.library.get, {
      ...DETAIL,
      kind: "image",
      children: [],
      pieces: [],
      broll: null,
      storyboardDrafted: false,
    });
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    expect(screen.queryByRole("list", { name: "What is being done with this file" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Details" }).getAttribute("data-state")).toBe("active");
    expect(screen.queryByRole("tab", { name: "Transcript" })).toBeNull();
  });
});

describe("the tour of the library", () => {
  test("has a place on the page for every part it points at, files and filters too", () => {
    renderInApp(<LibraryView />);
    expect(missingTourTargets(LIBRARY_TOUR, { includeOptional: true })).toEqual([]);
  });
});
