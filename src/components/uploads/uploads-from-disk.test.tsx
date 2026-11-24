import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery, mutationOf, toastError } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { LibraryView } from "@/components/library/library-view";
import { emptyLibrary } from "@/test/library";

// Files are brought in on the Library page; it starts empty here.
beforeEach(() => emptyLibrary());

const MIB = 1024 * 1024;
const STORAGE = { bucket: "ncat", publicUrl: null, baseUrl: "https://toolkit.example" };
const PLAN = { partSize: 64 * MIB, partCount: 4 };
const CHOSEN = {
  path: "/Users/sam/Movies/Keynote.mov",
  name: "Keynote.mov",
  size: 200 * MIB,
  contentType: "video/quicktime",
};

function row(id: string, fileName: string, status: "uploading" | "ready") {
  return {
    _id: id,
    _creationTime: 0,
    fileName,
    contentType: "video/mp4",
    size: 1024,
    status,
    purpose: null,
    details: null,
  };
}

type Win = { __TAURI_INTERNALS__?: { invoke: (...args: unknown[]) => Promise<unknown> } };

function inApp(handle: (command: string, args: Record<string, unknown>) => unknown) {
  const invoke = vi.fn(async (command: unknown, args?: unknown) => {
    const answer = handle(String(command), (args ?? {}) as Record<string, unknown>);
    if (answer instanceof Error) throw answer.message;
    return answer;
  });
  (window as unknown as Win).__TAURI_INTERNALS__ = { invoke };
  return invoke;
}

beforeEach(() => {
  window.localStorage.clear();
  answerQuery(api.storage.get, STORAGE);
  actionOf(api.storage.previewLinks).mockResolvedValue([]);
  actionOf(api.storage.signUploadParts).mockImplementation(
    async ({ partNumbers }: { partNumbers: number[] }) =>
      partNumbers.map((partNumber) => ({ partNumber, url: `https://r2.example/p${partNumber}` })),
  );
  actionOf(api.storage.completeUploadParts).mockResolvedValue(null);
});

afterEach(() => {
  delete (window as unknown as Win).__TAURI_INTERNALS__;
});

describe("uploading in the desktop app", () => {
  test("chooses files in the computer's picker and sends them from disk", async () => {
    answerQuery(api.storage.listUploads, [row("u9", "Keynote.mov", "uploading")]);
    actionOf(api.storage.startUpload).mockResolvedValue({
      uploadId: "u9",
      uploadUrl: null,
      parts: PLAN,
    });
    const record = { ...CHOSEN, uploadId: "u9", plan: PLAN, parts: [] as unknown[] };
    const invoke = inApp((command, args) => {
      if (command === "stopped_uploads") return [];
      if (command === "choose_files") return [CHOSEN];
      if (command === "begin_upload") return record;
      if (command === "send_part") return `"e${String(args.partNumber)}"`;
      return null;
    });
    renderInApp(<LibraryView />);
    fireEvent.click(screen.getByRole("button", { name: "Choose files" }));

    await waitFor(() =>
      expect(mutationOf(api.storage.finishUpload)).toHaveBeenCalledWith({ uploadId: "u9" }),
    );
    expect(actionOf(api.storage.startUpload)).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "Keynote.mov", contentType: "video/quicktime" }),
    );
    expect(invoke).toHaveBeenCalledWith("begin_upload", {
      uploadId: "u9",
      path: CHOSEN.path,
      plan: PLAN,
    });
    expect(invoke.mock.calls.filter(([command]) => command === "send_part")).toHaveLength(4);
    expect(invoke).toHaveBeenCalledWith("forget_upload", { uploadId: "u9" });
  });

  test("an upload that stopped is listed to carry on, and carries on from where it got to", async () => {
    answerQuery(api.storage.listUploads, [
      row("u9", "Keynote.mov", "uploading"),
      row("u1", "Older.mp4", "ready"),
    ]);
    const parts = [1, 2].map((partNumber) => ({ partNumber, etag: `"e${partNumber}"` }));
    let stopped = [{ ...CHOSEN, uploadId: "u9", plan: PLAN, parts }];
    const invoke = inApp((command, args) => {
      if (command === "stopped_uploads") return stopped;
      if (command === "send_part") return `"e${String(args.partNumber)}"`;
      if (command === "forget_upload") stopped = [];
      return null;
    });
    renderInApp(<LibraryView />);

    const list = await screen.findByRole("region", { name: "Stopped uploads" });
    expect(list).toHaveTextContent("Keynote.mov stopped at 64%");
    fireEvent.click(within(list).getByRole("button", { name: "Carry on" }));

    await waitFor(() =>
      expect(mutationOf(api.storage.finishUpload)).toHaveBeenCalledWith({ uploadId: "u9" }),
    );
    // Only the parts the bucket didn't have yet.
    expect(
      invoke.mock.calls.filter(([command]) => command === "send_part").map(([, args]) => args),
    ).toEqual([
      { uploadId: "u9", partNumber: 3, url: "https://r2.example/p3" },
      { uploadId: "u9", partNumber: 4, url: "https://r2.example/p4" },
    ]);
    expect(actionOf(api.storage.completeUploadParts)).toHaveBeenCalledWith({
      uploadId: "u9",
      parts: [1, 2, 3, 4].map((partNumber) => ({ partNumber, etag: `"e${partNumber}"` })),
    });
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Stopped uploads" })).toBeNull(),
    );
  });

  test(
    "a part that keeps failing keeps the upload to carry on, instead of throwing it away",
    {
      timeout: 10000,
    },
    async () => {
      answerQuery(api.storage.listUploads, [row("u9", "Keynote.mov", "uploading")]);
      actionOf(api.storage.startUpload).mockResolvedValue({
        uploadId: "u9",
        uploadUrl: null,
        parts: PLAN,
      });
      const record = { ...CHOSEN, uploadId: "u9", plan: PLAN, parts: [] as unknown[] };
      let stopped: unknown[] = [];
      inApp((command, args) => {
        if (command === "stopped_uploads") return stopped;
        if (command === "choose_files") return [CHOSEN];
        if (command === "begin_upload") {
          stopped = [record];
          return record;
        }
        if (command === "send_part") {
          return args.partNumber === 4 ? new Error("The bucket answered 503.") : `"e1"`;
        }
        return null;
      });
      renderInApp(<LibraryView />);
      fireEvent.click(screen.getByRole("button", { name: "Choose files" }));

      await waitFor(
        () =>
          expect(toastError).toHaveBeenCalledWith(
            "Keynote.mov stopped part way. Carry on below to send the rest.",
          ),
        // A failing part is tried three times, a second and then two apart.
        { timeout: 5000 },
      );
      expect(mutationOf(api.storage.removeUpload)).not.toHaveBeenCalled();
      expect(actionOf(api.storage.cancelUpload)).not.toHaveBeenCalled();
      expect(await screen.findByRole("region", { name: "Stopped uploads" })).toBeVisible();
    },
  );

  test("a browser, or an app too old for its own picker, uses the page's file input", async () => {
    answerQuery(api.storage.listUploads, []);
    inApp((command) => (command === "choose_files" ? new Error("not allowed") : []));
    renderInApp(<LibraryView />);
    const input = screen.getByLabelText("Choose files to upload") as HTMLInputElement;
    const clicked = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Choose files" }));
    await waitFor(() => expect(clicked).toHaveBeenCalled());
  });
});
