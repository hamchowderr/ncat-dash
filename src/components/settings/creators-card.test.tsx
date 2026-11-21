import { api } from "@convex/_generated/api";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { answerQuery, mutationOf, toastSuccess } from "@/test/convex";
import { renderInApp, TEAM } from "@/test/render";

import { CreatorsCard, rightsStatus } from "./creators-card";
import { SETTINGS_PAGES } from "./settings-pages";

const TODAY = "2026-11-21";

const list = {
  creators: [
    {
      id: "c1",
      creator: "Ana Ruiz",
      endsOn: "2026-11-27",
      note: "Paid on Meta",
      alerted: true,
    },
    { id: "c2", creator: "Ben Cole", endsOn: "2027-02-01", note: "", alerted: false },
    { id: "c3", creator: "Cy Park", endsOn: "2026-11-01", note: "", alerted: true },
  ],
  seen: ["Dee Moss"],
};

describe("Settings, Creators", () => {
  test("is a Team settings page with a Title Case name", () => {
    expect(SETTINGS_PAGES.find((page) => page.slug === "creators")?.title).toBe("Creators");
  });

  test("says when each creator's rights end, and marks the ones within a week", () => {
    expect(rightsStatus("2026-11-27", TODAY)).toEqual({
      label: "Last day November 27, 2026, in 6 days",
      tone: "soon",
    });
    expect(rightsStatus("2026-11-21", TODAY).label).toBe("Last day today, November 21, 2026");
    expect(rightsStatus("2026-11-22", TODAY).label).toBe("Last day tomorrow, November 22, 2026");
    expect(rightsStatus("2026-12-01", TODAY).tone).toBe("later");
    expect(rightsStatus("2026-11-01", TODAY)).toEqual({
      label: "Ended November 1, 2026",
      tone: "ended",
    });

    answerQuery(api.creatorRights.list, list);
    renderInApp(<CreatorsCard today={TODAY} />);
    const rows = within(screen.getByRole("list", { name: "Creators" })).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-creator"))).toEqual([
      "Ana Ruiz",
      "Ben Cole",
      "Cy Park",
    ]);
    expect(within(rows[0]).getByText("Last day November 27, 2026, in 6 days")).toHaveAttribute(
      "data-tone",
      "soon",
    );
    expect(within(rows[0]).getByText("Paid on Meta")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Ended November 1, 2026")).toBeInTheDocument();
    expect(screen.getByText(/A week before a creator's last day/)).toBeInTheDocument();
  });

  test("adds a creator with their last day and a note", async () => {
    answerQuery(api.creatorRights.list, { creators: [], seen: ["Dee Moss"] });
    const save = mutationOf(api.creatorRights.save);
    save.mockResolvedValue("c9");
    renderInApp(<CreatorsCard today={TODAY} />);
    expect(screen.getByText(/No end dates yet/)).toBeInTheDocument();
    const user = userEvent.setup();
    const add = screen.getByRole("button", { name: "Add creator" });
    expect(add).toBeDisabled();
    await user.type(screen.getByLabelText("Creator"), "Dee Moss");
    await user.type(screen.getByLabelText("Last day of use"), "2027-03-31");
    await user.type(screen.getByLabelText(/Note/), "TikTok Spark Ads");
    await user.click(add);
    expect(save).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      id: undefined,
      creator: "Dee Moss",
      endsOn: "2027-03-31",
      note: "TikTok Spark Ads",
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Dee Moss added"));
  });

  test("changes a creator's date, and removes one", async () => {
    answerQuery(api.creatorRights.list, list);
    const save = mutationOf(api.creatorRights.save);
    const remove = mutationOf(api.creatorRights.remove);
    renderInApp(<CreatorsCard today={TODAY} />);
    const user = userEvent.setup();
    const ana = screen.getAllByRole("listitem")[0];
    await user.click(within(ana).getByRole("button", { name: "Change" }));
    const form = screen.getByRole("form", { name: "Change Ana Ruiz" });
    const day = within(form).getByLabelText("Last day of use");
    await user.clear(day);
    await user.type(day, "2027-05-27");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith({
      organizationId: TEAM.id,
      id: "c1",
      creator: "Ana Ruiz",
      endsOn: "2027-05-27",
      note: "Paid on Meta",
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Ana Ruiz saved"));

    await user.click(screen.getByRole("button", { name: "Remove Ben Cole" }));
    expect(remove).toHaveBeenCalledWith({ organizationId: TEAM.id, id: "c2" });
  });
});
