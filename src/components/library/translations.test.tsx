import { api } from "@convex/_generated/api";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test } from "vitest";

import { actionOf, answerQuery, mutationOf } from "@/test/convex";
import { pick, renderInApp } from "@/test/render";

import { LibraryItemView } from "./library-item-view";

/** A file's words in other languages: translated once, read, corrected and downloaded. */

const DETAIL = {
  _id: "i1",
  _creationTime: Date.UTC(2026, 10, 18),
  shortId: "V1",
  kind: "video",
  source: "upload",
  title: "Episode 4",
  tags: [],
  rating: null,
  duration: 412,
  automationName: null,
  parent: null,
  client: null,
  made: 0,
  searchable: "ready",
  details: { duration: 412, hasVideo: true, width: 1920, height: 1080 },
  runId: null,
  automationId: null,
  transcriptError: null,
  captionFormat: null,
  captionsFor: null,
  children: [],
  pieces: [
    { start: 0, end: 2, text: "Welcome back to the show." },
    { start: 751, end: 754, text: "Let's talk about pricing." },
  ],
};

const SPANISH = {
  _id: "t1",
  language: "es",
  name: "Spanish",
  status: "ready",
  error: null,
  done: 2,
  total: 2,
  cues: [
    { start: 0, end: 2, text: "Bienvenidos de nuevo al programa." },
    { start: 751, end: 754, text: "Hablemos de precios." },
  ],
};

beforeEach(() => {
  answerQuery(api.library.get, DETAIL);
  answerQuery(api.translations.list, []);
  answerQuery(api.automations.list, []);
  actionOf(api.library.previewLinks).mockImplementation(async (args: unknown) =>
    (args as { itemIds: string[] }).itemIds.map((itemId) => ({
      itemId,
      url: `https://r2.example/${itemId}`,
    })),
  );
});

describe("translating a file", () => {
  test("picks a language to translate into, once", async () => {
    const user = userEvent.setup();
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    // No translations yet: only the Translate button, no language picker.
    expect(screen.queryByLabelText("Language")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Translate" }));
    await user.type(screen.getByLabelText("Find a language"), "span");
    await user.click(await screen.findByRole("option", { name: "Spanish" }));
    await waitFor(() =>
      expect(mutationOf(api.translations.start)).toHaveBeenCalledWith({
        itemId: "i1",
        language: "es",
      }),
    );
  });

  test("does not offer a language the file already has", async () => {
    answerQuery(api.translations.list, [SPANISH]);
    const user = userEvent.setup();
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    await user.click(screen.getByRole("button", { name: "Translate" }));
    expect(screen.queryByRole("option", { name: "Spanish" })).toBeNull();
    expect(screen.getByRole("option", { name: "French" })).toBeTruthy();
  });

  test("shows a translation line by line and as SRT, on the original times", async () => {
    answerQuery(api.translations.list, [SPANISH]);
    const user = userEvent.setup();
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    await pick(user, screen.getByLabelText("Language"), "Spanish");
    const lines = screen.getByTestId("translation");
    expect(within(lines).getByText("Hablemos de precios.")).toBeTruthy();
    expect(within(lines).getByText("12:31")).toBeTruthy();
    expect(screen.queryByTestId("transcript")).toBeNull();
    await user.click(screen.getByRole("radio", { name: "SRT" }));
    expect(screen.getByTestId("subtitle-text").textContent).toBe(
      "1\n00:00:00,000 --> 00:00:02,000\nBienvenidos de nuevo al programa.\n\n" +
        "2\n00:12:31,000 --> 00:12:34,000\nHablemos de precios.\n",
    );
    // Back to the original words.
    await pick(user, screen.getByLabelText("Language"), "Original");
    await user.click(screen.getByRole("radio", { name: "Transcript" }));
    expect(screen.getByTestId("transcript")).toBeTruthy();
  });

  test("downloads a translation named after the file and the language", async () => {
    answerQuery(api.translations.list, [SPANISH]);
    const names: string[] = [];
    const created = URL.createObjectURL;
    const revoked = URL.revokeObjectURL;
    const click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = () => "blob:translation";
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      names.push(this.download);
    };
    try {
      const user = userEvent.setup();
      renderInApp(<LibraryItemView itemId={"i1" as never} />);
      await pick(user, screen.getByLabelText("Language"), "Spanish");
      await user.click(screen.getByRole("button", { name: "Download" }));
      await user.click(await screen.findByRole("menuitem", { name: "SRT subtitles (.srt)" }));
    } finally {
      URL.createObjectURL = created;
      URL.revokeObjectURL = revoked;
      HTMLAnchorElement.prototype.click = click;
    }
    expect(names).toEqual(["Episode 4.es.srt"]);
  });

  test("a line can be corrected by hand", async () => {
    answerQuery(api.translations.list, [SPANISH]);
    const user = userEvent.setup();
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    await pick(user, screen.getByLabelText("Language"), "Spanish");
    await user.click(screen.getByRole("button", { name: "Correct the line at 12:31" }));
    const field = screen.getByLabelText("Line at 12:31");
    await user.clear(field);
    await user.type(field, "Hablemos de los precios.{Enter}");
    await waitFor(() =>
      expect(mutationOf(api.translations.fixLine)).toHaveBeenCalledWith({
        translationId: "t1",
        index: 1,
        text: "Hablemos de los precios.",
      }),
    );
  });

  test("says how far a translation has got, and carries on one that stopped", async () => {
    answerQuery(api.translations.list, [
      { ...SPANISH, status: "working", done: 1, cues: SPANISH.cues.slice(0, 1) },
      {
        ...SPANISH,
        _id: "t2",
        language: "fr",
        name: "French",
        status: "failed",
        error: "The agent did not answer. Try again in a moment.",
        done: 0,
        cues: [],
      },
    ]);
    const user = userEvent.setup();
    renderInApp(<LibraryItemView itemId={"i1" as never} />);
    await pick(user, screen.getByLabelText("Language"), "Spanish (translating)");
    expect(screen.getByText(/Translating into Spanish: 1 of 2 lines/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    await pick(user, screen.getByLabelText("Language"), "French (did not finish)");
    expect(screen.getByText(/The agent did not answer/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Carry on" }));
    await waitFor(() =>
      expect(mutationOf(api.translations.start)).toHaveBeenCalledWith({
        itemId: "i1",
        language: "fr",
      }),
    );
  });
});
