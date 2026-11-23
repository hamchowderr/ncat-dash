import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { LocalFolders, storageFolder } from "@/components/app-shell/local-folders";
import { actionOf, answerQuery, mutationOf } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { TriggerPanel } from "./trigger-panel";

const FOLDER_TRIGGER = { kind: "folder" as const, prefix: "incoming/", fileType: "video" as const };
const COMPUTER_FOLDER = "/Users/sam/Movies/Recordings";

type Win = { __TAURI_INTERNALS__?: { invoke: (...args: unknown[]) => Promise<unknown> } };

function inApp(handle: (command: string, args: Record<string, unknown>) => unknown) {
  const invoke = vi.fn(async (command: unknown, args?: unknown) =>
    handle(String(command), (args ?? {}) as Record<string, unknown>),
  );
  (window as unknown as Win).__TAURI_INTERNALS__ = { invoke };
  return invoke;
}

beforeEach(() => {
  answerQuery(api.storage.get, { bucket: "salt-house", publicUrl: null, baseUrl: "" });
});

afterEach(() => {
  delete (window as unknown as Win).__TAURI_INTERNALS__;
});

function panel() {
  return renderInApp(
    <TriggerPanel
      trigger={FOLDER_TRIGGER}
      onChange={vi.fn()}
      automationId="auto1"
      automationName="Weekly clips"
      hookToken="t"
    />,
  );
}

describe("a folder on this computer as the trigger", () => {
  test("isn't offered in a browser", () => {
    panel();
    expect(screen.queryByRole("button", { name: /folder on this computer/ })).toBeNull();
  });

  test("in the app, a folder chosen in the computer's picker feeds the trigger's folder", async () => {
    let watches: unknown[] = [];
    const invoke = inApp((command, args) => {
      if (command === "watched_folders") return watches;
      if (command === "choose_folder") return COMPUTER_FOLDER;
      if (command === "watch_folder") {
        watches = [args];
        return args;
      }
      if (command === "unwatch_folder") watches = [];
      return null;
    });
    panel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Also from a folder on this computer" }),
    );
    expect(await screen.findByText(COMPUTER_FOLDER)).toBeVisible();
    expect(invoke).toHaveBeenCalledWith("watch_folder", {
      automationId: "auto1",
      automationName: "Weekly clips",
      organizationId: TEAM.id,
      prefix: "incoming/",
      folder: COMPUTER_FOLDER,
    });
    expect(screen.getByText(/Files already there are left alone/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("unwatch_folder", { automationId: "auto1" }),
    );
    expect(
      await screen.findByRole("button", { name: "Also from a folder on this computer" }),
    ).toBeVisible();
  });

  test("files that land there go to the automation's folder, keeping their own folders", async () => {
    let started = 0;
    actionOf(api.files.startUpload).mockImplementation(async () => ({
      uploadId: `up${++started}`,
      uploadUrl: "https://r2.example/put",
      parts: null,
      key: "k",
    }));
    const landed = [
      {
        path: `${COMPUTER_FOLDER}/talk.mp4`,
        folder: "",
        name: "talk.mp4",
        size: 40,
        contentType: "video/mp4",
      },
      {
        path: `${COMPUTER_FOLDER}/Maya/hooks/take 1.mov`,
        folder: "Maya/hooks",
        name: "take 1.mov",
        size: 20,
        contentType: "video/quicktime",
      },
    ];
    const invoke = inApp((command) => {
      if (command === "watched_folders") {
        return [
          {
            automationId: "auto1",
            automationName: "Weekly clips",
            organizationId: "team_2",
            prefix: "incoming/",
            folder: COMPUTER_FOLDER,
          },
        ];
      }
      if (command === "landed_files") return landed.splice(0);
      return null;
    });
    renderInApp(<LocalFolders />);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("landed_sent", {
        automationId: "auto1",
        path: `${COMPUTER_FOLDER}/Maya/hooks/take 1.mov`,
      }),
    );
    expect(actionOf(api.files.startUpload).mock.calls.map(([args]) => args)).toEqual([
      {
        organizationId: "team_2",
        prefix: "incoming/",
        fileName: "talk.mp4",
        contentType: "video/mp4",
        size: 40,
      },
      {
        organizationId: "team_2",
        prefix: "incoming/Maya/hooks/",
        fileName: "take 1.mov",
        contentType: "video/quicktime",
        size: 20,
      },
    ]);
    expect(invoke).toHaveBeenCalledWith("send_file", {
      path: `${COMPUTER_FOLDER}/talk.mp4`,
      url: "https://r2.example/put",
      contentType: "video/mp4",
    });
    expect(mutationOf(api.storage.finishUpload)).toHaveBeenCalledWith({ uploadId: "up1" });
    expect(mutationOf(api.storage.finishUpload)).toHaveBeenCalledWith({ uploadId: "up2" });
  });

  test("a file that could not be sent is not written down as sent, so it is tried again", async () => {
    actionOf(api.files.startUpload).mockRejectedValue(new Error("offline"));
    const invoke = inApp((command) => {
      if (command === "watched_folders") {
        return [
          {
            automationId: "auto1",
            automationName: "",
            organizationId: "t",
            prefix: "in/",
            folder: "/x",
          },
        ];
      }
      if (command === "landed_files") {
        return [{ path: "/x/a.mp4", folder: "", name: "a.mp4", size: 1, contentType: "video/mp4" }];
      }
      return null;
    });
    renderInApp(<LocalFolders />);
    await waitFor(() => expect(actionOf(api.files.startUpload)).toHaveBeenCalled());
    expect(invoke.mock.calls.some(([command]) => command === "landed_sent")).toBe(false);
  });

  test("storage folders join cleanly", () => {
    expect(storageFolder("incoming/", "")).toBe("incoming/");
    expect(storageFolder("incoming", "Maya/hooks")).toBe("incoming/Maya/hooks/");
    expect(storageFolder("", "Maya")).toBe("Maya/");
  });
});
