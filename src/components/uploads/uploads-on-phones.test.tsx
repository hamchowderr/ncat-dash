import { api } from "@convex/_generated/api";
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery } from "@/test/convex";
import { windowWidth } from "@/test/media";
import { renderInApp } from "@/test/render";

import { LibraryView } from "@/components/library/library-view";
import { EMPTY_LIBRARY, emptyLibrary } from "@/test/library";

// Files are brought in on the Library page; it starts empty here.
beforeEach(() => emptyLibrary());

// Uploading from a phone, on the Library: the camera roll's wording, tiles two across instead
// of a list, and the screen kept on while a file is still sending.

vi.mock("@/lib/upload", () => ({
  // Halfway there and never finishing, so the page can be looked at mid-upload.
  putWithProgress: (_url: string, _file: File, onProgress: (percent: number) => void) => {
    onProgress(40);
    return new Promise<void>(() => {});
  },
}));

const STORAGE = { bucket: "ncat", publicUrl: null, baseUrl: "https://toolkit.example" };

const ready = (id: string, fileName: string) => ({
  _id: id,
  _creationTime: 0,
  fileName,
  contentType: "video/mp4",
  size: 2048,
  status: "ready",
  purpose: null,
  details: null,
});

const release = vi.fn(() => Promise.resolve());
const request = vi.fn(() => Promise.resolve({ release }));

beforeEach(() => {
  window.localStorage.clear();
  answerQuery(api.storage.get, STORAGE);
  answerQuery(api.storage.listUploads, [ready("u1", "Beach day.mp4"), ready("u2", "Intro.mp4")]);
  actionOf(api.storage.previewLinks).mockResolvedValue([]);
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  request.mockClear();
  release.mockClear();
});

const tile = (id: string, title: string) => ({
  _id: id,
  _creationTime: 0,
  shortId: "V1",
  kind: "video",
  source: "upload",
  title,
  tags: [],
  rating: null,
  duration: 60,
  automationName: null,
  parent: null,
  client: null,
  made: 0,
  searchable: "no",
});

describe("Uploading from a phone", () => {
  test("says the files come from the phone on a touch screen, and from the computer otherwise", () => {
    windowWidth(390);
    renderInApp(<LibraryView />);
    expect(screen.getByText("Choose videos and photos from your phone.")).toHaveClass(
      "pointer-coarse:block",
    );
    expect(screen.getByText(/^Drop files here, or choose them from your computer\./)).toHaveClass(
      "pointer-coarse:hidden",
    );
  });

  test("always shows tiles, two across, even when list was picked on a computer", () => {
    answerQuery(api.library.list, { ...EMPTY_LIBRARY, items: [tile("i1", "Beach day")] });
    window.localStorage.setItem("library-layout", JSON.stringify("list"));
    windowWidth(390);
    renderInApp(<LibraryView />);
    expect(screen.queryByRole("table")).toBeNull();
    const grid = within(screen.getByRole("region", { name: "Your library" })).getByRole("list");
    expect(grid).toHaveClass("grid-cols-2");
    expect(screen.getByRole("group", { name: "Show as" })).toHaveClass("max-sm:hidden");
  });

  test("the list picked on a computer still shows there", () => {
    answerQuery(api.library.list, { ...EMPTY_LIBRARY, items: [tile("i1", "Beach day")] });
    window.localStorage.setItem("library-layout", JSON.stringify("list"));
    windowWidth(1440);
    renderInApp(<LibraryView />);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  test("keeps the screen on while a file sends, and says to keep the page open", async () => {
    windowWidth(390);
    actionOf(api.storage.startUpload).mockResolvedValue({
      uploadId: "u9",
      uploadUrl: "https://r2.example/put",
    });
    renderInApp(<LibraryView />);
    expect(screen.queryByText(/Keep this page open/)).toBeNull();
    expect(request).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Choose files to upload"), {
      target: { files: [new File(["x"], "Beach day 2.mp4", { type: "video/mp4" })] },
    });
    expect(await screen.findByText(/Keep this page open until your files finish/)).toBeVisible();
    expect(request).toHaveBeenCalledWith("screen");
  });
});
