import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { actionOf, answerQuery } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { TriggerPanel } from "./trigger-panel";

describe("the Webhook trigger panel", () => {
  test("explains the address in plain words, with no placeholders to type", () => {
    renderInApp(
      <TriggerPanel
        trigger={{ kind: "webhook" }}
        onChange={vi.fn()}
        automationId="auto1"
        hookToken="secret"
      />,
    );
    expect(screen.getByText(/Send a POST here to start a run/)).toBeTruthy();
    expect(screen.getByText(/Anything else you send is kept with the run/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("{{");
    expect(document.body.textContent).not.toContain("trigger.body");
  });
});

describe("the Watched folder trigger panel", () => {
  const folderTrigger = {
    kind: "folder" as const,
    prefix: "incoming/",
    fileType: "video" as const,
  };

  test("shows the folder by name and has nothing to type", () => {
    answerQuery(api.storage.get, { bucket: "salt-house", publicUrl: null, baseUrl: "" });
    renderInApp(
      <TriggerPanel trigger={folderTrigger} onChange={vi.fn()} automationId="a" hookToken="t" />,
    );
    expect(screen.getByText("incoming")).toBeTruthy();
    expect(screen.getByText("Your files/incoming/")).toBeTruthy();
    // The bucket is the toolkit's, shared with other teams; its name is never shown.
    expect(document.body.textContent).not.toContain("salt-house");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  test("picks a folder from the team's files", async () => {
    answerQuery(api.storage.get, { bucket: "salt-house", publicUrl: null, baseUrl: "" });
    actionOf(api.files.folders).mockImplementation(async (args: { prefix: string }) =>
      args.prefix === ""
        ? [
            { key: "incoming/", name: "incoming" },
            { key: "podcast/", name: "podcast" },
          ]
        : args.prefix === "podcast/"
          ? [{ key: "podcast/raw/", name: "raw" }]
          : [],
    );
    const onChange = vi.fn();
    renderInApp(
      <TriggerPanel trigger={folderTrigger} onChange={onChange} automationId="a" hookToken="t" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Folder" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Your files$/ }));
    fireEvent.click(await screen.findByRole("button", { name: "podcast" }));
    fireEvent.click(await screen.findByRole("button", { name: "raw" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Watch raw" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Watch raw" }));
    expect(onChange).toHaveBeenCalledWith({ ...folderTrigger, prefix: "podcast/raw/" });
  });

  test("can watch all of the team's files", async () => {
    answerQuery(api.storage.get, { bucket: "salt-house", publicUrl: null, baseUrl: "" });
    actionOf(api.files.folders).mockResolvedValue([]);
    const onChange = vi.fn();
    renderInApp(
      <TriggerPanel trigger={folderTrigger} onChange={onChange} automationId="a" hookToken="t" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Folder" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Your files$/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Watch all your files" }));
    expect(onChange).toHaveBeenCalledWith({ ...folderTrigger, prefix: "" });
  });

  test("makes a new folder and opens it", async () => {
    answerQuery(api.storage.get, { bucket: "salt-house", publicUrl: null, baseUrl: "" });
    actionOf(api.files.folders).mockResolvedValue([]);
    actionOf(api.files.createFolder).mockResolvedValue("incoming/clips/");
    const onChange = vi.fn();
    renderInApp(
      <TriggerPanel trigger={folderTrigger} onChange={onChange} automationId="a" hookToken="t" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Folder" }));
    fireEvent.click(await screen.findByRole("button", { name: "New folder in incoming" }));
    fireEvent.change(screen.getByLabelText("New folder name"), { target: { value: "clips" } });
    fireEvent.click(screen.getByRole("button", { name: "Make it" }));
    fireEvent.click(await screen.findByRole("button", { name: "Watch clips" }));
    expect(actionOf(api.files.createFolder)).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      prefix: "incoming/",
      name: "clips",
    });
    expect(onChange).toHaveBeenCalledWith({ ...folderTrigger, prefix: "incoming/clips/" });
  });

  test("sends people to connect a bucket when there is none", () => {
    answerQuery(api.storage.get, null);
    renderInApp(
      <TriggerPanel trigger={folderTrigger} onChange={vi.fn()} automationId="a" hookToken="t" />,
    );
    expect(screen.getByRole("link", { name: "Uploads page" }).getAttribute("href")).toBe(
      "/uploads",
    );
  });
});

describe("the project slot trigger panel", () => {
  test("picks which slots and the status they move to", async () => {
    const onChange = vi.fn();
    renderInApp(
      <TriggerPanel
        trigger={{ kind: "slot", status: "approved", slotKind: "any" }}
        onChange={onChange}
        automationId="a"
        hookToken="t"
      />,
    );
    expect(screen.getByText("Any slot")).toBeTruthy();
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByText(/fill the project's empty slots/)).toBeTruthy();
  });
});
