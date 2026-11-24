import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery } from "@/test/convex";
import { EMPTY_LIBRARY, emptyLibrary } from "@/test/library";
import { renderInApp } from "@/test/render";

import { LibraryView } from "./library-view";

/** Files come in on the Library itself: there is no separate Uploads page. */

vi.mock("@/lib/upload", () => ({
  putWithProgress: (_url: string, _file: File, onProgress: (percent: number) => void) => {
    onProgress(10);
    return new Promise<void>(() => {});
  },
}));

const STORAGE = { bucket: "ncat", publicUrl: null, baseUrl: "https://toolkit.example" };
const EPISODE = {
  _id: "i1",
  _creationTime: 0,
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
  searchable: "no",
};

beforeEach(() => {
  answerQuery(api.storage.get, STORAGE);
  answerQuery(api.storage.listUploads, []);
  answerQuery(api.links.recent, []);
  actionOf(api.storage.previewLinks).mockResolvedValue([]);
  actionOf(api.library.previewLinks).mockResolvedValue([]);
  actionOf(api.storage.startUpload).mockResolvedValue({
    uploadId: "u9",
    uploadUrl: "https://r2.example/put",
  });
});

describe("uploading on the Library", () => {
  test("Upload at the top opens the file picker, beside the files already there", async () => {
    answerQuery(api.library.list, { ...EMPTY_LIBRARY, items: [EPISODE] });
    renderInApp(<LibraryView />);
    const input = screen.getByLabelText("Choose files to upload") as HTMLInputElement;
    const clicked = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(clicked).toHaveBeenCalled());
    expect(screen.getAllByTestId("library-tile")).toHaveLength(1);
    // The big drop area is only for a library with nothing in it.
    expect(screen.queryByText("Nothing in the library yet")).toBeNull();
  });

  test("Paste a link opens a small window to bring a video in from a link", async () => {
    answerQuery(api.library.list, { ...EMPTY_LIBRARY, items: [EPISODE] });
    renderInApp(<LibraryView />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Paste a link" }));
    const dialog = await screen.findByRole("dialog", { name: "Bring in a video from a link" });
    expect(dialog).toContainElement(screen.getByLabelText("Paste a link to a video"));
  });

  test("files dropped anywhere on the page go up", async () => {
    answerQuery(api.library.list, { ...EMPTY_LIBRARY, items: [EPISODE] });
    const { container } = renderInApp(<LibraryView />);
    const page = container.querySelector("[data-library-page]")!;
    const files = [new File(["x"], "Podcast 9.mp4", { type: "video/mp4" })];
    fireEvent.dragOver(page, { dataTransfer: { types: ["Files"], files } });
    expect(page).toHaveAttribute("data-dragging", "true");
    fireEvent.drop(page, { dataTransfer: { types: ["Files"], files } });
    expect(page).toHaveAttribute("data-dragging", "false");
    expect(
      await screen.findByRole("progressbar", { name: "Uploading Podcast 9.mp4" }),
    ).toBeInTheDocument();
    expect(actionOf(api.storage.startUpload)).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "Podcast 9.mp4" }),
    );
  });

  test("an empty library is one big place to drop files, with a link field", () => {
    emptyLibrary();
    renderInApp(<LibraryView />);
    expect(screen.getByText("Nothing in the library yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose files" })).toBeInTheDocument();
    expect(screen.getByLabelText("Paste a link to a video")).toBeInTheDocument();
  });

  test("without a toolkit there is nowhere for files to go, so it says so", () => {
    answerQuery(api.storage.get, null);
    emptyLibrary();
    renderInApp(<LibraryView />);
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Paste a link" })).toBeNull();
    expect(screen.getByRole("link", { name: "Go to your toolkit" })).toHaveAttribute("href", "/");
  });
});
