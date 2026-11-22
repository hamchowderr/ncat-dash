import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { answerQuery, toastError } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { EditorExport } from "./editor-export";

const RUN = "run_1" as Id<"runs">;

const FILES = {
  timelines: 1,
  editors: ["Premiere Pro", "DaVinci Resolve"],
  usesCapCut: false,
  files: [
    {
      name: "Weekly clips.xml",
      text: "<xmeml/>",
      editors: ["Premiere Pro", "DaVinci Resolve"],
      captions: false,
    },
    { name: "Weekly clips.srt", text: "1\n", editors: [], captions: true },
  ],
  clips: ["https://files.example/out/clip-a.mp4?sig=1"],
  clipNames: {},
  folder: "Weekly clips 2026-11-21",
  recordings: [{ url: "https://files.example/uploads/talk.mp4?sig=2", name: "talk.mp4" }],
};

type Win = { __TAURI_INTERNALS__?: { invoke: (...args: unknown[]) => Promise<unknown> } };

function inApp(answers: Record<string, unknown>) {
  const invoke = vi.fn(async (command: unknown) => {
    const answer = answers[String(command)];
    if (answer instanceof Error) throw answer.message;
    return answer;
  });
  (window as unknown as Win).__TAURI_INTERNALS__ = { invoke };
  return invoke;
}

afterEach(() => {
  delete (window as unknown as Win).__TAURI_INTERNALS__;
});

async function openDialog() {
  answerQuery(api.runs.editorFiles, FILES);
  renderInApp(<EditorExport runId={RUN} />);
  fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));
  return screen.findByRole("dialog");
}

describe("Open in your editor in the desktop app", () => {
  test("a browser only offers downloads", async () => {
    const dialog = await openDialog();
    expect(within(dialog).queryByRole("button", { name: "Save to this computer" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Download everything" })).toBeVisible();
  });

  test("saves everything into one folder, then opens the timeline and shows the folder", async () => {
    const folder = "/home/sam/Videos/Takewon/Weekly clips 2026-11-21";
    const invoke = inApp({
      save_export: {
        folder,
        files: [
          { name: "Weekly clips.xml", path: `${folder}/Weekly clips.xml` },
          { name: "Weekly clips.srt", path: `${folder}/Weekly clips.srt` },
          { name: "talk.mp4", path: `${folder}/talk.mp4` },
        ],
        failed: ["01 clip-a.mp4"],
      },
      open_export: null,
      show_export: null,
    });
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save to this computer" }));

    expect(await within(dialog).findByText(folder)).toBeVisible();
    // The timelines, the recording they point at and the clips go to the app together.
    expect(invoke).toHaveBeenCalledWith("save_export", {
      folder: "Weekly clips 2026-11-21",
      files: FILES.files,
      downloads: [
        { url: FILES.recordings[0].url, name: "talk.mp4" },
        { url: FILES.clips[0], name: "01 clip-a.mp4" },
      ],
    });
    expect(within(dialog).getByText(/01 clip-a\.mp4 could not be fetched/)).toBeVisible();

    fireEvent.click(within(dialog).getByRole("button", { name: "Open Weekly clips.xml" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("open_export", { path: `${folder}/Weekly clips.xml` }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Show in folder" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("show_export", { path: `${folder}/Weekly clips.xml` }),
    );
  });

  test("says so when no editor on the computer opens the timeline", async () => {
    const folder = "/Users/sam/Movies/Takewon/Run";
    inApp({
      save_export: {
        folder,
        files: [{ name: "Weekly clips.xml", path: `${folder}/Weekly clips.xml` }],
        failed: [],
      },
      open_export: new Error("No app on this computer opens that file."),
    });
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save to this computer" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Open Weekly clips.xml" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Nothing on this computer opens Weekly clips.xml. Open it from Premiere Pro or DaVinci Resolve.",
      ),
    );
  });

  test("an app too old to save falls back to the downloads", async () => {
    inApp({ save_export: new Error("Command save_export not found") });
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save to this computer" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "The app could not save the files. Download them below instead.",
      ),
    );
    expect(within(dialog).getByRole("button", { name: "Download everything" })).toBeVisible();
  });
});
