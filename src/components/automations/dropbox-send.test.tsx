import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { answerQuery, mutationOf } from "@/test/convex";
import { renderInApp } from "@/test/render";

import { DropboxSend } from "./dropbox-send";

const AUTOMATION = "a1" as Id<"automations">;
const off = {
  on: false,
  canSwitch: true,
  account: "Jordan Lee",
  mine: true,
  folder: "/NCA Dashboard/Weekly shorts",
};

describe("Send to Dropbox on an automation", () => {
  test("is not shown until someone has connected Dropbox", () => {
    answerQuery(api.dropbox.forAutomation, null);
    renderInApp(<DropboxSend automationId={AUTOMATION} />);
    expect(screen.queryByText("Send to Dropbox")).toBeNull();
  });

  test("switches on, then the folder can be changed in place", async () => {
    answerQuery(api.dropbox.forAutomation, off);
    const set = mutationOf(api.dropbox.setSend);
    const { rerender } = renderInApp(<DropboxSend automationId={AUTOMATION} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("switch", { name: "Send finished files to Dropbox" }));
    expect(set).toHaveBeenCalledWith({ automationId: AUTOMATION, on: true });

    answerQuery(api.dropbox.forAutomation, { ...off, on: true });
    rerender(<DropboxSend automationId={AUTOMATION} />);
    await user.click(screen.getByRole("button", { name: "/NCA Dashboard/Weekly shorts" }));
    const input = screen.getByRole("textbox", { name: "Dropbox folder for finished files" });
    await user.clear(input);
    await user.type(input, "/Clients/Acme{Enter}");
    await waitFor(() =>
      expect(set).toHaveBeenLastCalledWith({
        automationId: AUTOMATION,
        on: true,
        folder: "/Clients/Acme",
      }),
    );
  });

  test("someone else's Dropbox: the folder is shown but only its owner changes it", () => {
    answerQuery(api.dropbox.forAutomation, { ...off, on: true, mine: false, canSwitch: false });
    renderInApp(<DropboxSend automationId={AUTOMATION} />);
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByRole("button", { name: "/NCA Dashboard/Weekly shorts" })).toBeDisabled();
  });
});
