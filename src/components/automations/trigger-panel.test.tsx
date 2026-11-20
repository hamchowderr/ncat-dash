import { api } from "@convex/_generated/api";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  test("can wait for each creator's takes instead of single files", async () => {
    answerQuery(api.storage.get, { bucket: "salt-house", publicUrl: null, baseUrl: "" });
    const onChange = vi.fn();
    const { rerender } = renderInApp(
      <TriggerPanel
        trigger={{ ...folderTrigger, fileType: "any" }}
        onChange={onChange}
        automationId="a"
        hookToken="t"
      />,
    );
    expect(screen.getByRole("combobox", { name: "What lands there" })).toHaveTextContent(
      "Single files",
    );
    expect(screen.getByRole("combobox", { name: "Which files" })).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "What lands there" }));
    await user.click(await screen.findByRole("option", { name: "A folder for each creator" }));
    expect(onChange).toHaveBeenCalledWith({ ...folderTrigger, layout: "creators" });

    const creators = { ...folderTrigger, layout: "creators" as const };
    rerender(
      <TriggerPanel trigger={creators} onChange={onChange} automationId="a" hookToken="t" />,
    );
    expect(screen.getByText(/each creator has a folder with hooks, body/)).toBeTruthy();
    expect(screen.getByText(/one run starts with all their takes/)).toBeTruthy();
    // Takes are always videos, so there is no file type to pick.
    expect(screen.queryByRole("combobox", { name: "Which files" })).toBeNull();

    await user.click(screen.getByRole("combobox", { name: "What lands there" }));
    await user.click(await screen.findByRole("option", { name: "Single files" }));
    expect(onChange).toHaveBeenLastCalledWith(folderTrigger);
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

describe("the Schedule trigger panel", () => {
  const every = (minutes: number) => ({
    kind: "schedule" as const,
    schedule: { mode: "interval" as const, minutes },
  });

  test("shows both ways side by side, with the picked one checked", () => {
    renderInApp(
      <TriggerPanel trigger={every(60)} onChange={vi.fn()} automationId="a" hookToken="t" />,
    );
    const often = screen.getByRole("radiogroup", { name: "How often" });
    expect(
      within(often).getByRole("radio", { name: "On repeat" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      within(often).getByRole("radio", { name: "Every day" }).getAttribute("aria-checked"),
    ).toBe("false");
    expect(screen.getByText("Runs every hour.")).toBeTruthy();
  });

  test("changes the unit without changing the count", () => {
    const onChange = vi.fn();
    renderInApp(
      <TriggerPanel trigger={every(120)} onChange={onChange} automationId="a" hookToken="t" />,
    );
    expect(screen.getByText("Runs every 2 hours.")).toBeTruthy();
    const unit = screen.getByRole("radiogroup", { name: "Unit" });
    fireEvent.click(within(unit).getByRole("radio", { name: "Minutes" }));
    expect(onChange).toHaveBeenCalledWith(every(2));
  });

  test("switches to every day at 9:00 in the person's own time zone", () => {
    const onChange = vi.fn();
    renderInApp(
      <TriggerPanel trigger={every(60)} onChange={onChange} automationId="a" hookToken="t" />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Every day" }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "schedule",
      schedule: {
        mode: "daily",
        time: "09:00",
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      },
    });
  });

  test("picks the time zone by city from a search", async () => {
    const onChange = vi.fn();
    renderInApp(
      <TriggerPanel
        trigger={{
          kind: "schedule",
          schedule: { mode: "daily", time: "09:00", timeZone: "UTC" },
        }}
        onChange={onChange}
        automationId="a"
        hookToken="t"
      />,
    );
    expect(screen.getByText("Runs every day at 9:00 AM, UTC time.")).toBeTruthy();
    fireEvent.click(screen.getByRole("combobox", { name: "Time zone" }));
    fireEvent.change(await screen.findByLabelText("Search time zones"), {
      target: { value: "new york" },
    });
    fireEvent.click(await screen.findByRole("option", { name: /New York/ }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "schedule",
      schedule: { mode: "daily", time: "09:00", timeZone: "America/New_York" },
    });
  });
});

describe("the What starts it list", () => {
  test("gives every choice its icon and one plain line", async () => {
    renderInApp(
      <TriggerPanel
        trigger={{ kind: "manual" }}
        onChange={vi.fn()}
        automationId="a"
        hookToken="t"
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "What starts it" }));
    const schedule = await screen.findByRole("option", { name: /Schedule/ });
    expect(schedule.textContent).toContain("Every so often, or each day at a set time");
    expect(schedule.querySelector("svg")).toBeTruthy();
  });
});
