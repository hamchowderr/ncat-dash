import { api } from "@convex/_generated/api";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test } from "vitest";

import { navMain } from "@/components/app-shell/app-sidebar";
import { actionOf, answerQuery, place, replaced } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { FilesPage } from "./files-page";

beforeEach(() => {
  place.pathname = "/files";
  place.search = "";
  answerQuery(api.storage.get, { bucket: "ncat", publicUrl: null, baseUrl: "https://t.example" });
  answerQuery(api.storage.listUploads, []);
  answerQuery(api.files.detailsIn, []);
  actionOf(api.files.list).mockResolvedValue({
    bucket: "ncat",
    folders: [{ key: "Finished/", name: "Finished" }],
    files: [],
    next: null,
  });
  answerQuery(api.automations.list, [{ _id: "auto_1", name: "Shorts" }]);
  answerQuery(api.outputs.byRun, []);
  answerQuery(api.outputs.byHand, []);
});

describe("Files", () => {
  test("is the one place for files: there is no Outputs page in the menu", () => {
    expect(navMain.map((item) => item.title)).not.toContain("Outputs");
    expect(navMain.map((item) => item.url)).toContain("/files");
  });

  test("opens on the folders, with upload and new folder beside the search", async () => {
    renderInApp(<FilesPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Files" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "All Files" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Finished")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New folder" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Made by" })).not.toBeInTheDocument();
  });

  test("shows what automations and steps made on the Recently Made tab", async () => {
    place.search = "?tab=made";
    renderInApp(<FilesPage />);
    expect(screen.getByRole("tab", { name: "Recently Made" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("combobox", { name: "Made by" })).toBeInTheDocument();
    expect(await screen.findByText(/No files yet/)).toBeInTheDocument();
  });

  test("keeps the open tab in the address", async () => {
    renderInApp(<FilesPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Recently Made" }));
    expect(replaced).toHaveBeenLastCalledWith("/files?tab=made", { scroll: false });
  });

  test("going back to All Files clears the tab from the address", async () => {
    place.search = "?tab=made";
    renderInApp(<FilesPage />);
    await userEvent.setup().click(screen.getByRole("tab", { name: "All Files" }));
    expect(replaced).toHaveBeenLastCalledWith("/files", { scroll: false });
  });
});
