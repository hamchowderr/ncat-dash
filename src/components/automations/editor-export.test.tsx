import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { answerQuery, sonner } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { EditorExport } from "./editor-export";

const RUN = "run_1" as Id<"runs">;

const XML = {
  name: "Podcast clips.xml",
  text: "<xmeml/>",
  editors: ["Premiere Pro", "DaVinci Resolve"],
};
const FCPXML = { name: "Podcast clips.fcpxml", text: "<fcpxml/>", editors: ["Final Cut Pro"] };
const NOTE = { name: "How to open.txt", text: "1. Put these files…", editors: [] };
const captions = (name: string) => ({
  name,
  text: `captions of ${name}`,
  editors: [],
  captions: true,
});

const CLIPS = ["https://files.example/out/a.mp4?sig=1", "https://files.example/out/b.mp4?sig=2"];

function answer(more: Record<string, unknown> = {}) {
  answerQuery(api.runs.editorFiles, {
    timelines: 2,
    editors: ["Premiere Pro", "DaVinci Resolve", "Final Cut Pro"],
    usesCapCut: false,
    files: [XML, FCPXML, NOTE],
    clips: CLIPS,
    ...more,
  });
}

/** Every file the page saved to the person's computer: its name and what was in it. */
let saved: { name: string; blob: Blob }[];
let info: ReturnType<typeof vi.fn>;

beforeEach(() => {
  saved = [];
  const blobs = new Map<string, Blob>();
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:${blobs.size}`;
    blobs.set(url, blob);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click(
    this: HTMLAnchorElement,
  ) {
    saved.push({ name: this.download, blob: blobs.get(this.href)! });
  });
  info = vi.fn();
  (sonner.toast as Record<string, unknown>).info = info;
});

const names = () => saved.map((file) => file.name);

/** Opens the dialog and returns it. */
async function open() {
  const user = userEvent.setup();
  renderInApp(<EditorExport runId={RUN} />);
  await user.click(screen.getByRole("button", { name: "Open in editor" }));
  return { user, dialog: within(await screen.findByRole("dialog")) };
}

/** The Download button on the row with the given name. */
const download = (dialog: ReturnType<typeof within>, row: string) =>
  within(dialog.getByText(row).closest("li")!).getByRole("button", { name: /Download/ });

describe("Open in editor on a run", () => {
  test("makes no files until someone opens it", async () => {
    const asked = vi.fn(() => null);
    answerQuery(api.runs.editorFiles, asked);
    const user = userEvent.setup();
    renderInApp(<EditorExport runId={RUN} />);
    expect(asked).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Open in editor" }));
    expect(asked).toHaveBeenCalledWith({ runId: RUN });
  });

  test("lists each file with the editors it is for", async () => {
    answer();
    const { dialog } = await open();
    expect(dialog.getByText("Podcast clips.xml")).toBeVisible();
    expect(dialog.getByText("Timeline for Premiere Pro and DaVinci Resolve")).toBeVisible();
    expect(dialog.getByText("Podcast clips.fcpxml")).toBeVisible();
    expect(dialog.getByText("Timeline for Final Cut Pro")).toBeVisible();
    expect(dialog.getByText("How to open.txt")).toBeVisible();
    expect(dialog.getByText("Finished clips (2)")).toBeVisible();
    expect(dialog.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  test("downloads one timeline file under its own name", async () => {
    answer();
    const { user, dialog } = await open();
    await user.click(download(dialog, "Podcast clips.fcpxml"));
    expect(names()).toEqual(["Podcast clips.fcpxml"]);
    expect(await saved[0].blob.text()).toBe("<fcpxml/>");
  });

  test("shows one captions file by name", async () => {
    answer({ files: [XML, captions("Interview trimmed.srt"), NOTE] });
    const { user, dialog } = await open();
    await user.click(download(dialog, "Interview trimmed.srt"));
    expect(names()).toEqual(["Interview trimmed.srt"]);
  });

  test("groups several captions files into one row that saves them all", async () => {
    answer({ files: [XML, captions("Clip 1.srt"), captions("Clip 2.srt"), NOTE] });
    const { user, dialog } = await open();
    expect(dialog.queryByText("Clip 1.srt")).toBeNull();
    await user.click(download(dialog, "Captions (2)"));
    expect(names()).toEqual(["Clip 1.srt", "Clip 2.srt"]);
  });

  test("saves the finished clips numbered in the order they were made", async () => {
    answer();
    const fetched = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) => new Response(`video at ${String(url)}`));
    const { user, dialog } = await open();
    await user.click(download(dialog, "Finished clips (2)"));
    await waitFor(() => expect(names()).toEqual(["01 a.mp4", "02 b.mp4"]));
    expect(fetched.mock.calls.map(([url]) => url)).toEqual(CLIPS);
    expect(info).not.toHaveBeenCalled();
  });

  test("opens a clip in a new tab when the storage will not let the page read it", async () => {
    answer();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("video"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    const { user, dialog } = await open();
    await user.click(download(dialog, "Finished clips (2)"));
    await waitFor(() => expect(opened).toHaveBeenCalledWith(CLIPS[1], "_blank", "noopener"));
    expect(names()).toEqual(["01 a.mp4"]);
    await waitFor(() =>
      expect(info).toHaveBeenCalledWith("1 clip opened in a new tab. Save it from there."),
    );
  });

  test("treats a refused clip the same as one that cannot be reached", async () => {
    answer();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no", { status: 403 }));
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    const { user, dialog } = await open();
    await user.click(download(dialog, "Finished clips (2)"));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(2));
    expect(names()).toEqual([]);
    await waitFor(() =>
      expect(info).toHaveBeenCalledWith("2 clips opened in a new tab. Save them from there."),
    );
  });

  test("Download everything saves the timelines, captions, note and clips", async () => {
    answer({ files: [XML, FCPXML, captions("Clip 1.srt"), NOTE] });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("video"));
    const { user, dialog } = await open();
    await user.click(dialog.getByRole("button", { name: "Download everything" }));
    await waitFor(() =>
      expect(names()).toEqual([
        "Podcast clips.xml",
        "Podcast clips.fcpxml",
        "Clip 1.srt",
        "How to open.txt",
        "01 a.mp4",
        "02 b.mp4",
      ]),
    );
  });

  test("tells a CapCut team what the clips are for", async () => {
    answer({ usesCapCut: true });
    const { dialog } = await open();
    expect(
      dialog.getByText("For CapCut, which opens no timeline: bring these in as footage"),
    ).toBeVisible();
  });

  test("a CapCut-only team gets the clips and is told no timeline editor is ticked", async () => {
    answer({ usesCapCut: true, editors: ["CapCut"], files: [] });
    const { dialog } = await open();
    expect(dialog.getByText("No editor that opens a timeline is ticked.")).toBeVisible();
    expect(dialog.getByText("Finished clips (2)")).toBeVisible();
    expect(dialog.queryByText(/Keep the files in one folder/)).toBeNull();
  });

  test("with a single thing to download there is no Download everything", async () => {
    answer({ files: [], clips: [CLIPS[0]] });
    const { dialog } = await open();
    expect(dialog.queryByRole("button", { name: "Download everything" })).toBeNull();
  });

  test("says so when the run has no cuts", async () => {
    answerQuery(api.runs.editorFiles, null);
    const { dialog } = await open();
    expect(dialog.getByText("This run has no cuts to open.")).toBeVisible();
  });
});
